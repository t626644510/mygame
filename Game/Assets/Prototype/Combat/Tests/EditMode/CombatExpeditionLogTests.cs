using System;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Prototype.Combat.Tests
{
    public sealed class CombatExpeditionLogTests
    {
        private static CombatInstruction Attack(string id)
        {
            return new CombatInstruction { id = id, actionId = "hit", scope = "enemies",
                selector = "configured_order", condition = new CombatCondition { operation = "all",
                    terms = new[] { new CombatConditionTerm { kind = "always" } } } };
        }

        private static CombatScenario Scenario(string id)
        {
            return new CombatScenario { id = id, title = id, parameterNotice = "Test parameters only",
                seed = 42, playerTeam = "blue", alliesIncludeSelf = true,
                gridRows = 3, gridColumns = 3, maxUnitsPerTeam = 6,
                capacity = new CombatCapacityConfig { baseSlots = 1, slotsPerIntelligence = .1,
                    minimumSlots = 1, maximumSlots = 6, secondConditionAtIntelligence = 20,
                    thirdConditionAtIntelligence = 40 },
                actions = new[] { new CombatActionConfig { id = "hit", displayName = "Hit",
                    effectKind = "damage", magnitude = 1, mpCost = 0, baseWait = 1 } },
                units = new[] {
                    new CombatUnitConfig { id = "hero", name = "Hero", team = "blue", hp = 100,
                        maxHp = 100, mp = 10, maxMp = 10, intelligence = 10, agilityFactor = 1,
                        initialReadyTime = 0, instructions = new[] { Attack("hero-attack") } },
                    new CombatUnitConfig { id = "enemy", name = "Enemy", team = "red", hp = 1,
                        maxHp = 1, mp = 0, maxMp = 0, intelligence = 10, agilityFactor = 1,
                        initialReadyTime = 10, instructions = new[] { Attack("enemy-attack") } }
                } };
        }

        private static CombatExpeditionConfig Config()
        {
            return new CombatExpeditionConfig { id = "log-expedition", carryTeam = "blue",
                encounters = new[] {
                    new CombatEncounterConfig { id = "first", scenario = Scenario("log-first"), publicCash = 1 },
                    new CombatEncounterConfig { id = "second", scenario = Scenario("log-second"), publicCash = 1 }
                } };
        }

        private static CombatExpeditionConfig Load(string name)
        {
            return JsonUtility.FromJson<CombatExpeditionConfig>(File.ReadAllText(Path.Combine(
                Application.streamingAssetsPath, "Prototype", "Combat", name)));
        }

        // Independent text oracle only. The observed text always comes directly from
        // ExportEncounterLogText on the tested expedition, never from this replay.
        private static string NativeCarryReplayOracle(CombatExpeditionConfig config, CombatEncounterReport record)
        {
            CombatEncounterConfig encounter = config.encounters[record.encounterIndex - 1];
            CombatScenario scenario = CombatSession.CopyScenario(encounter.scenario);
            if (string.IsNullOrEmpty(scenario.playerTeam)) scenario.playerTeam = config.carryTeam;
            CombatSession oracle = record.previousBattleEnd == null ? new CombatSession(scenario)
                : new CombatSession(scenario, record.previousBattleEnd, config.carryTeam, encounter.waitBefore);
            Assert.That(JsonUtility.ToJson(oracle.GetSnapshot()), Is.EqualTo(JsonUtility.ToJson(record.battleStart)));
            CombatRunResult run = oracle.RunToCompletion(config.maxStepsPerBattle, config.maxWaitPerBattle);
            Assert.That(JsonUtility.ToJson(run.snapshot), Is.EqualTo(JsonUtility.ToJson(record.battleEnd)));
            Assert.That(run.steps.Select(step => JsonUtility.ToJson(step)),
                Is.EqualTo(record.steps.Select(step => JsonUtility.ToJson(step))));
            return oracle.ExportLogText();
        }

        [TestCase(0)]
        [TestCase(-1)]
        [TestCase(3)]
        public void OutOfConfigurationIndex_ThrowsAtEveryExecutionStage(int index)
        {
            var session = new CombatExpeditionSession(Config());
            Assert.Throws<ArgumentOutOfRangeException>(() => session.ExportEncounterLogText(index));
            session.RunNextEncounter();
            Assert.Throws<ArgumentOutOfRangeException>(() => session.ExportEncounterLogText(index));
            session.RunToEnd();
            Assert.Throws<ArgumentOutOfRangeException>(() => session.ExportEncounterLogText(index));
        }

        [TestCase(1)]
        [TestCase(2)]
        public void ConfiguredButUnrecordedIndex_ThrowsWithoutAdvancing(int index)
        {
            var session = new CombatExpeditionSession(Config());
            string before = JsonUtility.ToJson(session.GetReport());
            Assert.Throws<InvalidOperationException>(() => session.ExportEncounterLogText(index));
            Assert.That(JsonUtility.ToJson(session.GetReport()), Is.EqualTo(before));
            Assert.That(session.GetReport().encounters, Is.Empty);
        }

        [Test]
        public void RecordedLog_RemainsCachedDuringProgressAndRepeatedCompletion()
        {
            var session = new CombatExpeditionSession(Config());
            CombatEncounterReport first = session.RunNextEncounter();
            string before = JsonUtility.ToJson(session.GetReport());
            string text = session.ExportEncounterLogText(1);
            Assert.That(text, Does.StartWith("COMBAT_LOG_V1\nscenario=log-first\n"));
            Assert.That(session.ExportEncounterLogText(1), Is.SameAs(text));
            Assert.Throws<InvalidOperationException>(() => session.ExportEncounterLogText(2));
            first.steps[0].message = "caller changed a copied record";
            first.battleEnd.units[0].hp = 1;
            Assert.That(session.ExportEncounterLogText(1), Is.SameAs(text));
            Assert.That(JsonUtility.ToJson(session.GetReport()), Is.EqualTo(before));
            session.RunNextEncounter();
            string second = session.ExportEncounterLogText(2);
            string settled = JsonUtility.ToJson(session.GetReport());
            Assert.That(session.RunNextEncounter(), Is.Null);
            Assert.That(JsonUtility.ToJson(session.RunToEnd()), Is.EqualTo(settled));
            Assert.That(JsonUtility.ToJson(session.RunToEnd()), Is.EqualTo(settled));
            Assert.That(session.ExportEncounterLogText(1), Is.SameAs(text));
            Assert.That(session.ExportEncounterLogText(2), Is.SameAs(second));
        }

        [Test]
        public void SeparateExpeditions_DoNotShareRecordedLogsOrProgress()
        {
            var first = new CombatExpeditionSession(Config());
            CombatExpeditionConfig otherConfig = Config();
            otherConfig.encounters[0].scenario.id = "other-first";
            var second = new CombatExpeditionSession(otherConfig);
            first.RunToEnd();
            string firstText = first.ExportEncounterLogText(1);
            Assert.Throws<InvalidOperationException>(() => second.ExportEncounterLogText(1));
            Assert.That(second.GetReport().encounters, Is.Empty);
            second.RunToEnd();
            Assert.That(second.ExportEncounterLogText(1), Does.Contain("scenario=other-first\n"));
            Assert.That(second.ExportEncounterLogText(1), Is.Not.EqualTo(firstText));
            Assert.That(first.ExportEncounterLogText(1), Is.SameAs(firstText));
        }

        [TestCase("Defeat")]
        [TestCase("EventBudget")]
        [TestCase("WaitBudget")]
        [TestCase("Stalemate")]
        public void EarlyTermination_RecordedLogIsReadableButTheNextEncounterIsNot(string kind)
        {
            CombatExpeditionConfig config = Config();
            CombatScenario opening = config.encounters[0].scenario;
            if (kind == "Defeat")
            {
                opening.units[0].hp = 1;
                opening.units[0].initialReadyTime = 10;
                opening.units[1].initialReadyTime = 0;
            }
            else if (kind == "EventBudget")
            {
                opening.units[1].hp = opening.units[1].maxHp = 20;
                config.maxStepsPerBattle = 1;
            }
            else if (kind == "WaitBudget")
            {
                opening.units[0].initialReadyTime = 10;
                config.maxWaitPerBattle = 1;
            }
            else
                foreach (CombatUnitConfig unit in opening.units) unit.instructions = new CombatInstruction[0];
            var session = new CombatExpeditionSession(config);
            CombatExpeditionReport report = session.RunToEnd();
            Assert.That(report.encounters.Length, Is.EqualTo(1));
            Assert.That(report.finished, Is.True);
            Assert.That(report.encounters[0].outcome, Is.EqualTo(
                kind == "Defeat" ? "Defeat" : kind == "Stalemate" ? "Stalemate" : "Stopped"));
            if (kind == "EventBudget" || kind == "WaitBudget")
                Assert.That(report.encounters[0].stopReason, Is.EqualTo(
                    kind == "EventBudget" ? "EventBudgetExceeded" : "WaitBudgetExceeded"));
            string before = JsonUtility.ToJson(report);
            string text = session.ExportEncounterLogText(1);
            Assert.That(text, Does.Contain("outcome=" + report.encounters[0].outcome));
            Assert.That(text, Is.EqualTo(NativeCarryReplayOracle(config, report.encounters[0])));
            Assert.Throws<InvalidOperationException>(() => session.ExportEncounterLogText(2));
            Assert.That(session.RunNextEncounter(), Is.Null);
            Assert.That(JsonUtility.ToJson(session.RunToEnd()), Is.EqualTo(before));
            Assert.That(session.ExportEncounterLogText(1), Is.SameAs(text));
        }

        [TestCase("round2_expedition.json")]
        [TestCase("round4_expedition.json")]
        public void ActualExpeditions_InterleavedReadsMatchBatchNativeLogsAndPreserveCarry(string name)
        {
            CombatExpeditionConfig config = Load(name);
            string input = JsonUtility.ToJson(config);
            var manual = new CombatExpeditionSession(config);
            var batch = new CombatExpeditionSession(config);
            CombatExpeditionReport batchReport = batch.RunToEnd();
            for (int index = 1; index <= config.encounters.Length; index++)
            {
                CombatEncounterReport record = manual.RunNextEncounter();
                Assert.That(record, Is.Not.Null);
                string before = JsonUtility.ToJson(manual.GetReport());
                string text = manual.ExportEncounterLogText(index);
                Assert.That(text, Is.EqualTo(batch.ExportEncounterLogText(index)));
                Assert.That(manual.ExportEncounterLogText(index), Is.SameAs(text));
                Assert.That(text, Is.EqualTo(NativeCarryReplayOracle(config, record)));
                Assert.That(JsonUtility.ToJson(manual.GetReport()), Is.EqualTo(before));
                if (index < config.encounters.Length)
                    Assert.Throws<InvalidOperationException>(() => manual.ExportEncounterLogText(index + 1));
            }
            CombatExpeditionReport manualReport = manual.GetReport();
            Assert.That(JsonUtility.ToJson(manualReport), Is.EqualTo(JsonUtility.ToJson(batchReport)));
            CombatEncounterReport first = manualReport.encounters[0];
            CombatEncounterReport second = manualReport.encounters[1];
            Assert.That(second.battleStart.time, Is.EqualTo(first.battleEnd.time + second.betweenBattleWait));
            foreach (CombatUnitSnapshot before in first.battleEnd.units.Where(unit => unit.team == config.carryTeam))
            {
                CombatUnitSnapshot after = second.battleStart.units.Single(unit => unit.id == before.id);
                Assert.That(after.hp, Is.EqualTo(before.hp));
                Assert.That(after.mp, Is.EqualTo(before.mp));
                Assert.That(after.nextActionTime, Is.EqualTo(Math.Max(second.battleStart.time, before.nextActionTime)));
                Assert.That(after.statuses.Select(status => JsonUtility.ToJson(status)), Is.EqualTo(
                    before.statuses.Where(status => status.expiresAt > second.battleStart.time)
                        .Select(status => JsonUtility.ToJson(status))));
            }
            Assert.That(JsonUtility.ToJson(config), Is.EqualTo(input));
        }

        [Test]
        public void CarryConstructionException_DoesNotAppendAnUnexecutedLogOrRecord()
        {
            CombatExpeditionConfig config = Config();
            config.maxWaitPerBattle = double.MaxValue;
            config.encounters[0].scenario.maxWait = double.MaxValue;
            config.encounters[0].scenario.units[0].initialReadyTime = double.MaxValue / 2;
            config.encounters[0].scenario.units[1].initialReadyTime = double.MaxValue * .75;
            config.encounters[0].scenario.actions[0].baseWait = double.MaxValue / 4;
            config.encounters[1].waitBefore = double.MaxValue;
            var session = new CombatExpeditionSession(config);
            Assert.That(session.RunNextEncounter().outcome, Is.EqualTo("Victory"));
            string text = session.ExportEncounterLogText(1);
            string before = JsonUtility.ToJson(session.GetReport());
            Assert.Throws<ArgumentException>(() => session.RunNextEncounter());
            Assert.Throws<InvalidOperationException>(() => session.ExportEncounterLogText(2));
            Assert.That(session.ExportEncounterLogText(1), Is.SameAs(text));
            Assert.That(JsonUtility.ToJson(session.GetReport()), Is.EqualTo(before));
            Assert.That(session.GetReport().encounters.Length, Is.EqualTo(1));
        }

        [Test]
        public void RewardAggregateOverflow_PreservesBothRecordedLogsWithoutCallingGetReport()
        {
            CombatExpeditionConfig config = Config();
            foreach (CombatEncounterConfig encounter in config.encounters) encounter.publicCash = int.MaxValue;
            var session = new CombatExpeditionSession(config);
            Assert.Throws<OverflowException>(() => session.RunToEnd());
            string first = session.ExportEncounterLogText(1);
            string second = session.ExportEncounterLogText(2);
            Assert.That(first, Does.Contain("scenario=log-first\n"));
            Assert.That(second, Does.Contain("scenario=log-second\n"));
            Assert.That(first, Does.Contain("outcome=Victory"));
            Assert.That(second, Does.Contain("outcome=Victory"));
            Assert.Throws<OverflowException>(() => session.GetReport());
            Assert.Throws<OverflowException>(() => session.RunToEnd());
            Assert.That(session.RunNextEncounter(), Is.Null);
            Assert.That(session.ExportEncounterLogText(1), Is.SameAs(first));
            Assert.That(session.ExportEncounterLogText(2), Is.SameAs(second));
        }
    }
}
