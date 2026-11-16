using System.Text.Json;
using System.Text.Json.Nodes;
using Prototype.Combat;

namespace MyGame.Sim.Cli;

public static class CombatRuns
{
    public static object Run(ContentProject project, JsonNode? input)
    {
        CombatAssemblyResult assembly = CombatAssembly.Build(project, input);
        if (assembly.kind == "expedition")
        {
            var expedition = new CombatExpeditionSession(UnityJson.Read<CombatExpeditionConfig>(assembly.config.ToJsonString()));
            CombatExpeditionReport report = expedition.RunToEnd();
            var logs = report.encounters.Select(record => new { record.encounterIndex, record.encounterId, record.scenarioId, logText = expedition.ExportEncounterLogText(record.encounterIndex) }).ToArray();
            return new { ok = true, kind = assembly.kind, result = report, logs, logText = string.Join("\n", logs.Select(log => log.logText)), assembly.bindings, assembly.ruleContexts, assembly.resolvedActions };
        }
        var session = new CombatSession(UnityJson.Read<CombatScenario>(assembly.config.ToJsonString()));
        CombatRunResult result = session.RunToCompletion(assembly.maxSteps, assembly.maxWait);
        return new { ok = true, kind = assembly.kind, result, logText = session.ExportLogText(), assembly.bindings, assembly.ruleContexts, assembly.resolvedActions };
    }
    public static object Compare(ContentProject project, JsonObject body)
    {
        if (body.Any(p => p.Key is not "baseline" and not "variant")) throw new ArgumentException("比较body只接受baseline和variant。");
        JsonObject baselineInput = CombatContent.Object(body["baseline"]);
        if (baselineInput.Count != 1 || CombatContent.Text(baselineInput["trialId"]) == "") throw new ArgumentException("baseline必须仅为{trialId}，从服务端磁盘读取已保存版本。");
        CombatAssemblyResult baseline = CombatAssembly.Build(project, baselineInput), variant = CombatAssembly.Build(project, body["variant"]);
        JsonObject First(CombatAssemblyResult value) => value.kind == "scenario" ? value.config : (JsonObject)((JsonObject)((JsonArray)value.config["encounters"]!)[0]!)["scenario"]!;
        CombatComparisonReport comparison = CombatSampleRuns.CompareScenarios(UnityJson.Read<CombatScenario>(First(baseline).ToJsonString()), UnityJson.Read<CombatScenario>(First(variant).ToJsonString()));
        return new { ok = true, comparison, scope = baseline.kind == "scenario" && variant.kind == "scenario" ? "single" : "first_encounter_only", baseline = baseline.Envelope(), variant = variant.Envelope(), bindings = variant.bindings };
    }
    public static object ExportScenario(ContentProject project, string trialId, string? output = null)
    {
        CombatAssemblyResult assembly = CombatAssembly.Build(project, new JsonObject { ["trialId"] = trialId });
        string file = output ?? project.Store.Resolve("_exports", trialId + ".json");
        byte[] bytes = UnityJson.Utf8.GetBytes(UnityJson.Serialize(assembly.config));
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(file))!);
        File.WriteAllBytes(file, bytes);
        return new { ok = true, path = output is null ? "_exports/" + trialId + ".json" : Path.GetFullPath(file), sha256 = CombatImport.Hash(bytes), assembly.kind };
    }

    public static object Character(ContentProject sourceProject, JsonObject body)
    {
        if (body.Any(p => p.Key is not "character" and not "overrides" and not "context")) throw new ArgumentException("角色校验body字段无效。");
        if (body["context"] is not null && body["context"] is not JsonObject) throw new ArgumentException("context必须是对象。");
        if (body["overrides"] is not null && body["overrides"] is not JsonObject) throw new ArgumentException("overrides必须是对象。");
        JsonObject character = CombatContent.Object(body["character"]);
        string id = CombatContent.Text(character["id"]);
        ContentProject project = CombatAssembly.Overrides(sourceProject, body["overrides"] as JsonObject);
        project = project.With("characters/" + id + ".json", "character", character);
        ContentValidation validation = project.Validate();
        if (!validation.ok) throw new ContentValidationException(validation);
        JsonObject? context = body["context"] as JsonObject;
        JsonObject rules; JsonObject? scene = null; object ruleContext;
        object[] resolvedActions = System.Array.Empty<object>();
        string unitId = "preview_actor";
        if (context is null)
        {
            var candidates = new List<(string TrialId, int Index)>();
            foreach (EntityDocument document in project.Documents.Values.Where(document => document.Type == "trial"))
            {
                JsonObject trial = document.Value;
                bool ally = CombatContent.Array(trial["allies"]).OfType<JsonObject>().Any(slot => project.Lookup(CombatContent.Text(slot["characterId"])).canonicalId == id);
                int index = 0;
                foreach (JsonObject stage in CombatContent.Array(trial["encounters"]).OfType<JsonObject>())
                {
                    index++;
                    JsonObject encounter = CombatContent.Entity(project, "encounter", CombatContent.Text(stage["encounterId"]));
                    if (ally || CombatContent.Array(encounter["enemies"]).OfType<JsonObject>().Any(slot => project.Lookup(CombatContent.Text(slot["characterId"])).canonicalId == id))
                        candidates.Add((CombatContent.Text(trial["id"]), index));
                }
            }
            candidates = candidates.Distinct().ToList();
            if (candidates.Count > 1) CombatContent.Fail("character/" + id, "/context", "context_required", "该角色有多个来源，请选择trial/场次：" + string.Join(", ", candidates.Select(c => c.TrialId + ":" + c.Index)));
            context = candidates.Count == 1 ? new JsonObject { ["trialId"] = candidates[0].TrialId, ["encounterIndex"] = candidates[0].Index } : new JsonObject { ["rules"] = CombatContent.Entity(project, "rule", "rules_combat").DeepClone() };
        }
        if (context["rules"] is JsonObject explicitRules)
        {
            if (context.Count != 1) throw new ArgumentException("显式rules与trial上下文互斥。");
            rules = explicitRules;
            var ruleErrors = CombatContent.Validate(new("inline/rules.json", "rule", rules), project);
            if (ruleErrors.Count != 0) throw new ContentValidationException(new(false, ruleErrors.ToArray(), System.Array.Empty<string>()));
            ruleContext = new { trialId = "", encounterIndex = 1, rulesId = CombatContent.Text(rules["id"]), origin = "inline", sourceName = "", sourceScenarioId = "character_preview", rules };
        }
        else
        {
            string trialId = CombatContent.Text(context["trialId"]);
            int index = CombatContent.Int(context["encounterIndex"]);
            if (trialId == "" || index < 1 || context.Any(p => p.Key is not "trialId" and not "encounterIndex")) throw new ArgumentException("角色context需要trialId和从1起的encounterIndex。");
            CombatAssemblyResult assembly = CombatAssembly.Build(project, new JsonObject { ["trialId"] = trialId }, true);
            if (index > assembly.ruleContexts.Length) CombatContent.Fail("character/" + id, "/context/encounterIndex", "context_range", "场次超出试炼范围。");
            ruleContext = assembly.ruleContexts[index - 1];
            resolvedActions = assembly.resolvedActions.Where(action => CombatContent.Int(((JsonObject)JsonSerializer.SerializeToNode(action)!)["encounterIndex"]) == index).ToArray();
            JsonObject serializedContext = (JsonObject)JsonSerializer.SerializeToNode(ruleContext)!;
            rules = (JsonObject)serializedContext["rules"]!;
            scene = CombatContent.Clone(assembly.kind == "scenario" ? assembly.config : (JsonObject)((JsonObject)((JsonArray)assembly.config["encounters"]!)[index - 1]!)["scenario"]!);
            JsonObject[] bindings = assembly.bindings.Select(b => (JsonObject)JsonSerializer.SerializeToNode(b)!).ToArray();
            JsonObject? binding = bindings.FirstOrDefault(b => CombatContent.Int(b["encounterIndex"]) == index && project.Lookup(CombatContent.Text(b["entityId"])).canonicalId == id);
            if (binding is not null) unitId = CombatContent.Text(binding["unitId"]);
        }
        JsonObject actor = CombatContent.Array(scene?["units"]).OfType<JsonObject>().FirstOrDefault(u => CombatContent.Text(u["id"]) == unitId) is JsonObject originalActor ? CombatContent.Clone(originalActor) : PreviewUnit(character);
        unitId = CombatContent.Text(actor["id"]);
        string actorTeam = CombatContent.Text(actor["team"]);
        var dummy = new JsonObject { ["id"] = "__preview_dummy", ["name"] = "校验假人", ["team"] = actorTeam + "_opponent", ["row"] = 0, ["column"] = 0, ["maxHp"] = 10000, ["hp"] = 10000, ["maxMp"] = 0, ["mp"] = 0, ["intelligence"] = 0, ["agilityFactor"] = 1, ["initialReadyTime"] = 0, ["instructions"] = new JsonArray(), ["availableActionIds"] = new JsonArray(), ["availableActionIdsExplicit"] = true };
        JsonObject configuration = CombatContent.Select(rules, CombatContent.RuleFields);
        configuration["id"] = "character_preview"; configuration["playerTeam"] = actorTeam; configuration["randomUsed"] = false;
        configuration["units"] = new JsonArray(actor, dummy);
        var actionIds = CombatContent.Array(actor["availableActionIds"]).Select(CombatContent.Text).Concat(CombatContent.Array(actor["instructions"]).OfType<JsonObject>().Select(i => CombatContent.Text(i["actionId"]))).Distinct(StringComparer.Ordinal);
        var actions = new JsonArray();
        foreach (string actionId in actionIds)
        {
            JsonObject? actual = CombatContent.Array(scene?["actions"]).OfType<JsonObject>().FirstOrDefault(a => CombatContent.Text(a["id"]) == actionId);
            actions.Add(actual?.DeepClone() ?? CombatContent.RuntimeAction(CombatContent.Entity(project, "skill", actionId)));
        }
        configuration["actions"] = actions;
        CombatSession session = CombatContent.CheckScenario(configuration, "characters/" + id + ".json");
        CombatUnitSnapshot unit = session.GetSnapshot().units.Single(u => u.id == unitId);
        if (scene is null) resolvedActions = actions.OfType<JsonObject>().Select(action =>
        {
            CombatActionConfig normalized = CombatSession.NormalizeActionDefinition(UnityJson.Read<CombatActionConfig>(action.ToJsonString()));
            return (object)new { encounterIndex = 1, encounterId = "", actionId = CombatContent.Text(action["id"]), shared = normalized, local = new JsonObject { ["fields"] = new JsonObject(), ["remove"] = new JsonArray() }, effective = normalized, sourceName = "" };
        }).ToArray();
        return new { ok = true, characterId = id, unitId, ruleContext, unit.instructionCapacity, unit.conditionTermCapacity, instructions = unit.instructions.Select(i => new { i.id, i.capacityAllowed, i.actionAvailable, i.validationReason, i.display }).ToArray(), availableActions = session.GetAvailableActions(unitId).Select(a => a.id).ToArray(), resolvedActions };
    }
    private static JsonObject PreviewUnit(JsonObject character)
    {
        JsonObject stats = (JsonObject)character["combatOverride"]!;
        return new JsonObject { ["id"] = "preview_actor", ["name"] = CombatContent.Text(character["name"]), ["team"] = "friendly", ["row"] = 0, ["column"] = 0,
            ["maxHp"] = stats["maxHp"]?.DeepClone(), ["hp"] = stats["maxHp"]?.DeepClone(), ["maxMp"] = stats["maxMp"]?.DeepClone(), ["mp"] = stats["maxMp"]?.DeepClone(), ["agilityFactor"] = stats["agilityFactor"]?.DeepClone(),
            ["intelligence"] = CombatAssembly.Intelligence(character), ["instructions"] = character["instructions"]?.DeepClone() ?? new JsonArray(), ["availableActionIds"] = character["availableActionIds"]?.DeepClone() ?? new JsonArray(), ["availableActionIdsExplicit"] = ContentProject.Flag(character["availableActionIdsExplicit"]) };
    }
}
