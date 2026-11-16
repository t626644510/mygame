using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using System.Text;

namespace Prototype.Combat
{
    [Serializable]
    public sealed class CombatFirstDivergence
    {
        public int recordIndex;
        public CombatStepResult baseline;
        public CombatStepResult variant;
        public string description;
    }

    [Serializable]
    public sealed class CombatComparisonReport
    {
        public string id;
        public string baselineLabel;
        public string variantLabel;
        public string changedSetting;
        public bool onlyDeclaredSettingChanged;
        public CombatScenario baselineConfiguration;
        public CombatScenario variantConfiguration;
        public CombatRunResult baseline;
        public CombatRunResult variant;
        public CombatFirstDivergence firstDivergence;
        public string observableImpact;
    }

    /// <summary>
    /// Reproducible, single-setting experiments against the actual CombatSession.
    /// Loading JSON, presenting UI and posting rewards stay with integration.
    /// </summary>
    public static class CombatSampleRuns
    {
        public static CombatComparisonReport CompareScenarios(
            CombatScenario baseline, CombatScenario variant,
            string baselineLabel = "baseline", string variantLabel = "variant",
            string changedSetting = "")
        {
            var baselineSession = new CombatSession(baseline);
            var variantSession = new CombatSession(variant);
            CombatScenario baselineConfig = baselineSession.GetScenario();
            CombatScenario variantConfig = variantSession.GetScenario();
            CombatRunResult baselineRun = baselineSession.RunToCompletion();
            CombatRunResult variantRun = variantSession.RunToCompletion();
            CombatFirstDivergence difference = FirstDivergence(baselineRun.steps, variantRun.steps);
            return new CombatComparisonReport
            {
                id = baseline.id + ":compare", baselineLabel = baselineLabel, variantLabel = variantLabel,
                changedSetting = changedSetting, onlyDeclaredSettingChanged = false,
                baselineConfiguration = baselineConfig, variantConfiguration = variantConfig,
                baseline = baselineRun, variant = variantRun, firstDivergence = difference,
                observableImpact = Impact(baselineRun, variantRun, baselineConfig, variantConfig, difference)
            };
        }

        public static CombatComparisonReport ComparePriority(CombatScenario source, string unitId = "mage",
            int fromIndex = 1, int toIndex = 0)
        {
            var left = new CombatSession(source);
            var right = new CombatSession(source);
            CombatEditResult edit = right.MoveInstruction(unitId, fromIndex, toIndex);
            if (!edit.success) throw new ArgumentException(edit.message);
            CombatScenario baseline = left.GetScenario();
            CombatScenario variant = right.GetScenario();
            CombatScenario normalized = CombatSession.CopyScenario(variant);
            CombatUnitConfig baseUnit = FindUnit(baseline, unitId);
            CombatUnitConfig changedUnit = FindUnit(normalized, unitId);
            bool sameRules = SameRulesIgnoringOrder(baseUnit.instructions, changedUnit.instructions);
            changedUnit.instructions = FindUnit(CombatSession.CopyScenario(baseline), unitId).instructions;
            return RunComparison(source.id + ":priority", "急救优先", "进攻优先",
                "仅调整 " + unitId + " 的指令优先级（" + fromIndex + " → " + toIndex + "）；指令内容不变",
                sameRules && Equivalent(baseline, normalized), left, right);
        }

        public static CombatComparisonReport CompareIntelligenceCapacity(CombatScenario source,
            string unitId = "mage", int lowIntelligence = 10, int highIntelligence = 20)
        {
            CombatScenario baseline = CombatSession.CopyScenario(source);
            CombatScenario variant = CombatSession.CopyScenario(source);
            FindUnit(baseline, unitId).intelligence = lowIntelligence;
            FindUnit(variant, unitId).intelligence = highIntelligence;
            CombatScenario normalized = CombatSession.CopyScenario(variant);
            FindUnit(normalized, unitId).intelligence = lowIntelligence;
            return RunComparison(source.id + ":capacity", "低智力／两条容量", "高智力／三条容量",
                "仅修改 " + unitId + ".intelligence：" + lowIntelligence + " → " + highIntelligence +
                "；HP、MP、技能伤害、装备和完整指令清单均不变",
                Equivalent(baseline, normalized), new CombatSession(baseline), new CombatSession(variant));
        }

