using System;
using System.Collections.Generic;

namespace Prototype.Combat
{
    // Battle-side result envelopes only. Public inventory, wallets, saves and reward posting
    // remain the integration module's responsibility.
    [Serializable]
    public sealed class CombatExpeditionConfig
    {
        public string id;
        public string title;
        public string parameterNotice;
        public string carryTeam;
        public int maxStepsPerBattle = 10000;
        public double maxWaitPerBattle = 100000;
        public CombatEncounterConfig[] encounters;
    }

    [Serializable]
    public sealed class CombatEncounterConfig
    {
        public string id;
        public double waitBefore;
        public CombatScenario scenario;
        public int experiencePool;
        public int publicCash;
        public CombatLootStack[] publicDrops;
    }

    [Serializable]
    public sealed class CombatLootStack
    {
        public string itemId;
        public int quantity;
    }

    [Serializable]
    public sealed class CombatExperienceGrant
    {
        public string unitId;
        public int amount;
    }

    [Serializable]
    public sealed class CombatEncounterReport
    {
        public string resultId;
        public string expeditionId;
        public string encounterId;
        public string scenarioId;
        public int encounterIndex;
        public double betweenBattleWait;
        public CombatSnapshot previousBattleEnd;
        public CombatSnapshot afterIntermission;
        public CombatSnapshot battleStart;
        public CombatSnapshot battleEnd;
        public string outcome;
        public string winnerTeam;
        public string stopReason;
        public int executedActionCount;
        public CombatStepResult[] steps;
        public bool rewardsEligible;
        public CombatExperienceGrant[] experience;
        public int publicCash;
        public CombatLootStack[] publicDrops;
    }

    [Serializable]
    public sealed class CombatExpeditionReport
    {
        public string expeditionId;
        public string carryTeam;
        public string parameterNotice;
        public bool finished;
        public string stopReason;
        public int requestedEncounterCount;
        public CombatEncounterReport[] encounters;
        public CombatSnapshot finalSnapshot;
        public CombatExperienceGrant[] experience;
        public int publicCash;
        public CombatLootStack[] publicDrops;
    }

    /// <summary>
    /// RunNextEncounter and RunToEnd share the same encounter path and CombatSession engine.
    /// GetReport only copies already-settled records: it cannot fight or post rewards.
    /// </summary>
    public sealed class CombatExpeditionSession
    {
        private readonly CombatExpeditionConfig config;
        private readonly List<CombatEncounterReport> records = new List<CombatEncounterReport>();
        private readonly List<string> encounterLogTexts = new List<string>();
        private CombatSnapshot previous;
        private bool finished;
        private string stopReason = string.Empty;

        public CombatExpeditionSession(CombatExpeditionConfig source)
        {
            Validate(source);
            config = CopyConfig(source);
            // Expedition viewpoint follows the carried party, never incidental unit order.
            foreach (CombatEncounterConfig encounter in config.encounters)
                if (string.IsNullOrEmpty(encounter.scenario.playerTeam)) encounter.scenario.playerTeam = config.carryTeam;
        }

        public CombatEncounterReport RunNextEncounter()
        {
            if (finished) return null;
            int index = records.Count;
            if (index >= config.encounters.Length)
            {
                finished = true;
                stopReason = "CompletedAllEncounters";
                return null;
            }

            CombatEncounterConfig encounter = config.encounters[index];
            CombatSession battle = previous == null
                ? new CombatSession(encounter.scenario)
                : new CombatSession(encounter.scenario, previous, config.carryTeam, encounter.waitBefore);
            CombatSnapshot start = battle.GetSnapshot();
            CombatRunResult run = battle.RunToCompletion(config.maxStepsPerBattle, config.maxWaitPerBattle);
            bool victory = run.outcome == "Victory" && run.winnerTeam == config.carryTeam;
            var record = new CombatEncounterReport
            {
                resultId = config.id + ":battle:" + (index + 1).ToString(System.Globalization.CultureInfo.InvariantCulture),
                expeditionId = config.id,
                encounterId = encounter.id,
                scenarioId = encounter.scenario.id,
                encounterIndex = index + 1,
                betweenBattleWait = index == 0 ? 0 : encounter.waitBefore,
                previousBattleEnd = previous == null ? null : CombatSession.CopySnapshot(previous),
                // These party values come from the actual carry constructor, not a second timer model.
                afterIntermission = PartySnapshot(start, config.carryTeam),
                battleStart = start,
                battleEnd = CombatSession.CopySnapshot(run.snapshot),
                outcome = run.outcome,
                winnerTeam = run.winnerTeam,
                stopReason = run.stopReason,
                executedActionCount = run.executedActionCount,
                steps = CopySteps(run.steps),
                rewardsEligible = victory,
                experience = victory ? DivideExperience(start, config.carryTeam, encounter.experiencePool)
                    : Array.Empty<CombatExperienceGrant>(),
                publicCash = victory ? encounter.publicCash : 0,
                publicDrops = victory ? CopyLoot(encounter.publicDrops) : Array.Empty<CombatLootStack>()
            };
            string logText = battle.ExportLogText();
            records.Add(record);
            encounterLogTexts.Add(logText);
            previous = CombatSession.CopySnapshot(run.snapshot);
            if (!victory)
            {
                finished = true;
                stopReason = "Battle" + run.outcome + ":" + run.stopReason;
            }
            else if (records.Count == config.encounters.Length)
            {
                finished = true;
                stopReason = "CompletedAllEncounters";
            }
            return CopyRecord(record);
        }

