using System;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Prototype.Combat.Tests
{
    public sealed class CombatScenarioComparisonTests
    {
        private static CombatScenario Load(string name)
        {
            return JsonUtility.FromJson<CombatScenario>(File.ReadAllText(Path.Combine(
                Application.streamingAssetsPath, "Prototype", "Combat", name)));
        }

        private static CombatUnitConfig Unit(CombatScenario scenario, string id)
        {
            return scenario.units.Single(unit => unit.id == id);
        }

        private static void AssertJsonEqual(object actual, object expected)
        {
            Assert.That(JsonUtility.ToJson(actual), Is.EqualTo(JsonUtility.ToJson(expected)));
        }

        private static void AssertMatchesFreshSessions(CombatComparisonReport report,
            CombatScenario baseline, CombatScenario variant)
        {
            var left = new CombatSession(baseline);
            var right = new CombatSession(variant);
            AssertJsonEqual(report.baselineConfiguration, left.GetScenario());
            AssertJsonEqual(report.variantConfiguration, right.GetScenario());
            AssertJsonEqual(report.baseline, left.RunToCompletion());
            AssertJsonEqual(report.variant, right.RunToCompletion());
            Assert.That(report.onlyDeclaredSettingChanged, Is.False);
        }

        [TestCase("round2_ambush.json")]
        [TestCase("round2_pressure.json")]
        public void PrioritySwap_MatchesExistingFirstDivergenceImpactAndRuns(string name)
        {
            CombatScenario source = Load(name);
            string original = JsonUtility.ToJson(source);
            CombatScenario variant = CombatSession.CopyScenario(source);
            Array.Reverse(Unit(variant, "mage").instructions);

            CombatComparisonReport existing = CombatSampleRuns.ComparePriority(source);
            CombatComparisonReport report = CombatSampleRuns.CompareScenarios(source, variant);

            Assert.That(report.firstDivergence, Is.Not.Null);
            AssertJsonEqual(report.firstDivergence, existing.firstDivergence);
            Assert.That(report.observableImpact, Is.EqualTo(existing.observableImpact));
            AssertJsonEqual(report.baseline, existing.baseline);
            AssertJsonEqual(report.variant, existing.variant);
            Assert.That(existing.onlyDeclaredSettingChanged, Is.True);
            Assert.That(report.onlyDeclaredSettingChanged, Is.False);
            Assert.That(JsonUtility.ToJson(source), Is.EqualTo(original));
        }

        [Test]
        public void SameInputObject_UsesDefaultMetadataAndHasNoDivergence()
        {
            CombatScenario source = Load("round2_ambush.json");
            string original = JsonUtility.ToJson(source);

            CombatComparisonReport report = CombatSampleRuns.CompareScenarios(source, source);

            Assert.That(report.id, Is.EqualTo(source.id + ":compare"));
            Assert.That(report.baselineLabel, Is.EqualTo("baseline"));
            Assert.That(report.variantLabel, Is.EqualTo("variant"));
            Assert.That(report.changedSetting, Is.EqualTo(string.Empty));
            Assert.That(report.firstDivergence, Is.Null);
            AssertMatchesFreshSessions(report, source, source);
            AssertJsonEqual(report.baseline, report.variant);
            Assert.That(report.baseline, Is.Not.SameAs(report.variant));
            Assert.That(report.baselineConfiguration, Is.Not.SameAs(report.variantConfiguration));
            Assert.That(JsonUtility.ToJson(source), Is.EqualTo(original));
        }

        [Test]
        public void CustomMetadata_IsPreservedWithoutClaimingASingleSettingWasVerified()
        {
            CombatScenario baseline = Load("round2_ambush.json");
            CombatScenario variant = CombatSession.CopyScenario(baseline);
            variant.id = "other-scenario";

            CombatComparisonReport report = CombatSampleRuns.CompareScenarios(
                baseline, variant, "原配置", "另一个配置", "任意配置比较");

            Assert.That(report.id, Is.EqualTo(baseline.id + ":compare"));
            Assert.That(report.baselineLabel, Is.EqualTo("原配置"));
            Assert.That(report.variantLabel, Is.EqualTo("另一个配置"));
            Assert.That(report.changedSetting, Is.EqualTo("任意配置比较"));
            Assert.That(report.onlyDeclaredSettingChanged, Is.False);
            Assert.That(report.firstDivergence, Is.Null);
        }

        [Test]
        public void MultipleUnitsActionsAndSettings_AreAcceptedAndRunIndependently()
        {
            CombatScenario baseline = Load("round2_ambush.json");
            CombatScenario variant = CombatSession.CopyScenario(baseline);
            variant.id = "multiple-changes";
            variant.seed++;
            Unit(variant, "mage").mp = 18;
            Unit(variant, "mage").intelligence = 20;
            Array.Reverse(Unit(variant, "mage").instructions);
            Unit(variant, "ally").hp = 65;
            Unit(variant, "ally").equipmentDamageBonus = 5;
            Unit(variant, "enemy_low").hp = 36;
            Unit(variant, "enemy_low").initialReadyTime = 15;
            variant.actions.Single(action => action.id == "basic_attack").magnitude += 3;
            string originalBaseline = JsonUtility.ToJson(baseline);
            string originalVariant = JsonUtility.ToJson(variant);

            CombatComparisonReport report = CombatSampleRuns.CompareScenarios(baseline, variant);

            AssertMatchesFreshSessions(report, baseline, variant);
            Assert.That(report.firstDivergence, Is.Not.Null);
            Assert.That(report.firstDivergence.recordIndex, Is.EqualTo(1));
            Assert.That(JsonUtility.ToJson(baseline), Is.EqualTo(originalBaseline));
            Assert.That(JsonUtility.ToJson(variant), Is.EqualTo(originalVariant));
        }

        [TestCase("units")]
        [TestCase("actions")]
        [TestCase("instructions")]
        public void ConfigurationOrder_IsPreservedAndMatchesTheActualSession(string order)
        {
            CombatScenario baseline = Load("round2_time_tie.json");
            CombatScenario variant = CombatSession.CopyScenario(baseline);
            if (order == "units") Array.Reverse(variant.units);
            else if (order == "actions") Array.Reverse(variant.actions);
            else Array.Reverse(Unit(variant, "mage").instructions);
            string original = JsonUtility.ToJson(variant);

            CombatComparisonReport report = CombatSampleRuns.CompareScenarios(baseline, variant);

            AssertMatchesFreshSessions(report, baseline, variant);
            Assert.That(report.variantConfiguration.units.Select(unit => unit.id),
                Is.EqualTo(variant.units.Select(unit => unit.id)));
            Assert.That(report.variantConfiguration.actions.Select(action => action.id),
                Is.EqualTo(variant.actions.Select(action => action.id)));
            Assert.That(Unit(report.variantConfiguration, "mage").instructions.Select(rule => rule.id),
                Is.EqualTo(Unit(variant, "mage").instructions.Select(rule => rule.id)));
            Assert.That(JsonUtility.ToJson(variant), Is.EqualTo(original));
        }

        [TestCase("round2_ambush.json", "round4_mage_library.json")]
        [TestCase("round4_mage_library.json", "round2_ambush.json")]
        public void DifferentPartiesEnemiesAndPlayerTeams_UseEachBranchOwnConfiguration(
            string baselineName, string variantName)
        {
            CombatScenario baseline = Load(baselineName);
            CombatScenario variant = Load(variantName);
            variant.playerTeam = variant.units.First(unit => unit.team != baseline.playerTeam).team;
            string originalBaseline = JsonUtility.ToJson(baseline);
            string originalVariant = JsonUtility.ToJson(variant);

            CombatComparisonReport report = CombatSampleRuns.CompareScenarios(baseline, variant);

            Assert.That(baseline.units.Length, Is.Not.EqualTo(variant.units.Length));
            Assert.That(baseline.playerTeam, Is.Not.EqualTo(variant.playerTeam));
            AssertMatchesFreshSessions(report, baseline, variant);
            int baselineSurvivors = report.baseline.snapshot.units.Count(
                unit => unit.team == baseline.playerTeam && unit.hp > 0);
            int variantSurvivors = report.variant.snapshot.units.Count(
                unit => unit.team == variant.playerTeam && unit.hp > 0);
            Assert.That(report.observableImpact, Does.Contain("基线己方存活 " + baselineSurvivors +
                " 人，变体己方存活 " + variantSurvivors + " 人"));
            Assert.That(JsonUtility.ToJson(baseline), Is.EqualTo(originalBaseline));
            Assert.That(JsonUtility.ToJson(variant), Is.EqualTo(originalVariant));
        }

        [TestCase(false)]
        [TestCase(true)]
        public void UnequalTraceLengths_ReportTheFirstMissingRecord(bool limitBaseline)
        {
            CombatScenario full = Load("round2_ambush.json");
            CombatScenario limited = CombatSession.CopyScenario(full);
            limited.maxEvents = 1;
            CombatScenario baseline = limitBaseline ? limited : full;
            CombatScenario variant = limitBaseline ? full : limited;

            CombatComparisonReport report = CombatSampleRuns.CompareScenarios(baseline, variant);

            AssertMatchesFreshSessions(report, baseline, variant);
            Assert.That(report.firstDivergence.recordIndex, Is.EqualTo(2));
            Assert.That(limitBaseline ? report.firstDivergence.baseline : report.firstDivergence.variant,
                Is.Null);
            Assert.That(limitBaseline ? report.firstDivergence.variant : report.firstDivergence.baseline,
                Is.Not.Null);
            Assert.That((limitBaseline ? report.baseline : report.variant).stopReason,
                Is.EqualTo("EventBudgetExceeded"));
        }

        [Test]
        public void ReturnedConfigurations_AreDeepCopiesIndependentOfInputsAndEachOther()
        {
            CombatScenario source = Load("round2_ambush.json");
            source.units[0].tags = new[] { "original-tag" };
            source.units[0].statuses = new[] { new CombatStatusConfig {
                id = "initial-guard", kind = "guard", magnitude = 2, appliedAt = 0, expiresAt = 10 } };
            string original = JsonUtility.ToJson(source);

            CombatComparisonReport report = CombatSampleRuns.CompareScenarios(source, source);

            Assert.That(JsonUtility.ToJson(source), Is.EqualTo(original));
            AssertMatchesFreshSessions(report, source, source);
            CombatScenario left = report.baselineConfiguration;
            CombatScenario right = report.variantConfiguration;
            Assert.That(left, Is.Not.SameAs(source));
            Assert.That(right, Is.Not.SameAs(source));
            Assert.That(left.capacity, Is.Not.SameAs(right.capacity));
            Assert.That(left.units[0], Is.Not.SameAs(right.units[0]));
            Assert.That(left.units[0].instructions[0].condition.terms[0],
                Is.Not.SameAs(right.units[0].instructions[0].condition.terms[0]));
            Assert.That(left.units[0].statuses[0], Is.Not.SameAs(right.units[0].statuses[0]));
            Assert.That(left.units[0].tags, Is.Not.SameAs(right.units[0].tags));
            Assert.That(left.actions[0], Is.Not.SameAs(right.actions[0]));
            string originalReport = JsonUtility.ToJson(report);

            source.capacity.baseSlots++;
            source.units[0].hp = 1;
            source.units[0].instructions[0].condition.terms[0].threshold = .9;
            source.units[0].statuses[0].magnitude = 99;
            source.units[0].tags[0] = "input-edited";
            source.actions[0].magnitude++;
            Assert.That(JsonUtility.ToJson(report), Is.EqualTo(originalReport));

            string editedInput = JsonUtility.ToJson(source);
            string originalRight = JsonUtility.ToJson(right);
            string originalBaselineRun = JsonUtility.ToJson(report.baseline);
            string originalVariantRun = JsonUtility.ToJson(report.variant);
            left.capacity.baseSlots++;
            left.units[0].hp = 2;
            left.units[0].instructions[0].condition.terms[0].threshold = .8;
            left.units[0].statuses[0].magnitude = 50;
            left.units[0].tags[0] = "report-edited";
            left.actions[0].magnitude++;
            Assert.That(JsonUtility.ToJson(right), Is.EqualTo(originalRight));
            Assert.That(JsonUtility.ToJson(source), Is.EqualTo(editedInput));
            Assert.That(JsonUtility.ToJson(report.baseline), Is.EqualTo(originalBaselineRun));
            Assert.That(JsonUtility.ToJson(report.variant), Is.EqualTo(originalVariantRun));
        }

        [Test]
        public void LegacyAndExplicitEmptyActionAvailability_UseSessionNormalization()
        {
            CombatScenario baseline = Load("round2_ambush.json");
            CombatScenario variant = CombatSession.CopyScenario(baseline);
            Unit(baseline, "mage").availableActionIds = new string[0];
            Unit(baseline, "mage").availableActionIdsExplicit = true;
            Unit(variant, "mage").availableActionIds = null;
            Unit(variant, "mage").availableActionIdsExplicit = false;
            string originalBaseline = JsonUtility.ToJson(baseline);
            string originalVariant = JsonUtility.ToJson(variant);

            CombatComparisonReport report = CombatSampleRuns.CompareScenarios(baseline, variant);

            AssertMatchesFreshSessions(report, baseline, variant);
            Assert.That(Unit(report.baselineConfiguration, "mage").availableActionIds, Is.Empty);
            Assert.That(Unit(report.variantConfiguration, "mage").availableActionIds,
                Is.EqualTo(new[] { "first_aid", "basic_attack" }));
            Assert.That(Unit(report.variantConfiguration, "mage").availableActionIdsExplicit, Is.True);
            Assert.That(report.firstDivergence, Is.Not.Null);
            Assert.That(JsonUtility.ToJson(baseline), Is.EqualTo(originalBaseline));
            Assert.That(JsonUtility.ToJson(variant), Is.EqualTo(originalVariant));
        }

        [TestCase(false)]
        [TestCase(true)]
        public void InvalidScenario_PropagatesSessionValidationWithoutChangingInputs(bool invalidBaseline)
        {
            CombatScenario valid = Load("round2_ambush.json");
            CombatScenario invalid = CombatSession.CopyScenario(valid);
            invalid.units[1].id = invalid.units[0].id;
            string originalValid = JsonUtility.ToJson(valid);
            string originalInvalid = JsonUtility.ToJson(invalid);
            ArgumentException expected = Assert.Throws<ArgumentException>(() => new CombatSession(invalid));

            ArgumentException actual = Assert.Throws<ArgumentException>(() => CombatSampleRuns.CompareScenarios(
                invalidBaseline ? invalid : valid, invalidBaseline ? valid : invalid));

            Assert.That(actual.Message, Is.EqualTo(expected.Message));
            Assert.That(JsonUtility.ToJson(valid), Is.EqualTo(originalValid));
            Assert.That(JsonUtility.ToJson(invalid), Is.EqualTo(originalInvalid));
        }
    }
}
