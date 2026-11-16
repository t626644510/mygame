using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Prototype.Combat;

namespace MyGame.Sim.Cli;

public static class CombatImport
{
    public static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    public static string Safe(string value)
    {
        string result = Regex.Replace(value.ToLowerInvariant(), "[^a-z0-9_]", "_", RegexOptions.CultureInvariant).Trim('_');
        if (result == "") result = "import";
        if (!char.IsAsciiLetterLower(result[0])) result = "source_" + result;
        return result;
    }
    public static JsonObject? Source(ContentProject project, string trialId)
    {
        string file = project.Store.Resolve("_imports", trialId + ".json");
        if (!File.Exists(file)) return null;
        JsonObject value = CombatContent.Object(JsonNode.Parse(File.ReadAllText(file)));
        string[] allowed = { "schemaVersion", "id", "sourceKind", "sourceName", "sourceSha256", "sourceJson", "bindings", "edits" };
        if (value.Any(p => !allowed.Contains(p.Key)) || CombatContent.Int(value["schemaVersion"]) != 1 || CombatContent.Text(value["id"]) != trialId || value["bindings"] is not JsonArray || value["edits"] is not JsonArray)
            CombatContent.Fail("_imports/" + trialId + ".json", "", "source_metadata", "导入来源旁车格式无效。");
        return value;
    }
    public static object Import(ContentProject project, string json, string sourceName, bool expedition, string? prefix = null, string? sourceHash = null)
    {
        JsonObject source = CombatContent.Object(JsonNode.Parse(json));
        sourceName = Path.GetFileName(sourceName.Replace('\\', '/'));
        if (sourceName is "" or "." or "..") throw new ArgumentException("sourceName必须是来源文件名，不是目录。");
        if (expedition) _ = CombatContent.CheckExpedition(source, "input");
        else _ = CombatContent.CheckScenario(source, "input");
        string p = Safe(prefix ?? CombatContent.Text(source["id"]));
        string trialId = "trial_" + p;
        string digest = sourceHash ?? Hash(UnityJson.Utf8.GetBytes(json));
        var writes = new Dictionary<string, string?>(StringComparer.Ordinal);
        var created = new List<object>(); var reused = new List<object>();
        var createdDocuments = new List<(string Type, string Id, string Path)>();
        var bindings = new JsonArray();
        ContentProject prospective = project;
        JsonObject? oldSource = Source(project, trialId);
        if (oldSource is not null)
        {
            if (CombatContent.Text(oldSource["sourceSha256"]) != digest || CombatContent.Text(oldSource["sourceKind"]) != (expedition ? "expedition" : "scenario"))
                CombatContent.Fail("_imports/" + trialId + ".json", "", "import_exists", "该试炼已绑定不同来源，不覆盖：" + trialId);
            CombatAssemblyResult current = CombatAssembly.Build(project, new JsonObject { ["trialId"] = trialId });
            JsonObject[] oldScenes = expedition ? CombatContent.Array(source["encounters"]).OfType<JsonObject>().Select(e => (JsonObject)e["scenario"]!).ToArray() : new[] { source };
            JsonObject[] currentScenes = expedition ? CombatContent.Array(current.config["encounters"]).OfType<JsonObject>().Select(e => (JsonObject)e["scenario"]!).ToArray() : new[] { current.config };
            for (int index = 0; index < Math.Min(oldScenes.Length, currentScenes.Length); index++)
                foreach (JsonObject oldAction in CombatContent.Array(oldScenes[index]["actions"]).OfType<JsonObject>())
                {
                    string actionId = CombatContent.Text(oldAction["id"]);
                    JsonObject? effective = CombatContent.Array(currentScenes[index]["actions"]).OfType<JsonObject>().FirstOrDefault(a => CombatContent.Text(a["id"]) == actionId);
                    CombatActionConfig expectedAction = UnityJson.Read<CombatActionConfig>(oldAction.ToJsonString());
                    if (effective is null || !CombatSession.ActionDefinitionsEquivalent(expectedAction, UnityJson.Read<CombatActionConfig>(effective.ToJsonString())))
                    {
                        string fields = effective is null ? "missing" : string.Join(", ", Changes(JsonNode.Parse(UnityJson.Serialize(CombatSession.NormalizeActionDefinition(expectedAction))), JsonNode.Parse(UnityJson.Serialize(CombatSession.NormalizeActionDefinition(UnityJson.Read<CombatActionConfig>(effective.ToJsonString()))))));
                        CombatContent.Fail("skills/" + actionId + ".json", "/id", "import_conflict", "已知来源当前实际技能定义不等价，拒绝重置：" + actionId + "；来源 " + Path.GetFileName(sourceName) + " 第" + (index + 1) + "场；差异 " + fields);
                    }
                }
            if (!JsonNode.DeepEquals(NormalizedConfiguration(current.config, expedition), NormalizedConfiguration(source, expedition)))
                CombatContent.Fail("_imports/" + trialId + ".json", "", "import_edited", "已知来源的当前实际定义/场内覆盖已修改，重新导入不重置：" + trialId);
            return new { ok = true, trialId, created = System.Array.Empty<object>(), reused = CombatContent.Array(oldSource["bindings"]).OfType<JsonObject>().Select(b => new { type = CombatContent.Text(b["type"]), id = CombatContent.Text(b["id"]), path = ContentStore.DirectoryFor(CombatContent.Text(b["type"])) + "/" + CombatContent.Text(b["id"]) + ".json" }).Distinct().ToArray(), noOp = true, source = new { kind = expedition ? "expedition" : "scenario", name = Path.GetFileName(sourceName), sha256 = digest, hashBasis = sourceHash is null ? "uploaded UTF-8 text" : "original file bytes" } };
        }
        var sharedActions = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
        JsonObject Add(string type, JsonObject candidate, string pointer)
        {
            string id = CombatContent.Text(candidate["id"]);
            string relative = ContentStore.DirectoryFor(type) + "/" + id + ".json";
            IdLookup existing = prospective.Lookup(id);
            JsonObject final = candidate;
            if (existing.exists)
            {
                JsonObject current = prospective.Documents[existing.path].Value;
                bool equal = existing.type == type && (type == "skill"
                    ? CombatSession.ActionDefinitionsEquivalent(UnityJson.Read<CombatActionConfig>(CombatContent.RuntimeAction(current).ToJsonString()), UnityJson.Read<CombatActionConfig>(CombatContent.RuntimeAction(candidate).ToJsonString()))
                    : JsonNode.DeepEquals(Comparable(current), Comparable(candidate)));
                if (!equal)
                {
                    string changed = string.Join(", ", Changes(Comparable(current), Comparable(candidate)));
                    CombatContent.Fail(relative, "/id", "import_conflict", "同ID定义不同，拒绝覆盖：" + id + "；现有来源 " + existing.path + "；导入 " + Path.GetFileName(sourceName) + pointer + "；差异 " + changed);
                }
                final = current; reused.Add(new { type, id, path = existing.path });
            }
            else
            {
                project.Store.EntityPath(type, id);
                prospective = prospective.With(relative, type, final);
                writes[relative] = UnityJson.Serialize(final);
                created.Add(new { type, id, path = relative });
                createdDocuments.Add((type, id, relative));
            }
            bindings.Add(new JsonObject { ["type"] = type, ["id"] = id, ["sourcePointer"] = pointer, ["baselineJson"] = final.ToJsonString() });
            return final;
        }
        JsonObject ImportCharacter(JsonObject unit, string id, string pointer)
        {
            var attributes = new JsonArray();
            foreach (string attribute in CombatContent.Attributes) attributes.Add(new JsonObject { ["id"] = attribute, ["value"] = attribute == "intelligence" ? CombatContent.Int(unit["intelligence"]) : 0 });
            var character = new JsonObject
            {
                ["schemaVersion"] = 1, ["id"] = id, ["name"] = CombatContent.Text(unit["name"]), ["role"] = "combat",
                ["attributes"] = attributes, ["combatOverride"] = new JsonObject { ["maxHp"] = CombatContent.Int(unit["maxHp"]), ["maxMp"] = CombatContent.Int(unit["maxMp"]), ["agilityFactor"] = CombatContent.Number(unit["agilityFactor"]) },
                ["defaultEquipment"] = new JsonArray(), ["draft"] = false
            };
            foreach (string field in new[] { "instructions", "availableActionIds", "availableActionIdsExplicit", "tags" }) if (unit.ContainsKey(field)) character[field] = unit[field]?.DeepClone();
            return Add("character", character, pointer);
        }
        JsonObject Slot(JsonObject unit, string characterId)
        {
            var slot = new JsonObject { ["unitId"] = CombatContent.Text(unit["id"]), ["characterId"] = characterId };
            foreach (string field in new[] { "name", "team", "row", "column", "hp", "mp", "initialReadyTime", "vulnerable", "statuses", "equipmentDamageBonus", "equipmentSourceId" })
                if (unit.ContainsKey(field)) slot[field] = unit[field]?.DeepClone();
            if (slot["statuses"] is JsonArray statuses)
                foreach (JsonObject status in statuses.OfType<JsonObject>())
                    foreach (string field in new[] { "magnitude", "appliedAt", "expiresAt" }) if (!status.ContainsKey(field)) status[field] = 0;
            return slot;
        }
        JsonArray originalEncounters = expedition ? (JsonArray)source["encounters"]! : new JsonArray(new JsonObject { ["scenario"] = source.DeepClone() });
        string player = expedition ? CombatContent.Text(source["carryTeam"]) : CombatContent.Text(source["playerTeam"]);
        JsonObject initialScene = (JsonObject)((JsonObject)originalEncounters[0]!)["scenario"]!;
        if (player == "") player = CombatContent.Text(((JsonObject)((JsonArray)initialScene["units"]!)[0]!)["team"]);
        var allies = new JsonArray(); var trialEncounters = new JsonArray();
        JsonArray? firstParty = null;
        for (int index = 0; index < originalEncounters.Count; index++)
        {
            JsonObject entry = (JsonObject)originalEncounters[index]!;
            JsonObject scenario = (JsonObject)entry["scenario"]!;
            string scenePointer = expedition ? "/encounters/" + index + "/scenario" : "";
            var party = new JsonArray(CombatContent.Array(scenario["units"]).Where(n => n is JsonObject u && CombatContent.Text(u["team"]) == player).Select(n => n!.DeepClone()).ToArray());
            if (firstParty is not null && !JsonNode.DeepEquals(firstParty, party)) CombatContent.Fail("input", scenePointer + "/units", "party_mismatch", "联场各场友方初始配置必须一致。");
            firstParty ??= (JsonArray)party.DeepClone();
            var localActions = new JsonArray();
            foreach (JsonNode? actionNode in CombatContent.Array(scenario["actions"]))
            {
                JsonObject action = CombatContent.Clone((JsonObject)actionNode!);
                // Required Helper fields can display a core default without writing that default into the source scene.
                foreach (string field in new[] { "magnitude", "mpCost" }) if (!action.ContainsKey(field)) action[field] = 0;
                action["schemaVersion"] = 1; action["description"] = "";
                action["classTags"] = new JsonArray(CombatContent.Text(action["id"]).StartsWith("mage_", StringComparison.Ordinal) ? new JsonNode?[] { JsonValue.Create("mage") } : System.Array.Empty<JsonNode?>());
                action["draft"] = false;
                int actionIndex = CombatContent.Array(scenario["actions"]).IndexOf(actionNode);
                string actionId = CombatContent.Text(action["id"]);
                IdLookup external = project.Lookup(actionId);
                if (external.exists && (external.type != "skill" || !CombatSession.ActionDefinitionsEquivalent(UnityJson.Read<CombatActionConfig>(CombatContent.RuntimeAction(project.Documents[external.path].Value).ToJsonString()), UnityJson.Read<CombatActionConfig>(CombatContent.RuntimeAction(action).ToJsonString()))))
                    CombatContent.Fail(external.path, "/id", "import_conflict", "外部已存在同ID非等价技能，整笔拒绝，不转换来源场覆盖：" + actionId + "；来源 " + Path.GetFileName(sourceName) + scenePointer);
                JsonObject actualShared;
                if (sharedActions.TryGetValue(actionId, out JsonObject? previousShared)) actualShared = Add("skill", previousShared, scenePointer + "/actions/" + actionIndex);
                else { actualShared = Add("skill", action, scenePointer + "/actions/" + actionIndex); sharedActions[actionId] = actualShared; }
                JsonObject baseRuntime = CombatContent.RuntimeAction(actualShared), localRuntime = CombatContent.RuntimeAction((JsonObject)actionNode!);
                var fields = new JsonObject(); var remove = new JsonArray();
                foreach (string field in CombatContent.ActionFields.Where(f => f != "id"))
                {
                    if (!localRuntime.ContainsKey(field) && baseRuntime.ContainsKey(field)) remove.Add(field);
                    else if (localRuntime.ContainsKey(field) && (!baseRuntime.ContainsKey(field) || !JsonNode.DeepEquals(baseRuntime[field], localRuntime[field]))) fields[field] = localRuntime[field]?.DeepClone();
                }
                if (fields.Count != 0 || remove.Count != 0) localActions.Add(new JsonObject { ["actionId"] = actionId, ["fields"] = fields, ["remove"] = remove });
            }
            JsonObject rules = CombatContent.Select(scenario, CombatContent.RuleFields);
            string rulesId = "rules_" + p + "_" + (index + 1);
            rules["schemaVersion"] = 1; rules["id"] = rulesId;
            Add("rule", rules, scenePointer);
            var enemies = new JsonArray();
            JsonArray units = (JsonArray)scenario["units"]!;
            for (int n = 0; n < units.Count; n++)
            {
                JsonObject unit = (JsonObject)units[n]!;
                bool ally = CombatContent.Text(unit["team"]) == player;
                string characterId = "chr_" + p + (expedition && !ally ? "_stage" + (index + 1) : "") + "_" + Safe(CombatContent.Text(unit["id"]));
                ImportCharacter(unit, characterId, scenePointer + "/units/" + n);
                JsonObject slot = Slot(unit, characterId);
                if (ally) { if (index == 0) allies.Add(slot); }
                else enemies.Add(slot);
            }
            string encounterId = "enc_" + p + (expedition ? "_" + (index + 1) : "");
            var encounter = new JsonObject { ["schemaVersion"] = 1, ["id"] = encounterId, ["name"] = CombatContent.Text(scenario["title"]), ["description"] = "", ["enemies"] = enemies, ["draft"] = false };
            if (localActions.Count != 0) encounter["actionOverrides"] = localActions;
            foreach (string field in new[] { "experiencePool", "publicCash", "publicDrops" }) if (expedition && entry.ContainsKey(field)) encounter[field] = entry[field]?.DeepClone();
            Add("encounter", encounter, expedition ? "/encounters/" + index : "");
            trialEncounters.Add(new JsonObject { ["encounterId"] = encounterId, ["waitBefore"] = expedition ? CombatContent.Number(entry["waitBefore"]) : 0, ["rulesId"] = rulesId });
        }
        JsonObject firstScenario = (JsonObject)((JsonObject)originalEncounters[0]!)["scenario"]!;
        var trial = new JsonObject { ["schemaVersion"] = 1, ["id"] = trialId, ["title"] = CombatContent.Text(source["title"]), ["parameterNotice"] = CombatContent.Text(source["parameterNotice"]), ["seed"] = CombatContent.Int(firstScenario["seed"]), ["playerTeam"] = player, ["carryTeam"] = expedition ? CombatContent.Text(source["carryTeam"]) : player, ["allies"] = allies, ["encounters"] = trialEncounters, ["rulesId"] = "rules_" + p + "_1", ["draft"] = false };
        if (expedition && (source.ContainsKey("maxStepsPerBattle") || source.ContainsKey("maxWaitPerBattle")))
            trial["runBudget"] = new JsonObject { ["maxSteps"] = CombatContent.Int(source["maxStepsPerBattle"], 10000), ["maxWait"] = CombatContent.Number(source["maxWaitPerBattle"], 100000) };
        Add("trial", trial, "");
        int requestNumber = prospective.NextRequestNumber();
        foreach (var createdDoc in createdDocuments)
        {
            JsonObject note = ContentProject.CompleteRequest(new JsonObject { ["kind"] = "note", ["owner"] = "combat", ["title"] = "导入来源：" + Path.GetFileName(sourceName), ["body"] = "由旧战例导入；来源文件 " + Path.GetFileName(sourceName) + "。", ["createdAt"] = "" }, createdDoc.Id, requestNumber++, createdDoc.Type);
            string requestPath = "_requests/" + CombatContent.Text(note["id"]) + ".json";
            prospective = prospective.With(requestPath, "request", note); writes[requestPath] = UnityJson.Serialize(note);
        }
        ContentValidation validation = prospective.Validate();
        if (!validation.ok) throw new ContentValidationException(validation);
        var metadata = new JsonObject { ["schemaVersion"] = 1, ["id"] = trialId, ["sourceKind"] = expedition ? "expedition" : "scenario", ["sourceName"] = Path.GetFileName(sourceName), ["sourceSha256"] = digest, ["sourceJson"] = json, ["bindings"] = bindings, ["edits"] = new JsonArray() };
        writes["_imports/" + trialId + ".json"] = UnityJson.Serialize(metadata);
        writes["REQUESTS.md"] = RequestStore.FormatMarkdown(prospective.Requests());
        // Import is additive. Recheck every planned target immediately before the existing atomic group writer.
        foreach (string file in writes.Keys.Where(k => k != "REQUESTS.md"))
            if (File.Exists(project.Store.Resolve(file.Split('/')))) CombatContent.Fail(file, "", "import_race", "导入目标已出现，未覆盖：" + file);
        ContentEditing.Apply(project.Store, writes);
        return new { ok = true, trialId, created = created.ToArray(), reused = reused.ToArray(), source = new { kind = expedition ? "expedition" : "scenario", name = Path.GetFileName(sourceName), sha256 = digest, hashBasis = sourceHash is null ? "uploaded UTF-8 text" : "original file bytes" } };
    }