        public CombatExpeditionReport RunToEnd()
        {
            while (!finished) RunNextEncounter();
            return GetReport();
        }

        /// <summary>Returns the cached native log for a recorded encounter (1-based).</summary>
        public string ExportEncounterLogText(int encounterIndex)
        {
            if (encounterIndex < 1 || encounterIndex > config.encounters.Length)
                throw new ArgumentOutOfRangeException(nameof(encounterIndex));
            if (encounterIndex > records.Count)
                throw new InvalidOperationException("The encounter has not been executed.");
            return encounterLogTexts[encounterIndex - 1];
        }

        public CombatExpeditionReport GetReport()
        {
            var copied = new CombatEncounterReport[records.Count];
            var experience = new List<CombatExperienceGrant>();
            var loot = new List<CombatLootStack>();
            int cash = 0;
            for (int i = 0; i < records.Count; i++)
            {
                CombatEncounterReport record = records[i];
                copied[i] = CopyRecord(record);
                checked { cash += record.publicCash; }
                foreach (CombatExperienceGrant grant in record.experience)
                {
                    CombatExperienceGrant existing = experience.Find(value => value.unitId == grant.unitId);
                    if (existing == null) experience.Add(new CombatExperienceGrant { unitId = grant.unitId, amount = grant.amount });
                    else checked { existing.amount += grant.amount; }
                }
                foreach (CombatLootStack drop in record.publicDrops)
                {
                    CombatLootStack existing = loot.Find(value => value.itemId == drop.itemId);
                    if (existing == null) loot.Add(new CombatLootStack { itemId = drop.itemId, quantity = drop.quantity });
                    else checked { existing.quantity += drop.quantity; }
                }
            }
            return new CombatExpeditionReport
            {
                expeditionId = config.id, carryTeam = config.carryTeam, parameterNotice = config.parameterNotice,
                finished = finished, stopReason = stopReason, requestedEncounterCount = config.encounters.Length,
                encounters = copied, finalSnapshot = previous == null ? null : CombatSession.CopySnapshot(previous),
                experience = experience.ToArray(), publicCash = cash, publicDrops = loot.ToArray()
            };
        }

        public static CombatExpeditionConfig CopyConfig(CombatExpeditionConfig source)
        {
            if (source == null) return null;
            var encounters = new CombatEncounterConfig[source.encounters.Length];
            for (int i = 0; i < encounters.Length; i++)
            {
                CombatEncounterConfig e = source.encounters[i];
                encounters[i] = new CombatEncounterConfig
                {
                    id = e.id, waitBefore = e.waitBefore, scenario = CombatSession.CopyScenario(e.scenario),
                    experiencePool = e.experiencePool, publicCash = e.publicCash, publicDrops = CopyLoot(e.publicDrops)
                };
            }
            return new CombatExpeditionConfig
            {
                id = source.id, title = source.title, parameterNotice = source.parameterNotice,
                carryTeam = source.carryTeam, maxStepsPerBattle = source.maxStepsPerBattle,
                maxWaitPerBattle = source.maxWaitPerBattle, encounters = encounters
            };
        }