        public static CombatComparisonReport CompareEquipment(CombatScenario source,
            string unitId = "mage", int addedDamage = 9)
        {
            CombatScenario baseline = CombatSession.CopyScenario(source);
            CombatScenario variant = CombatSession.CopyScenario(source);
            CombatUnitConfig original = FindUnit(baseline, unitId);
            checked { FindUnit(variant, unitId).equipmentDamageBonus += addedDamage; }
            CombatScenario normalized = CombatSession.CopyScenario(variant);
            FindUnit(normalized, unitId).equipmentDamageBonus = original.equipmentDamageBonus;
            return RunComparison(source.id + ":equipment", "强化前", "强化后",
                "仅修改 " + unitId + ".equipmentDamageBonus：" + original.equipmentDamageBonus + " → " +
                FindUnit(variant, unitId).equipmentDamageBonus + "；装备来源标识、队伍状态、敌人和种子不变",
                Equivalent(baseline, normalized), new CombatSession(baseline), new CombatSession(variant));
        }

        public static string FormatComparisonMarkdown(CombatComparisonReport report)
        {
            if (report == null) throw new ArgumentNullException(nameof(report));
            var text = new StringBuilder();
            text.Append("# ").Append(report.baselineConfiguration.title).Append("\n\n")
                .Append("本文件由实际 CombatSession 运行结果生成。全部数值均为第二轮试玩参数，未完成平衡。\n\n")
                .Append("- 配置：`").Append(report.baselineConfiguration.id).Append("`\n")
                .Append("- 固定种子：").Append(report.baselineConfiguration.seed).Append("；本轮没有随机抽样。\n")
                .Append("- 唯一改动：").Append(report.changedSetting).Append("。\n")
                .Append("- 除声明项外配置逐字段相同：**").Append(report.onlyDeclaredSettingChanged ? "是" : "否").Append("**。\n\n");
            text.Append("## 开局与配置证据\n\n")
                .Append("|角色|队伍|HP|MP|智力（基线／变体）|伤害装备加值（基线／变体）|初始行动WAIT|\n|---|---|---:|---:|---:|---:|---:|\n");
            foreach (CombatUnitConfig unit in report.baselineConfiguration.units)
            {
                CombatUnitConfig variant = FindUnit(report.variantConfiguration, unit.id);
                text.Append('|').Append(unit.id).Append('|').Append(unit.team).Append('|').Append(unit.hp).Append('/').Append(unit.maxHp)
                    .Append('|').Append(unit.mp).Append('/').Append(unit.maxMp).Append('|').Append(unit.intelligence).Append('/').Append(variant.intelligence)
                    .Append('|').Append(unit.equipmentDamageBonus).Append('/').Append(variant.equipmentDamageBonus)
                    .Append('|').Append(Number(unit.initialReadyTime)).Append("|\n");
            }
            foreach (CombatUnitConfig unit in report.baselineConfiguration.units)
            {
                CombatUnitConfig variant = FindUnit(report.variantConfiguration, unit.id);
                if (!Equivalent(unit.instructions, variant.instructions))
                    text.Append("\n").Append(unit.id).Append(" 指令顺序：基线 `").Append(RuleOrder(unit.instructions))
                        .Append("`；变体 `").Append(RuleOrder(variant.instructions)).Append("`。\n");
                if (unit.intelligence != variant.intelligence)
                {
                    text.Append("\n").Append(unit.id).Append(" 每条指令的条件项数保持为：");
                    foreach (CombatInstruction rule in unit.instructions)
                        text.Append(rule.condition == null || rule.condition.terms == null ? 0 : rule.condition.terms.Length).Append(' ');
                    text.Append("。本例各条均仅用一个条件项，额外条件项解锁没有参与战果差异。\n");
                }
            }
            text.Append("\n|行动|效果|基础量|MP费用|基础WAIT|\n|---|---|---:|---:|---:|\n");
            foreach (CombatActionConfig action in report.baselineConfiguration.actions)
                text.Append('|').Append(action.id).Append('|').Append(action.effectKind).Append('|').Append(action.magnitude)
                    .Append('|').Append(action.mpCost).Append('|').Append(Number(action.baseWait)).Append("|\n");
            text.Append("\n## 第一次行动分歧\n\n");
            if (report.firstDivergence == null) text.Append("两次轨迹没有行动分歧。\n");
            else text.Append("记录 #").Append(report.firstDivergence.recordIndex).Append("：\n\n- ")
                .Append(report.baselineLabel).Append("：").Append(DescribeStep(report.firstDivergence.baseline)).Append("\n- ")
                .Append(report.variantLabel).Append("：").Append(DescribeStep(report.firstDivergence.variant)).Append("\n");
            text.Append("\n## 战果与实际消耗\n\n|分支|结局|停止原因|结束WAIT|已执行行动|己方存活|战后HP／MP|\n|---|---|---|---:|---:|---:|---|\n");
            AppendOutcome(text, report.baselineLabel, report.baseline, PlayerTeam(report.baselineConfiguration));
            AppendOutcome(text, report.variantLabel, report.variant, PlayerTeam(report.variantConfiguration));
            text.Append("\n").Append(report.observableImpact).Append("\n");
            AppendTrajectory(text, report.baselineLabel, report.baseline.steps);
            AppendTrajectory(text, report.variantLabel, report.variant.steps);
            return text.ToString();
        }