    public static JsonObject Comparable(JsonObject value)
    { JsonObject copy = CombatContent.Clone(value); copy.Remove("notes"); return copy; }

    private static JsonNode NormalizedConfiguration(JsonObject config, bool expedition)
    {
        JsonObject output = CombatContent.Object(JsonNode.Parse(expedition ? UnityJson.Serialize(UnityJson.Read<CombatExpeditionConfig>(config.ToJsonString())) : UnityJson.Serialize(UnityJson.Read<CombatScenario>(config.ToJsonString()))));
        IEnumerable<JsonObject> scenes = expedition ? CombatContent.Array(output["encounters"]).OfType<JsonObject>().Select(e => (JsonObject)e["scenario"]!) : new[] { output };
        foreach (JsonObject scene in scenes)
            scene["actions"] = new JsonArray(CombatContent.Array(scene["actions"]).OfType<JsonObject>().Select(a => JsonNode.Parse(UnityJson.Serialize(CombatSession.NormalizeActionDefinition(UnityJson.Read<CombatActionConfig>(a.ToJsonString()))))).ToArray());
        return output;
    }

    public static IEnumerable<string> Changes(JsonNode? baseline, JsonNode? candidate, string pointer = "")
    {
        if (JsonNode.DeepEquals(baseline, candidate)) yield break;
        if (baseline is JsonObject left && candidate is JsonObject right)
        {
            foreach (string key in left.Select(p => p.Key).Concat(right.Select(p => p.Key)).Distinct(StringComparer.Ordinal))
            {
                if (pointer == "" && key is "schemaVersion" or "notes" or "draft" or "description" or "classTags") continue;
                string child = pointer + "/" + key.Replace("~", "~0").Replace("/", "~1");
                if (!left.ContainsKey(key) || !right.ContainsKey(key)) yield return child;
                else foreach (string change in Changes(left[key], right[key], child)) yield return change;
            }
        }
        else yield return pointer;
    }
    public static (bool Exists, JsonNode? Value) At(JsonNode? node, string pointer)
    {
        if (pointer == "") return (true, node);
        if (!pointer.StartsWith("/", StringComparison.Ordinal)) throw new ArgumentException("edit path必须是JSON Pointer。");
        foreach (string encoded in pointer.Split('/').Skip(1))
        {
            string token = encoded.Replace("~1", "/").Replace("~0", "~");
            if (node is JsonObject obj && obj.TryGetPropertyValue(token, out JsonNode? child)) node = child;
            else if (node is JsonArray array && int.TryParse(token, out int index) && index >= 0 && index < array.Count) node = array[index];
            else return (false, null);
        }
        return (true, node);
    }
    public static void Set(JsonNode target, string pointer, JsonNode? value, bool remove = false)
    {
        int split = pointer.LastIndexOf('/');
        if (split < 0) throw new ArgumentException("Cannot replace a source root through a field edit.");
        var parent = At(target, pointer[..split]);
        if (!parent.Exists || parent.Value is null) throw new ArgumentException("编辑路径父对象不存在：" + pointer);
        string key = pointer[(split + 1)..].Replace("~1", "/").Replace("~0", "~");
        if (parent.Value is JsonObject obj) { if (remove) obj.Remove(key); else obj[key] = value?.DeepClone(); }
        else if (parent.Value is JsonArray array && int.TryParse(key, out int index) && index >= 0 && index < array.Count) { if (remove) array.RemoveAt(index); else array[index] = value?.DeepClone(); }
        else throw new ArgumentException("编辑路径无效：" + pointer);
    }
    public static void TrackEdits(ContentProject project, string type, string id, JsonObject entity, JsonNode? intent, Dictionary<string, string?> writes)
    {
        if (intent is null) return;
        if (intent is not JsonArray operations) throw new ArgumentException("editIntent必须是数组。");
        foreach (JsonNode? raw in operations)
        {
            JsonObject operation = CombatContent.Object(raw);
            string op = CombatContent.Text(operation["op"]), pointer = CombatContent.Text(operation["path"]);
            if (operation.Any(p => p.Key is not "op" and not "path") || op is not "set" and not "remove" || pointer == "" || pointer.StartsWith("/id", StringComparison.Ordinal) || pointer.StartsWith("/schemaVersion", StringComparison.Ordinal)) CombatContent.Fail("content", pointer, "edit_intent", "编辑意图不合法。");
            if (At(entity, pointer).Exists != (op == "set")) CombatContent.Fail("content", pointer, "edit_intent", "编辑意图与候选字段存在性不一致。");
        }
        string directory = project.Store.Resolve("_imports");
        if (!Directory.Exists(directory)) return;
        foreach (string file in Directory.GetFiles(directory, "*.json"))
        {
            JsonObject metadata = Source(project, Path.GetFileNameWithoutExtension(file))!;
            if (!CombatContent.Array(metadata["bindings"]).OfType<JsonObject>().Any(b => CombatContent.Text(b["type"]) == type && CombatContent.Text(b["id"]) == id)) continue;
            JsonArray edits = (JsonArray)metadata["edits"]!;
            foreach (JsonObject operation in operations.OfType<JsonObject>())
            {
                string pointer = CombatContent.Text(operation["path"]);
                for (int i = edits.Count - 1; i >= 0; i--) if (edits[i] is JsonObject e && CombatContent.Text(e["type"]) == type && CombatContent.Text(e["id"]) == id && CombatContent.Text(e["path"]) == pointer) edits.RemoveAt(i);
                edits.Add(new JsonObject { ["type"] = type, ["id"] = id, ["path"] = pointer, ["op"] = CombatContent.Text(operation["op"]) });
            }
            writes["_imports/" + Path.GetFileName(file)] = UnityJson.Serialize(metadata);
        }
    }
}
