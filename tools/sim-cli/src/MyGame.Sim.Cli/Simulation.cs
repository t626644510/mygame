using Prototype.Combat;

namespace MyGame.Sim.Cli;

public static class Simulation
{
    public static object Catalog() => new
    {
        schemaVersion = 1,
        conditions = CombatTacticsCatalog.GetConditions(),
        selectors = CombatTacticsCatalog.GetSelectors(),
        scopes = CombatTacticsCatalog.GetScopes(),
        operations = CombatTacticsCatalog.GetOperations(),
        groupings = CombatTacticsCatalog.GetGroupings(),
        subjects = CombatTacticsCatalog.GetSubjects(),
        effectKinds = CombatTacticsCatalog.GetEffectKinds(),
        statusKinds = CombatTacticsCatalog.GetStatusKinds(),
        targetModes = CombatTacticsCatalog.GetTargetModes(),
        damageTypes = CombatTacticsCatalog.GetDamageTypes(),
        combatBonusFields = new[] { new { id = "equipmentDamageBonus", label = "装备伤害加值", source = "CombatUnitConfig.equipmentDamageBonus" } }
    };

    public static ValidationResult Validate(CombatScenario scenario)
    {
        try
        {
            var session = new CombatSession(scenario);
            return new ValidationResult(true, "", session.GetSnapshot().units.Select(unit => new
            {
                unit.id, unit.instructionCapacity, unit.conditionTermCapacity,
                instructions = unit.instructions.Select(instruction => new
                {
                    instruction.id, instruction.display, instruction.capacityAllowed,
                    instruction.actionAvailable, instruction.validationReason
                }).ToArray()
            }).ToArray());
        }
        catch (ArgumentException error) { return new ValidationResult(false, error.Message, Array.Empty<object>()); }
    }

    public static CombatRunResult Run(CombatScenario scenario, int maxSteps = 10000, double maxWait = 100000) =>
        new CombatSession(scenario).RunToCompletion(maxSteps, maxWait);

    public static CombatExpeditionReport Expedition(CombatExpeditionConfig config) =>
        new CombatExpeditionSession(config).RunToEnd();

    public static CombatComparisonReport Compare(CombatScenario baseline, CombatScenario variant) =>
        CombatSampleRuns.CompareScenarios(baseline, variant);

    public static void Selftest(string repository, string output)
    {
        string root = Path.Combine(repository, "Game", "Assets", "StreamingAssets", "Prototype", "Combat");
        CombatScenario Read(string name) => UnityJson.Read<CombatScenario>(File.ReadAllText(Path.Combine(root, name)), true);
        var cases = new (string Name, CombatComparisonReport Report)[]
        {
            ("MEDITATION", CombatMageSamples.CompareMeditation(Read("round4_meditation.json"))),
            ("MEDITATION_RISK", CombatMageSamples.CompareMeditation(Read("round4_meditation_risk.json"), 0.35)),
            ("AREA", CombatMageSamples.CompareArea(Read("round4_area.json"))),
            ("CLEANSE", CombatMageSamples.CompareCleanse(Read("round4_cleanse.json"))),
            ("CONTROL", CombatMageSamples.CompareControl(Read("round4_control.json")))
        };
        foreach (var entry in cases)
        {
            string stem = Path.Combine(output, "ROUND4_" + entry.Name + "_REPORT");
            UnityJson.WriteReportJson(stem + ".json", entry.Report);
            UnityJson.WriteFile(stem + ".md", CombatMageSamples.FormatComparisonMarkdown(entry.Report));
        }
    }
}

public sealed record ValidationResult(bool ok, string error, object[] units);