        public static string FormatExpeditionMarkdown(CombatExpeditionReport report)
        {
            if (report == null) throw new ArgumentNullException(nameof(report));
            var text = new StringBuilder();
            text.Append("# 连续两场出征实跑\n\n全部数值与奖励规则为第二轮试玩假设；报告不实际写入公库或角色经验。\n\n")
                .Append("出征 `").Append(report.expeditionId).Append("`；停止原因 `").Append(report.stopReason).Append("`。\n\n")
                .Append("经验样例：仅胜利时，将经验池均分给本次出场队伍全体成员（含倒下者）；余数按配置顺序分配。败北、平局、僵局、预算停止不产生该场奖励，既有场次奖励仍保留。\n");
            foreach (CombatEncounterReport battle in report.encounters)
            {
                text.Append("\n## 第 ").Append(battle.encounterIndex).Append(" 场：").Append(battle.encounterId).Append("\n\n")
                    .Append("结算标识 `").Append(battle.resultId).Append("`；结局 **").Append(battle.outcome)
                    .Append("**；停止原因 `").Append(battle.stopReason).Append("`。\n\n")
                    .Append("场间 WAIT：**").Append(Number(battle.betweenBattleWait)).Append("**；本场开始 ")
                    .Append(Number(battle.battleStart.time)).Append("，本场结束 ").Append(Number(battle.battleEnd.time)).Append("。\n\n");
                if (battle.previousBattleEnd != null)
                    AppendParty(text, "前场结束", battle.previousBattleEnd, report.carryTeam);
                AppendParty(text, "场间推进后（由实际跨场构造得到）", battle.afterIntermission, report.carryTeam);
                AppendParty(text, "本场开局", battle.battleStart, report.carryTeam);
                AppendParty(text, "本场结束", battle.battleEnd, report.carryTeam);
                text.Append("\n经验应收：");
                foreach (CombatExperienceGrant xp in battle.experience) text.Append(xp.unitId).Append('+').Append(xp.amount).Append(' ');
                text.Append("；公库现金应收 ").Append(battle.publicCash).Append("；公库掉落应收：");
                foreach (CombatLootStack drop in battle.publicDrops) text.Append(drop.itemId).Append('×').Append(drop.quantity).Append(' ');
                text.Append("。\n");
                AppendTrajectory(text, "本场实际", battle.steps);
            }
            text.Append("\n重复 GetReport 只复制这些稳定结算标识与既有结果，不推进时间、不重复发奖。公共账本接入时由工程按 resultId 去重入账。\n");
            return text.ToString();
        }

        internal static CombatComparisonReport RunComparison(string id, string baselineLabel, string variantLabel,
            string changedSetting, bool onlyDeclaredSettingChanged, CombatSession baselineSession, CombatSession variantSession)
        {
            if (!onlyDeclaredSettingChanged) throw new InvalidOperationException("对照出现声明项以外的配置变化。");
            CombatScenario baselineConfig = baselineSession.GetScenario();
            CombatScenario variantConfig = variantSession.GetScenario();
            CombatRunResult baseline = baselineSession.RunToCompletion();
            CombatRunResult variant = variantSession.RunToCompletion();
            CombatFirstDivergence difference = FirstDivergence(baseline.steps, variant.steps);
            return new CombatComparisonReport
            {
                id = id, baselineLabel = baselineLabel, variantLabel = variantLabel, changedSetting = changedSetting,
                onlyDeclaredSettingChanged = true, baselineConfiguration = baselineConfig, variantConfiguration = variantConfig,
                baseline = baseline, variant = variant, firstDivergence = difference,
                observableImpact = Impact(baseline, variant, baselineConfig, variantConfig, difference)
            };
        }

