using System.Text.Json.Nodes;
using Prototype.Combat;

namespace MyGame.Sim.Cli;

public sealed record CombatAssemblyResult(string kind, JsonObject config, object[] bindings, object[] ruleContexts,
    object provenance, JsonObject trial, int maxSteps, double maxWait)
{
    public object[] resolvedActions { get; init; } = System.Array.Empty<object>();
    public object Envelope() => new { ok = true, kind, config, bindings, ruleContexts, provenance, resolvedActions };
}

public static class CombatAssembly
{
    public static ContentProject Overrides(ContentProject project, JsonObject? overrides)
    {
        if (overrides is null) return project;
        foreach (var property in overrides)
        {
            string type = property.Key switch { "characters" => "character", "skills" => "skill", "encounters" => "encounter", _ => throw new ArgumentException("Unknown override collection: " + property.Key) };
            if (property.Value is not JsonArray values) throw new ArgumentException("Overrides必须是完整实体数组。");
            foreach (JsonNode? node in values)
            {
                JsonObject value = CombatContent.Object(node);
                string id = CombatContent.Text(value["id"]);
                project.Store.EntityPath(type, id);
                project = project.With(ContentStore.DirectoryFor(type) + "/" + id + ".json", type, value);
            }
        }
        return project;
    }
    public static CombatAssemblyResult Build(ContentProject inputProject, JsonNode? body, bool diagnostic = false)
    {
        JsonObject input = body is JsonValue text && text.TryGetValue<string>(out string? trialText)
            ? new JsonObject { ["trialId"] = trialText } : CombatContent.Object(body);
        foreach (var property in input) if (property.Key is not "trialId" and not "trial" and not "overrides" and not "editIntents") throw new ArgumentException("Unknown assembly input: " + property.Key);
        if (input["overrides"] is not null && input["overrides"] is not JsonObject) throw new ArgumentException("overrides必须是对象。");
        if (input["editIntents"] is not null && input["editIntents"] is not JsonArray) throw new ArgumentException("editIntents必须是数组。");
        if (input.ContainsKey("trial") == input.ContainsKey("trialId") || input.ContainsKey("trial") && input["trial"] is not JsonObject || input.ContainsKey("trialId") && CombatContent.Text(input["trialId"]) == "") throw new ArgumentException("trial与trialId必须二选一，并提供完整trial对象或非空trialId。");
        ContentProject project = Overrides(inputProject, input["overrides"] as JsonObject);
        JsonObject trial = input["trial"] as JsonObject ?? CombatContent.Entity(project, "trial", CombatContent.Text(input["trialId"]));
        string trialId = CombatContent.Text(trial["id"]);
        project.Store.EntityPath("trial", trialId);
        project = project.With("trials/" + trialId + ".json", "trial", trial);
        ContentValidation validation = project.Validate();
        if (!validation.ok) throw new ContentValidationException(validation);
        foreach (JsonNode? raw in CombatContent.Array(input["editIntents"]))
        {
            JsonObject intent = CombatContent.Object(raw);
            string type = CombatContent.Text(intent["type"]), id = CombatContent.Text(intent["id"]);
            if (!CombatContent.Types.Contains(type) || intent.Any(p => p.Key is not "type" and not "id" and not "operations")) throw new ArgumentException("editIntents项格式不合法。");
            if (intent["operations"] is not JsonArray operations) throw new ArgumentException("editIntents.operations必须是数组。");
            CombatImport.TrackEdits(project, type, id, CombatContent.Entity(project, type, id), operations, new Dictionary<string, string?>(StringComparer.Ordinal));
        }
        JsonObject? metadata = CombatImport.Source(project, trialId);
        bool sourceExpedition = CombatContent.Text(metadata?["sourceKind"]) == "expedition";
        bool expedition = sourceExpedition || CombatContent.Array(trial["encounters"]).Count > 1;
        JsonObject? original = metadata is null ? null : CombatContent.Object(CombatContent.RuntimeOnly(JsonNode.Parse(CombatContent.Text(metadata["sourceJson"])), sourceExpedition ? typeof(CombatExpeditionConfig) : typeof(CombatScenario)));
        JsonArray sourceBindings = metadata?["bindings"] as JsonArray ?? new JsonArray();
        JsonObject? Baseline(string type, string id)
        {
            JsonObject? binding = sourceBindings.OfType<JsonObject>().FirstOrDefault(b => CombatContent.Text(b["type"]) == type && CombatContent.Text(b["id"]) == id);
            return binding is null ? null : CombatContent.Object(JsonNode.Parse(CombatContent.Text(binding["baselineJson"])));
        }
        HashSet<string> Fields(string type, string id, JsonObject current)
        {
            JsonObject? baseline = Baseline(type, id);
            var fields = new HashSet<string>(baseline is null ? current.Select(p => "/" + p.Key) : CombatImport.Changes(baseline, current), StringComparer.Ordinal);
            foreach (JsonObject edit in CombatContent.Array(metadata?["edits"]).OfType<JsonObject>())
                if (CombatContent.Text(edit["type"]) == type && CombatContent.Text(edit["id"]) == id) fields.Add(CombatContent.Text(edit["path"]));
            foreach (JsonObject edit in CombatContent.Array(input["editIntents"]).OfType<JsonObject>())
                if (CombatContent.Text(edit["type"]) == type && CombatContent.Text(edit["id"]) == id)
                    foreach (JsonObject operation in CombatContent.Array(edit["operations"]).OfType<JsonObject>()) fields.Add(CombatContent.Text(operation["path"]));
            return fields;
        }
        void Guard(string type, string id, string via)
        {
            JsonObject entity = CombatContent.Entity(project, type, id);
            if (!diagnostic && (ContentProject.Flag(entity["draft"]) || type == "skill" && !CombatTacticsCatalog.IsEffectSupported(CombatContent.Text(entity["effectKind"]))))
                CombatContent.Fail(ContentStore.DirectoryFor(type) + "/" + id + ".json", "/draft", "draft_dependency", via + " 引用待实现能力或草稿 " + type + ":" + id);
            if (!diagnostic && type == "character") ReferenceIndex.EnsureRunnable(project, entity);
        }
        Guard("trial", trialId, "试炼");
        var outputBindings = new List<object>(); var contexts = new List<object>(); var resolved = new List<object>();
        JsonArray encounters = CombatContent.Array(trial["encounters"]);
        JsonObject? baselineTrial = Baseline("trial", trialId);
        if (original is not null && sourceExpedition && baselineTrial is not null)
            foreach (string field in new[] { "seed", "playerTeam" })
                if (!JsonNode.DeepEquals(trial[field], baselineTrial[field])) CombatContent.Fail("trials/" + trialId + ".json", "/" + field, "source_scope", "导入联场每场来源头只读，不能用顶层字段广播覆盖：" + field);
        JsonObject config = original is null || !sourceExpedition ? new JsonObject() : CombatContent.Clone(original);
        var assembledEncounters = new JsonArray();
        for (int stage = 0; stage < encounters.Count; stage++)
        {
            JsonObject entry = (JsonObject)encounters[stage]!;
            string encounterId = CombatContent.Text(entry["encounterId"]);
            JsonObject encounter = CombatContent.Entity(project, "encounter", encounterId);
            Guard("encounter", encounterId, "试炼 " + trialId);
            JsonObject? encounterBinding = sourceBindings.OfType<JsonObject>().FirstOrDefault(b => CombatContent.Text(b["type"]) == "encounter" && CombatContent.Text(b["id"]) == encounterId);
            string encounterPointer = encounterBinding is null ? "" : CombatContent.Text(encounterBinding["sourcePointer"]);
            JsonObject? originalEntry = original is not null && encounterBinding is not null
                ? CombatImport.At(original, encounterPointer).Value as JsonObject : null;
            JsonObject? originalScene = originalEntry is null ? null : sourceExpedition ? originalEntry["scenario"] as JsonObject : originalEntry;
            JsonObject scene = originalScene is null ? NewScene(trial, stage) : CombatContent.Clone(originalScene);
            string scenePointer = originalScene is null ? "" : sourceExpedition ? encounterPointer + "/scenario" : "";
            string rulesId = CombatContent.Text(entry["rulesId"]);
            if (rulesId == "") rulesId = CombatContent.Text(trial["rulesId"]);
            if (rulesId == "") rulesId = "rules_combat";
            JsonObject rules = CombatContent.Entity(project, "rule", rulesId);
            JsonObject? baselineRule = Baseline("rule", rulesId);
            bool originalRulesBinding = originalScene is not null && sourceBindings.OfType<JsonObject>().Any(b =>
                CombatContent.Text(b["type"]) == "rule" && CombatContent.Text(b["id"]) == rulesId && CombatContent.Text(b["sourcePointer"]) == scenePointer);
            if (!originalRulesBinding || baselineRule is null)
            {
                foreach (string field in CombatContent.RuleFields) { scene.Remove(field); if (rules.ContainsKey(field)) scene[field] = rules[field]?.DeepClone(); }
            }
            else foreach (string pointer in Fields("rule", rulesId, rules))
            {
                if (!CombatContent.RuleFields.Any(f => pointer == "/" + f || pointer.StartsWith("/" + f + "/", StringComparison.Ordinal))) continue;
                var property = CombatImport.At(rules, pointer); CombatImport.Set(scene, pointer, property.Value, !property.Exists);
            }
            if (!sourceExpedition && originalScene is not null)
                foreach (string field in new[] { "title", "parameterNotice", "seed", "playerTeam" })
                    if (Fields("trial", trialId, trial).Contains("/" + field)) { if (trial.ContainsKey(field)) scene[field] = trial[field]?.DeepClone(); else scene.Remove(field); }
            var units = new JsonArray();
            var desiredSlots = new List<(JsonObject Slot, string OwnerType, string OwnerId, int Position)>();
            int position = 0;
            foreach (JsonObject slot in CombatContent.Array(trial["allies"]).OfType<JsonObject>()) desiredSlots.Add((slot, "trial", trialId, position++));
            position = 0;
            foreach (JsonObject slot in CombatContent.Array(encounter["enemies"]).OfType<JsonObject>()) desiredSlots.Add((slot, "encounter", encounterId, position++));
            var built = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
            foreach (var slotData in desiredSlots)
            {
                JsonObject slot = slotData.Slot;
                string unitId = CombatContent.Text(slot["unitId"]), characterId = CombatContent.Text(slot["characterId"]);
                Guard("character", characterId, "试炼 " + trialId);
                JsonObject character = CombatContent.Entity(project, "character", characterId);
                JsonObject? oldUnit = CombatContent.Array(originalScene?["units"]).OfType<JsonObject>().FirstOrDefault(u => CombatContent.Text(u["id"]) == unitId);
                JsonObject? characterBinding = sourceBindings.OfType<JsonObject>().FirstOrDefault(b => CombatContent.Text(b["type"]) == "character" && CombatContent.Text(b["id"]) == characterId && CombatContent.Text(b["sourcePointer"]).StartsWith(scenePointer + "/units/", StringComparison.Ordinal));
                JsonObject unit;
                if (oldUnit is null || characterBinding is null) unit = NewUnit(project, character, slot, slotData.OwnerType == "trial" ? CombatContent.Text(trial["playerTeam"]) : "enemy");
                else
                {
                    unit = CombatContent.Clone(oldUnit);
                    HashSet<string> changed = Fields("character", characterId, character);
                    foreach (string field in new[] { "maxHp", "maxMp", "agilityFactor" })
                        if (changed.Any(f => f == "/combatOverride" || f == "/combatOverride/" + field)) unit[field] = character["combatOverride"]![field]?.DeepClone();
                    JsonObject? baselineCharacter = Baseline("character", characterId);
                    int intelligence = Intelligence(character), previousIntelligence = baselineCharacter is null ? intelligence : Intelligence(baselineCharacter);
                    if (intelligence != previousIntelligence || changed.Contains("/attributes/2/value")) unit["intelligence"] = intelligence;
                    foreach (string field in new[] { "instructions", "availableActionIds", "availableActionIdsExplicit", "tags" })
                        if (changed.Any(f => f == "/" + field || f.StartsWith("/" + field + "/", StringComparison.Ordinal))) { if (character.ContainsKey(field)) unit[field] = character[field]?.DeepClone(); else unit.Remove(field); }
                    if (changed.Any(f => f == "/availableActionIds" || f.StartsWith("/availableActionIds/", StringComparison.Ordinal))) unit["availableActionIdsExplicit"] = true;
                    else if (changed.Any(f => f == "/instructions" || f.StartsWith("/instructions/", StringComparison.Ordinal)) && !ContentProject.Flag(oldUnit["availableActionIdsExplicit"]) && CombatContent.Array(oldUnit["availableActionIds"]).Count == 0)
                    {
                        // Let the existing core resolve the original learned set; editing a rule must not teach a skill.
                        var originalSession = new CombatSession(UnityJson.Read<CombatScenario>(originalScene!.ToJsonString()));
                        unit["availableActionIds"] = new JsonArray(originalSession.GetAvailableActions(unitId).Select(a => (JsonNode?)JsonValue.Create(a.id)).ToArray());
                        unit["availableActionIdsExplicit"] = true;
                    }
                    JsonObject? oldOwner = Baseline(slotData.OwnerType, slotData.OwnerId);
                    string arrayName = slotData.OwnerType == "trial" ? "allies" : "enemies";
                    JsonObject? oldSlot = CombatContent.Array(oldOwner?[arrayName]).OfType<JsonObject>().FirstOrDefault(s => CombatContent.Text(s["unitId"]) == unitId);
                    foreach (string field in new[] { "name", "team", "row", "column", "hp", "mp", "initialReadyTime", "vulnerable", "statuses", "equipmentDamageBonus", "equipmentSourceId" })
                        if (oldSlot is null || oldSlot.ContainsKey(field) != slot.ContainsKey(field) || !JsonNode.DeepEquals(oldSlot[field], slot[field]))
                        { if (slot.ContainsKey(field)) unit[field] = slot[field]?.DeepClone(); else unit.Remove(field); }
                    if (CombatContent.Int(unit["hp"]) == -1) unit["hp"] = unit["maxHp"]?.DeepClone();
                    if (CombatContent.Int(unit["mp"]) == -1) unit["mp"] = unit["maxMp"]?.DeepClone();
                    if (CombatContent.Int(unit["equipmentDamageBonus"]) == -1) unit["equipmentDamageBonus"] = Equipment(project, character).Bonus;
                }
                if (!built.TryAdd(unitId, unit)) CombatContent.Fail("trials/" + trialId + ".json", "/allies", "duplicate_unit", "unitId全场必须唯一：" + unitId);
                string sourcePointer = characterBinding is null ? "" : CombatContent.Text(characterBinding["sourcePointer"]);
                outputBindings.Add(new { encounterIndex = stage + 1, sourcePointer, entityType = "character", entityId = characterId, unitId, instructionId = "", instructionIndex = -1 });
                int instructionIndex = 0;
                foreach (JsonObject instruction in CombatContent.Array(unit["instructions"]).OfType<JsonObject>())
                {
                    outputBindings.Add(new { encounterIndex = stage + 1, sourcePointer = sourcePointer + "/instructions/" + instructionIndex, entityType = "character", entityId = characterId, unitId, instructionId = CombatContent.Text(instruction["id"]), instructionIndex });
                    instructionIndex++;
                }
            }
            // Preserve original interleaving unless the party/enemy membership or their own order was explicitly changed.
            bool reordered = originalScene is null;
            foreach (var owner in new[] { ("trial", trialId, "allies"), ("encounter", encounterId, "enemies") })
            {
                JsonObject current = owner.Item1 == "trial" ? trial : encounter;
                JsonObject? baselineOwner = Baseline(owner.Item1, owner.Item2);
                if (baselineOwner is not null && !CombatContent.Array(baselineOwner[owner.Item3]).OfType<JsonObject>().Select(s => CombatContent.Text(s["unitId"])).SequenceEqual(CombatContent.Array(current[owner.Item3]).OfType<JsonObject>().Select(s => CombatContent.Text(s["unitId"])))) reordered = true;
            }
            if (!reordered)
                foreach (JsonObject oldUnit in CombatContent.Array(originalScene?["units"]).OfType<JsonObject>())
                    if (built.Remove(CombatContent.Text(oldUnit["id"]), out JsonObject? current)) units.Add(current);
            foreach (var slot in desiredSlots) if (built.Remove(CombatContent.Text(slot.Slot["unitId"]), out JsonObject? current)) units.Add(current);
            scene["units"] = units;
            JsonArray actions = originalScene?["actions"] is JsonArray oldActions ? (JsonArray)oldActions.DeepClone() : new JsonArray();
            foreach (JsonObject binding in sourceBindings.OfType<JsonObject>().Where(b => CombatContent.Text(b["type"]) == "skill" && CombatContent.Text(b["sourcePointer"]).StartsWith(scenePointer + "/actions/", StringComparison.Ordinal)))
            {
                string id = CombatContent.Text(binding["id"]); Guard("skill", id, "来源动作池");
                JsonObject skill = CombatContent.Entity(project, "skill", id);
                JsonObject? originalAction = actions.OfType<JsonObject>().FirstOrDefault(a => CombatContent.Text(a["id"]) == id);
                if (originalAction is null) continue;
                foreach (string field in CombatContent.ActionFields)
                    if (Fields("skill", id, skill).Contains("/" + field)) { if (skill.ContainsKey(field)) originalAction[field] = skill[field]?.DeepClone(); else originalAction.Remove(field); }
            }
            var required = new HashSet<string>(StringComparer.Ordinal);
            foreach (JsonObject unit in units.OfType<JsonObject>())
            {
                string characterId = desiredSlots.First(s => CombatContent.Text(s.Slot["unitId"]) == CombatContent.Text(unit["id"])).Slot["characterId"]!.GetValue<string>();
                foreach (JsonNode? idNode in CombatContent.Array(unit["availableActionIds"])) Require(CombatContent.Text(idNode), characterId);
                foreach (JsonObject instruction in CombatContent.Array(unit["instructions"]).OfType<JsonObject>()) Require(CombatContent.Text(instruction["actionId"]), characterId);
            }
            void Require(string id, string character)
            {
                Guard("skill", id, "角色 " + character);
                required.Add(id);
            }
            foreach (string actionId in required.Order(StringComparer.Ordinal)) if (!actions.OfType<JsonObject>().Any(a => CombatContent.Text(a["id"]) == actionId)) actions.Add(CombatContent.RuntimeAction(CombatContent.Entity(project, "skill", actionId)));
            JsonObject? oldEncounterDefinition = Baseline("encounter", encounterId);
            foreach (JsonObject action in actions.OfType<JsonObject>())
            {
                string actionId = CombatContent.Text(action["id"]);
                JsonObject shared = CombatContent.RuntimeAction(CombatContent.Entity(project, "skill", actionId));
                JsonObject? local = CombatContent.Array(encounter["actionOverrides"]).OfType<JsonObject>().FirstOrDefault(o => CombatContent.Text(o["actionId"]) == actionId);
                JsonObject? oldLocal = CombatContent.Array(oldEncounterDefinition?["actionOverrides"]).OfType<JsonObject>().FirstOrDefault(o => CombatContent.Text(o["actionId"]) == actionId);
                var oldPinned = (oldLocal?["fields"] as JsonObject)?.Select(p => p.Key).Concat(CombatContent.Array(oldLocal?["remove"]).Select(CombatContent.Text)).Distinct(StringComparer.Ordinal) ?? CombatContent.Array(oldLocal?["remove"]).Select(CombatContent.Text);
                foreach (string field in oldPinned)
                    if (local?["fields"] is not JsonObject currentFields || !currentFields.ContainsKey(field))
                        if (!CombatContent.Array(local?["remove"]).Any(v => CombatContent.Text(v) == field)) { if (shared.ContainsKey(field)) action[field] = shared[field]?.DeepClone(); else action.Remove(field); }
                JsonObject effective = CombatContent.ApplyActionOverride(action, local);
                action.Clear(); foreach (var property in effective) action[property.Key] = property.Value?.DeepClone();
                resolved.Add(new { encounterIndex = stage + 1, encounterId, actionId,
                    shared = CombatSession.NormalizeActionDefinition(UnityJson.Read<CombatActionConfig>(shared.ToJsonString())),
                    local = local is null ? new JsonObject { ["fields"] = new JsonObject(), ["remove"] = new JsonArray() } : CombatContent.Clone(local),
                    effective = CombatSession.NormalizeActionDefinition(UnityJson.Read<CombatActionConfig>(action.ToJsonString())),
                    sourceName = CombatContent.Text(metadata?["sourceName"]) });
            }
            if (originalScene is null) actions = new JsonArray(actions.OfType<JsonObject>().OrderBy(a => CombatContent.Text(a["id"]), StringComparer.Ordinal).Select(a => (JsonNode?)a.DeepClone()).ToArray());
            scene["actions"] = actions;
            _ = CombatContent.CheckScenario(scene, "trials/" + trialId + ".json");
            contexts.Add(new { trialId, encounterIndex = stage + 1, rulesId, origin = originalScene is not null && baselineRule is not null ? "source" : "global", sourceName = CombatContent.Text(metadata?["sourceName"]), sourceScenarioId = CombatContent.Text(scene["id"]), rules });
            if (!expedition) config = scene;
            else
            {
                bool sourceEncounter = sourceExpedition && originalEntry is not null;
                JsonObject outputEncounter = sourceEncounter ? CombatContent.Clone(originalEntry!) : new JsonObject { ["id"] = encounterId };
                outputEncounter["scenario"] = scene;
                JsonObject? baselineEncounter = Baseline("encounter", encounterId);
                foreach (string field in new[] { "experiencePool", "publicCash", "publicDrops" })
                    if (baselineEncounter is null || baselineEncounter.ContainsKey(field) != encounter.ContainsKey(field) || !JsonNode.DeepEquals(baselineEncounter[field], encounter[field])) { if (encounter.ContainsKey(field)) outputEncounter[field] = encounter[field]?.DeepClone(); else outputEncounter.Remove(field); }
                JsonObject? oldStage = CombatContent.Array(baselineTrial?["encounters"]).OfType<JsonObject>().FirstOrDefault(e => CombatContent.Text(e["encounterId"]) == encounterId);
                if (!sourceEncounter || oldStage is null || !JsonNode.DeepEquals(oldStage["waitBefore"], entry["waitBefore"])) outputEncounter["waitBefore"] = entry["waitBefore"]?.DeepClone();
                assembledEncounters.Add(outputEncounter);
            }
        }
        if (expedition)
        {
            if (original is null || !sourceExpedition) { config["id"] = trialId; config["title"] = CombatContent.Text(trial["title"]); config["parameterNotice"] = CombatContent.Text(trial["parameterNotice"]); config["carryTeam"] = CombatContent.Text(trial["carryTeam"]); }
            else foreach (string field in new[] { "title", "parameterNotice", "carryTeam" }) if (Fields("trial", trialId, trial).Contains("/" + field)) config[field] = trial[field]?.DeepClone();
            if (!sourceExpedition || Fields("trial", trialId, trial).Any(field => field == "/runBudget" || field.StartsWith("/runBudget/", StringComparison.Ordinal)))
            {
                if (trial["runBudget"] is JsonObject budget) { config["maxStepsPerBattle"] = budget["maxSteps"]?.DeepClone(); config["maxWaitPerBattle"] = budget["maxWait"]?.DeepClone(); }
                else { config.Remove("maxStepsPerBattle"); config.Remove("maxWaitPerBattle"); }
            }
            config["encounters"] = assembledEncounters;
            _ = CombatContent.CheckExpedition(config, "trials/" + trialId + ".json");
        }
        int maxSteps = CombatContent.Int(trial["runBudget"]?["maxSteps"], 10000);
        double maxWait = CombatContent.Number(trial["runBudget"]?["maxWait"], 100000);
        if (!diagnostic) ReferenceIndex.EnsureRunnable(project, config);
        return new(expedition ? "expedition" : "scenario", config, outputBindings.ToArray(), contexts.ToArray(),
            new { imported = metadata is not null, sourceKind = CombatContent.Text(metadata?["sourceKind"]), sourceName = CombatContent.Text(metadata?["sourceName"]), sourceSha256 = CombatContent.Text(metadata?["sourceSha256"]), metadataReadOnly = metadata is not null }, trial, maxSteps, maxWait) { resolvedActions = resolved.ToArray() };
    }
    public static int Intelligence(JsonObject character) => CombatContent.Array(character["attributes"]).OfType<JsonObject>().Where(a => CombatContent.Text(a["id"]) == "intelligence").Select(a => CombatContent.Int(a["value"])).FirstOrDefault();
    private static JsonObject NewScene(JsonObject trial, int stage) => new() { ["id"] = CombatContent.Text(trial["id"]) + (CombatContent.Array(trial["encounters"]).Count > 1 ? "_" + (stage + 1) : ""), ["title"] = CombatContent.Text(trial["title"]), ["parameterNotice"] = CombatContent.Text(trial["parameterNotice"]), ["seed"] = CombatContent.Int(trial["seed"]), ["randomUsed"] = false, ["playerTeam"] = CombatContent.Text(trial["playerTeam"]) };
    private static (int Bonus, string Source) Equipment(ContentProject project, JsonObject character)
    {
        int bonus = 0; string source = "";
        foreach (JsonObject equipment in CombatContent.Array(character["defaultEquipment"]).OfType<JsonObject>())
        {
            string id = CombatContent.Text(equipment["itemId"]); JsonObject item = CombatContent.Entity(project, "item", id);
            if (ContentProject.Flag(item["draft"])) CombatContent.Fail("characters/" + CombatContent.Text(character["id"]) + ".json", "/defaultEquipment", "draft_dependency", "装备是草稿：" + id);
            foreach (JsonObject field in CombatContent.Array(item["equipment"]?["combatBonus"]).OfType<JsonObject>()) if (CombatContent.Text(field["id"]) == "equipmentDamageBonus") bonus = checked(bonus + CombatContent.Int(field["value"]));
            if (source == "" && CombatContent.Text(equipment["slot"]) == "weapon") source = id;
        }
        return (bonus, source);
    }
    private static JsonObject NewUnit(ContentProject project, JsonObject character, JsonObject slot, string team)
    {
        var equipment = Equipment(project, character);
        JsonObject stats = (JsonObject)character["combatOverride"]!;
        var unit = new JsonObject { ["id"] = CombatContent.Text(slot["unitId"]), ["name"] = CombatContent.Text(slot["name"]) == "" ? CombatContent.Text(character["name"]) : CombatContent.Text(slot["name"]), ["team"] = CombatContent.Text(slot["team"]) == "" ? team : CombatContent.Text(slot["team"]), ["intelligence"] = Intelligence(character), ["availableActionIdsExplicit"] = true };
        foreach (string field in new[] { "maxHp", "maxMp", "agilityFactor" }) unit[field] = stats[field]?.DeepClone();
        foreach (string field in new[] { "instructions", "availableActionIds", "tags" }) unit[field] = character[field]?.DeepClone() ?? new JsonArray();
        foreach (string field in new[] { "row", "column", "initialReadyTime", "vulnerable", "statuses" }) if (slot.ContainsKey(field)) unit[field] = slot[field]?.DeepClone();
        unit["hp"] = CombatContent.Int(slot["hp"], -1) == -1 ? CombatContent.Int(stats["maxHp"]) : CombatContent.Int(slot["hp"]);
        unit["mp"] = CombatContent.Int(slot["mp"], -1) == -1 ? CombatContent.Int(stats["maxMp"]) : CombatContent.Int(slot["mp"]);
        unit["equipmentDamageBonus"] = CombatContent.Int(slot["equipmentDamageBonus"], -1) < 0 ? equipment.Bonus : CombatContent.Int(slot["equipmentDamageBonus"]);
        unit["equipmentSourceId"] = CombatContent.Text(slot["equipmentSourceId"]) == "" ? equipment.Source : CombatContent.Text(slot["equipmentSourceId"]);
        return unit;
    }
}