        private static void Validate(CombatExpeditionConfig value)
        {
            if (value == null) throw new ArgumentNullException(nameof(value));
            if (string.IsNullOrEmpty(value.id) || string.IsNullOrEmpty(value.carryTeam))
                throw new ArgumentException("出征必须指定稳定 id 和携带队伍 carryTeam。");
            if (value.maxStepsPerBattle <= 0 || double.IsNaN(value.maxWaitPerBattle) ||
                double.IsInfinity(value.maxWaitPerBattle) || value.maxWaitPerBattle <= 0)
                throw new ArgumentException("出征的单场步骤／WAIT 上限必须为正值。");
            if (value.encounters == null || value.encounters.Length == 0)
                throw new ArgumentException("出征必须至少配置一场遭遇。");
            var ids = new HashSet<string>(StringComparer.Ordinal);
            Dictionary<string, CombatUnitSnapshot> firstRoster = null;
            foreach (CombatEncounterConfig encounter in value.encounters)
            {
                if (encounter == null || string.IsNullOrEmpty(encounter.id) || !ids.Add(encounter.id) ||
                    double.IsNaN(encounter.waitBefore) || double.IsInfinity(encounter.waitBefore) || encounter.waitBefore < 0 ||
                    encounter.experiencePool < 0 || encounter.publicCash < 0 || encounter.scenario == null)
                    throw new ArgumentException("遭遇 id／场间 WAIT／奖励配置无效。");
                var battle = new CombatSession(encounter.scenario);
                CombatSnapshot start = battle.GetSnapshot();
                var roster = new Dictionary<string, CombatUnitSnapshot>(StringComparer.Ordinal);
                foreach (CombatUnitSnapshot unit in start.units) if (unit.team == value.carryTeam) roster.Add(unit.id, unit);
                if (roster.Count == 0) throw new ArgumentException("遭遇缺少需要携带的队伍：" + encounter.id);
                if (firstRoster == null) firstRoster = roster;
                else
                {
                    if (firstRoster.Count != roster.Count) throw new ArgumentException("跨场携带队伍ID集合必须一致：" + encounter.id);
                    foreach (KeyValuePair<string, CombatUnitSnapshot> pair in firstRoster)
                    {
                        CombatUnitSnapshot next;
                        if (!roster.TryGetValue(pair.Key, out next) || next.maxHp != pair.Value.maxHp || next.maxMp != pair.Value.maxMp ||
                            next.row != pair.Value.row || next.column != pair.Value.column)
                            throw new ArgumentException("跨场携带队伍ID、最大HP/MP和格位必须一致：" + encounter.id + "/" + pair.Key);
                    }
                }
                if (encounter.scenario.playerTeam != null && encounter.scenario.playerTeam.Length > 0 &&
                    encounter.scenario.playerTeam != value.carryTeam)
                    throw new ArgumentException("本轮出征 playerTeam 必须与 carryTeam 一致。");
                foreach (CombatLootStack drop in encounter.publicDrops ?? Array.Empty<CombatLootStack>())
                    if (drop == null || string.IsNullOrEmpty(drop.itemId) || drop.quantity <= 0)
                        throw new ArgumentException("公库应收掉落必须指定物品和正数量。");
            }
            if (value.encounters[0].waitBefore != 0)
                throw new ArgumentException("首场 waitBefore 必须为 0；场间 WAIT 仅作用于后续遭遇。");
        }

        private static CombatExperienceGrant[] DivideExperience(CombatSnapshot start, string team, int pool)
        {
            var roster = new List<CombatUnitSnapshot>();
            foreach (CombatUnitSnapshot unit in start.units) if (unit.team == team) roster.Add(unit);
            var grants = new CombatExperienceGrant[roster.Count];
            for (int i = 0; i < grants.Length; i++)
                grants[i] = new CombatExperienceGrant
                {
                    unitId = roster[i].id,
                    amount = pool / roster.Count + (i < pool % roster.Count ? 1 : 0)
                };
            return grants;
        }

        private static CombatSnapshot PartySnapshot(CombatSnapshot source, string team)
        {
            CombatSnapshot copy = CombatSession.CopySnapshot(source);
            var party = new List<CombatUnitSnapshot>();
            foreach (CombatUnitSnapshot unit in copy.units) if (unit.team == team) party.Add(unit);
            copy.units = party.ToArray();
            return copy;
        }

        private static CombatEncounterReport CopyRecord(CombatEncounterReport source)
        {
            return new CombatEncounterReport
            {
                resultId = source.resultId, expeditionId = source.expeditionId, encounterId = source.encounterId,
                scenarioId = source.scenarioId, encounterIndex = source.encounterIndex,
                betweenBattleWait = source.betweenBattleWait,
                previousBattleEnd = source.previousBattleEnd == null ? null : CombatSession.CopySnapshot(source.previousBattleEnd),
                afterIntermission = CombatSession.CopySnapshot(source.afterIntermission),
                battleStart = CombatSession.CopySnapshot(source.battleStart),
                battleEnd = CombatSession.CopySnapshot(source.battleEnd), outcome = source.outcome,
                winnerTeam = source.winnerTeam, stopReason = source.stopReason,
                executedActionCount = source.executedActionCount, steps = CopySteps(source.steps),
                rewardsEligible = source.rewardsEligible, experience = CopyExperience(source.experience),
                publicCash = source.publicCash, publicDrops = CopyLoot(source.publicDrops)
            };
        }

        private static CombatStepResult[] CopySteps(CombatStepResult[] source)
        {
            if (source == null) return Array.Empty<CombatStepResult>();
            var values = new CombatStepResult[source.Length];
            for (int i = 0; i < values.Length; i++) values[i] = CombatSession.CopyStep(source[i]);
            return values;
        }

        private static CombatExperienceGrant[] CopyExperience(CombatExperienceGrant[] source)
        {
            if (source == null) return Array.Empty<CombatExperienceGrant>();
            var values = new CombatExperienceGrant[source.Length];
            for (int i = 0; i < values.Length; i++)
                values[i] = new CombatExperienceGrant { unitId = source[i].unitId, amount = source[i].amount };
            return values;
        }

        private static CombatLootStack[] CopyLoot(CombatLootStack[] source)
        {
            if (source == null) return Array.Empty<CombatLootStack>();
            var values = new CombatLootStack[source.Length];
            for (int i = 0; i < values.Length; i++)
                values[i] = new CombatLootStack { itemId = source[i].itemId, quantity = source[i].quantity };
            return values;
        }
    }
}