        private static CombatFirstDivergence FirstDivergence(CombatStepResult[] baseline, CombatStepResult[] variant)
        {
            int count = Math.Max(baseline.Length, variant.Length);
            for (int i = 0; i < count; i++)
            {
                CombatStepResult left = i < baseline.Length ? baseline[i] : null;
                CombatStepResult right = i < variant.Length ? variant[i] : null;
                if (DecisionEquivalent(left, right)) continue;
                return new CombatFirstDivergence
                {
                    recordIndex = i + 1, baseline = left == null ? null : CombatSession.CopyStep(left),
                    variant = right == null ? null : CombatSession.CopyStep(right),
                    description = DescribeStep(left) + " / " + DescribeStep(right)
                };
            }
            return null;
        }

        private static bool DecisionEquivalent(CombatStepResult left, CombatStepResult right)
        {
            if (left == null || right == null) return left == right;
            return left.time == right.time && left.status == right.status && left.actorId == right.actorId &&
                left.actionId == right.actionId && left.targetId == right.targetId && left.mpAfter == right.mpAfter &&
                Equivalent(left.effects, right.effects);
        }

        private static string Impact(CombatRunResult baseline, CombatRunResult variant,
            CombatScenario baselineConfig, CombatScenario variantConfig, CombatFirstDivergence difference)
        {
            var text = new StringBuilder("分歧后可观察的影响：基线首个倒下者为 ");
            text.Append(FirstCasualty(baseline.steps)).Append("；变体首个倒下者为 ").Append(FirstCasualty(variant.steps)).Append("。");
            if (difference != null)
            {
                AppendPreventedActions(text, difference.baseline, variant.steps, "基线", "变体");
                AppendPreventedActions(text, difference.variant, baseline.steps, "变体", "基线");
            }
            text.Append("基线己方存活 ").Append(Survivors(baseline.snapshot, PlayerTeam(baselineConfig)))
                .Append(" 人，变体己方存活 ").Append(Survivors(variant.snapshot, PlayerTeam(variantConfig)))
                .Append(" 人；完整轨迹列明治疗、伤害、死亡与后续行动，不以单步选择代替整场结果。");
            return text.ToString();
        }

        private static void AppendPreventedActions(StringBuilder text, CombatStepResult step,
            CombatStepResult[] other, string branch, string otherBranch)
        {
            if (step == null) return;
            foreach (CombatEffect effect in step.effects)
            {
                if (effect.hpBefore <= 0 || effect.hpAfter != 0) continue;
                int count = 0;
                foreach (CombatStepResult value in other)
                    if (value.actorId == effect.targetId && value.status == "Executed" && value.time >= step.time) count++;
                if (count == 0) continue;
                text.Append(branch).Append("在 WAIT ").Append(Number(step.time)).Append(" 击倒 ").Append(effect.targetId)
                    .Append("；").Append(otherBranch).Append("中该角色在该时刻及之后实际执行 ").Append(count).Append(" 次行动。");
            }
        }

        private static void AppendOutcome(StringBuilder text, string label, CombatRunResult run, string team)
        {
            text.Append('|').Append(label).Append('|').Append(run.outcome).Append('|').Append(run.stopReason)
                .Append('|').Append(Number(run.time)).Append('|').Append(run.executedActionCount).Append('|')
                .Append(Survivors(run.snapshot, team)).Append('|');
            foreach (CombatUnitSnapshot unit in run.snapshot.units)
                if (unit.team == team) text.Append(unit.id).Append(" HP ").Append(unit.hp).Append('/').Append(unit.maxHp)
                    .Append(" MP ").Append(unit.mp).Append('/').Append(unit.maxMp).Append("；");
            text.Append("|\n");
        }

        private static void AppendParty(StringBuilder text, string label, CombatSnapshot snapshot, string team)
        {
            text.Append("\n").Append(label).Append("（WAIT ").Append(Number(snapshot.time)).Append("）：\n\n")
                .Append("|角色|HP|MP|下次行动WAIT|仍有效状态（施加／到期）|\n|---|---:|---:|---:|---|\n");
            foreach (CombatUnitSnapshot unit in snapshot.units)
            {
                if (unit.team != team) continue;
                text.Append('|').Append(unit.id).Append('|').Append(unit.hp).Append('/').Append(unit.maxHp)
                    .Append('|').Append(unit.mp).Append('/').Append(unit.maxMp).Append('|').Append(Number(unit.nextActionTime)).Append('|');
                foreach (CombatStatusConfig status in unit.statuses ?? Array.Empty<CombatStatusConfig>())
                    text.Append(status.id).Append('(').Append(Number(status.appliedAt)).Append('/').Append(Number(status.expiresAt)).Append(") ");
                text.Append("|\n");
            }
        }

        private static void AppendTrajectory(StringBuilder text, string label, CombatStepResult[] steps)
        {
            text.Append("\n## ").Append(label).Append("轨迹\n\n|记录|WAIT|状态|行动者|行动／对象|效果及消耗|\n|---:|---:|---|---|---|---|\n");
            foreach (CombatStepResult step in steps)
            {
                text.Append('|').Append(step.index).Append('|').Append(Number(step.time)).Append('|').Append(step.status)
                    .Append('|').Append(step.actorId).Append('|').Append(step.actionId).Append(" → ").Append(step.targetId).Append('|');
                if (step.effects != null)
                    foreach (CombatEffect effect in step.effects)
                        text.Append(effect.targetId).Append(" HP ").Append(effect.hpBefore).Append("→").Append(effect.hpAfter).Append("；");
                if (step.status == "Executed") text.Append("MP ").Append(step.mpBefore).Append("→").Append(step.mpAfter);
                else text.Append((step.message ?? string.Empty).Replace('|', '/').Replace('\n', ' '));
                text.Append("|\n");
            }
        }

        private static string DescribeStep(CombatStepResult step)
        {
            if (step == null) return "该分支已结束，没有对应记录";
            var text = new StringBuilder("WAIT ").Append(Number(step.time)).Append("，").Append(step.actorId)
                .Append("，").Append(step.status).Append("，").Append(step.actionId).Append(" → ").Append(step.targetId);
            if (step.effects != null)
                foreach (CombatEffect effect in step.effects)
                    text.Append("；").Append(effect.targetId).Append(" HP ").Append(effect.hpBefore).Append("→").Append(effect.hpAfter);
            if (step.status != "Executed") text.Append("；").Append(step.message);
            return text.ToString();
        }

        private static string FirstCasualty(CombatStepResult[] steps)
        {
            foreach (CombatStepResult step in steps)
                foreach (CombatEffect effect in step.effects ?? Array.Empty<CombatEffect>())
                    if (effect.hpBefore > 0 && effect.hpAfter == 0) return effect.targetId + "（WAIT " + Number(step.time) + "）";
            return "无";
        }

        private static int Survivors(CombatSnapshot snapshot, string team)
        {
            int count = 0;
            foreach (CombatUnitSnapshot unit in snapshot.units) if (unit.team == team && unit.hp > 0) count++;
            return count;
        }

        private static bool SameRulesIgnoringOrder(CombatInstruction[] left, CombatInstruction[] right)
        {
            if (left.Length != right.Length) return false;
            var used = new bool[right.Length];
            foreach (CombatInstruction instruction in left)
            {
                bool found = false;
                for (int i = 0; i < right.Length; i++)
                    if (!used[i] && Equivalent(instruction, right[i])) { used[i] = true; found = true; break; }
                if (!found) return false;
            }
            return true;
        }

        // Structural comparison is only for these public-field, acyclic DTOs. This is not
        // a serializer or a second battle implementation, and cannot mutate configuration.
        internal static bool Equivalent(object left, object right)
        {
            if (left == null || right == null) return left == right;
            Type type = left.GetType();
            if (type != right.GetType()) return false;
            if (type.IsPrimitive || type.IsEnum || type == typeof(string) || type == typeof(decimal)) return left.Equals(right);
            Array leftArray = left as Array;
            if (leftArray != null)
            {
                Array rightArray = (Array)right;
                if (leftArray.Length != rightArray.Length) return false;
                for (int i = 0; i < leftArray.Length; i++) if (!Equivalent(leftArray.GetValue(i), rightArray.GetValue(i))) return false;
                return true;
            }
            foreach (FieldInfo field in type.GetFields(BindingFlags.Instance | BindingFlags.Public))
                if (!Equivalent(field.GetValue(left), field.GetValue(right))) return false;
            return true;
        }

        private static CombatUnitConfig FindUnit(CombatScenario scenario, string id)
        {
            foreach (CombatUnitConfig unit in scenario.units) if (unit.id == id) return unit;
            throw new ArgumentException("找不到角色：" + id);
        }

        private static string PlayerTeam(CombatScenario scenario)
        {
            return string.IsNullOrEmpty(scenario.playerTeam) ? scenario.units[0].team : scenario.playerTeam;
        }

        private static string RuleOrder(CombatInstruction[] rules)
        {
            var ids = new string[rules.Length];
            for (int i = 0; i < rules.Length; i++) ids[i] = rules[i] == null ? "null" : rules[i].id;
            return string.Join(" → ", ids);
        }

        private static string Number(double value) { return value.ToString("0.###############", CultureInfo.InvariantCulture); }
    }
}
