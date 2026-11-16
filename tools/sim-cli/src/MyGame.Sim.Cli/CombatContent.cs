using System.Reflection;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Prototype.Combat;

namespace MyGame.Sim.Cli;

public static class CombatContent
{
    public static readonly string[] Types = { "skill", "character", "encounter", "trial", "rule" };
    public static readonly string[] RuleFields = { "maxUnitsPerTeam", "gridRows", "gridColumns", "alliesIncludeSelf", "capacity", "maxEvents", "maxWait" };
    public static readonly string[] Attributes = { "strength", "constitution", "intelligence", "spirit", "agility", "focus" };
    public static readonly string[] ActionFields = typeof(CombatActionConfig).GetFields().Select(f => f.Name).ToArray();
    public static string Text(JsonNode? value) => ContentProject.Text(value);
    public static JsonObject Clone(JsonObject value) => (JsonObject)value.DeepClone();
    public static double Number(JsonNode? value, double fallback = 0) => value is JsonValue json && json.GetValueKind() == JsonValueKind.Number &&
        double.TryParse(json.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out double number) ? number : fallback;
    public static int Int(JsonNode? value, int fallback = 0) => ContentProject.Integer(value) ?? fallback;
    public static JsonObject Object(JsonNode? value) => value as JsonObject ?? throw new ArgumentException("Expected JSON object.");
    public static JsonArray Array(JsonNode? value) => value as JsonArray ?? new JsonArray();
    public static JsonObject Entity(ContentProject project, string type, string id)
    {
        IdLookup lookup = project.Lookup(id);
        if (!lookup.exists || lookup.type != type) Fail("content", "", "reference_missing", "找不到" + type + "：" + id);
        return project.Documents[lookup.path].Value;
    }
    public static void Fail(string path, string field, string code, string message) => throw new ContentValidationException(new(false, new[] { ContentProject.Error(path, field, code, message) }, System.Array.Empty<string>()));
    public static JsonObject RuntimeAction(JsonObject skill) => Select(skill, ActionFields);
    public static CombatSession CheckScenario(JsonObject scenario, string path)
    {
        try { return new CombatSession(UnityJson.Read<CombatScenario>(scenario.ToJsonString())); }
        catch (ArgumentException error) { Fail(path, "", "runtime", error.Message); throw; }
    }
    public static CombatExpeditionSession CheckExpedition(JsonObject config, string path)
    {
        try { return new CombatExpeditionSession(UnityJson.Read<CombatExpeditionConfig>(config.ToJsonString())); }
        catch (ArgumentException error) { Fail(path, "", "runtime", error.Message); throw; }
    }
    public static JsonNode? RuntimeOnly(JsonNode? value, Type type)
    {
        if (value is JsonObject obj && type.IsClass)
        {
            var result = new JsonObject();
            foreach (FieldInfo field in type.GetFields(BindingFlags.Public | BindingFlags.Instance))
                if (obj.TryGetPropertyValue(field.Name, out JsonNode? child)) result[field.Name] = RuntimeOnly(child, field.FieldType);
            return result;
        }
        if (value is JsonArray array && type.IsArray) return new JsonArray(array.Select(v => RuntimeOnly(v, type.GetElementType()!)).ToArray());
        return value?.DeepClone();
    }
    public static JsonObject Select(JsonObject value, IEnumerable<string> fields)
    {
        var result = new JsonObject();
        foreach (string key in fields) if (value.TryGetPropertyValue(key, out JsonNode? field)) result[key] = field?.DeepClone();
        return result;
    }
    public static JsonObject StripMetadata(JsonObject value)
    {
        JsonObject result = Clone(value); result.Remove("notes"); result.Remove("draft"); return result;
    }

    public static List<ContentError> Validate(EntityDocument document, ContentProject project)
    {
        var errors = new List<ContentError>();
        JsonObject value = document.Value;
        string type = document.Type, path = document.Path, id = Text(value["id"]);
        void Error(string pointer, string code, string message) => errors.Add(ContentProject.Error(path, pointer, code, message));
        void Keys(JsonObject obj, string pointer, params string[] allowed)
        { foreach (var property in obj) if (!allowed.Contains(property.Key)) Error(pointer + "/" + property.Key, "unknown_field", "未知字段：" + property.Key); }
        void Num(JsonObject obj, string key, string pointer, double min = 0, double max = int.MaxValue, bool integer = false, bool required = true)
        {
            if (!obj.ContainsKey(key)) { if (required) Error(pointer + "/" + key, "required", "缺少字段：" + key); return; }
            double n = Number(obj[key], double.NaN);
            if (!double.IsFinite(n) || n < min || n > max || integer && Math.Truncate(n) != n)
                Error(pointer + "/" + key, "number", "数值范围或类型不合法：" + key);
        }
        void Str(JsonObject obj, string key, string pointer, bool required = false)
        { if (!obj.ContainsKey(key)) { if (required) Error(pointer + "/" + key, "required", "缺少字段：" + key); } else if (obj[key] is null && !required) return; else if (obj[key] is not JsonValue field || !field.TryGetValue<string>(out _)) Error(pointer + "/" + key, "string", "必须是字符串：" + key); }
        void Bool(JsonObject obj, string key, string pointer)
        { if (obj.ContainsKey(key) && (obj[key] is not JsonValue field || !field.TryGetValue<bool>(out _))) Error(pointer + "/" + key, "boolean", "必须是布尔值：" + key); }
        void Ref(string targetType, string target, string pointer)
        { IdLookup lookup = project.Lookup(target); if (!lookup.exists || lookup.type != targetType) Error(pointer, "reference_missing", "找不到" + targetType + "：" + target); }
        void Strings(JsonObject obj, string key, string pointer)
        {
            if (!obj.ContainsKey(key) || obj[key] is null) return;
            if (obj[key] is not JsonArray list) { Error(pointer + "/" + key, "array", "必须是字符串数组。"); return; }
            for (int i = 0; i < list.Count; i++) if (list[i] is not JsonValue f || !f.TryGetValue<string>(out _)) Error(pointer + "/" + key + "/" + i, "string", "必须是字符串。");
        }
        void Slots(JsonObject obj, string key)
        {
            if (obj[key] is not JsonArray slots) { Error("/" + key, "array", "必须是站位数组。"); return; }
            var cells = new HashSet<string>(StringComparer.Ordinal); var ids = new HashSet<string>(StringComparer.Ordinal);
            int max = 6;
            if (type == "trial" && Text(value["rulesId"]) != "" && project.Lookup(Text(value["rulesId"])) is { exists: true } found) max = Int(project.Documents[found.path].Value["maxUnitsPerTeam"], 6);
            if (slots.Count > max) Error("/" + key, "team_capacity", "超过每队容量：" + max);
            for (int i = 0; i < slots.Count; i++)
            {
                string p = "/" + key + "/" + i;
                if (slots[i] is not JsonObject slot) { Error(p, "object", "站位必须是对象。"); continue; }
                Keys(slot, p, "unitId", "characterId", "name", "team", "row", "column", "hp", "mp", "initialReadyTime", "vulnerable", "statuses", "equipmentDamageBonus", "equipmentSourceId");
                Str(slot, "unitId", p, true); Str(slot, "characterId", p, true);
                foreach (string field in new[] { "name", "team", "equipmentSourceId" }) Str(slot, field, p);
                Ref("character", Text(slot["characterId"]), p + "/characterId");
                if (!ids.Add(Text(slot["unitId"]))) Error(p + "/unitId", "duplicate_unit", "unitId不能重复。");
                Num(slot, "row", p, 0, 2, true); Num(slot, "column", p, 0, 2, true);
                string cell = Text(slot["team"]) + ":" + Int(slot["row"]) + ":" + Int(slot["column"]);
                if (!cells.Add(cell)) Error(p, "occupied", "同队站位不能重复。");
                foreach (string field in new[] { "hp", "mp", "equipmentDamageBonus" }) Num(slot, field, p, -1, int.MaxValue, true, false);
                Num(slot, "initialReadyTime", p, 0, double.MaxValue, false, false); Bool(slot, "vulnerable", p);
                if (slot["statuses"] is JsonArray statuses)
                    for (int n = 0; n < statuses.Count; n++)
                    {
                        string s = p + "/statuses/" + n;
                        if (statuses[n] is not JsonObject status) { Error(s, "object", "状态必须是对象。"); continue; }
                        Keys(status, s, "id", "kind", "magnitude", "appliedAt", "expiresAt");
                        Str(status, "id", s, true); Str(status, "kind", s, true);
                        Num(status, "magnitude", s, 0, int.MaxValue, true); Num(status, "appliedAt", s, 0, 0); Num(status, "expiresAt", s, 0, double.MaxValue);
                        if (!CombatTacticsCatalog.GetStatusKinds().Any(k => k.id == Text(status["kind"]))) Error(s + "/kind", "status_kind", "未知状态类别。");
                    }
                else if (slot["statuses"] is not null) Error(p + "/statuses", "array", "状态必须是数组。");
            }
        }
        switch (type)
        {
            case "skill":
                Keys(value, "", ActionFields.Concat(new[] { "schemaVersion", "description", "classTags", "draft", "notes", "aliases" }).ToArray());
                foreach (string key in new[] { "displayName", "effectKind", "statusId", "statusKind", "targetMode", "damageType", "description" }) Str(value, key, "", key == "effectKind");
                Num(value, "magnitude", "", 0, int.MaxValue, true); Num(value, "mpCost", "", 0, int.MaxValue, true); Num(value, "baseWait", "", double.Epsilon, double.MaxValue);
                Num(value, "statusMagnitude", "", 0, int.MaxValue, true, false); Num(value, "statusDuration", "", 0, double.MaxValue, false, false);
                Bool(value, "isMagic", ""); Bool(value, "draft", ""); Strings(value, "classTags", "");
                string effect = Text(value["effectKind"]);
                if (!CombatTacticsCatalog.GetEffectKinds().Any(k => k.id == effect))
                {
                    if (effect != "pending" || !ContentProject.Flag(value["draft"]) || !project.HasImplementationRequest(id, type)) Error("/effectKind", "pending_request", "未实现效果必须pending、draft并附非note需求单。");
                }
                foreach (var pair in new[] { ("targetMode", CombatTacticsCatalog.GetTargetModes()), ("damageType", CombatTacticsCatalog.GetDamageTypes()) })
                    if (Text(value[pair.Item1]) is string choice && choice != "" && !pair.Item2.Any(k => k.id == choice)) Error("/" + pair.Item1, "catalog", "选项不在核心目录中。");
                if (effect == "apply_status" && (!CombatTacticsCatalog.GetStatusKinds().Any(k => k.id == Text(value["statusKind"])) || Text(value["statusId"]) == "" || Number(value["statusDuration"]) <= 0)) Error("/statusKind", "status", "施加状态需要有效类别/ID和正持续时间。");
                break;
            case "rule":
                Keys(value, "", RuleFields.Concat(new[] { "schemaVersion", "id", "notes" }).ToArray());
                Num(value, "maxUnitsPerTeam", "", 1, 6, true); Num(value, "gridRows", "", 3, 3, true); Num(value, "gridColumns", "", 3, 3, true); Bool(value, "alliesIncludeSelf", "");
                Num(value, "maxEvents", "", 0, int.MaxValue, true, false); Num(value, "maxWait", "", 0, double.MaxValue, false, false);
                if (value["capacity"] is not JsonObject capacity) Error("/capacity", "required", "缺少容量规则。");
                else
                {
                    Keys(capacity, "/capacity", "baseSlots", "slotsPerIntelligence", "minimumSlots", "maximumSlots", "secondConditionAtIntelligence", "thirdConditionAtIntelligence");
                    Num(capacity, "baseSlots", "/capacity", 0, double.MaxValue); Num(capacity, "slotsPerIntelligence", "/capacity", 0, double.MaxValue);
                    foreach (string key in new[] { "minimumSlots", "maximumSlots", "secondConditionAtIntelligence", "thirdConditionAtIntelligence" }) Num(capacity, key, "/capacity", key.Contains("Slots", StringComparison.Ordinal) ? 1 : 0, int.MaxValue, true);
                    if (Number(capacity["maximumSlots"]) < Number(capacity["minimumSlots"]) || Number(capacity["thirdConditionAtIntelligence"]) < Number(capacity["secondConditionAtIntelligence"])) Error("/capacity", "range", "容量规则上下界无效。");
                }
                break;
            case "character":
                Keys(value, "", "schemaVersion", "id", "name", "role", "tags", "attributes", "combatOverride", "availableActionIds", "availableActionIdsExplicit", "instructions", "defaultEquipment", "draft", "notes", "aliases");
                Str(value, "name", "", true); Str(value, "role", ""); Bool(value, "draft", ""); Bool(value, "availableActionIdsExplicit", ""); Strings(value, "tags", ""); Strings(value, "availableActionIds", "");
                if (value["attributes"] is not JsonArray attributes || attributes.Count != 6) Error("/attributes", "attributes", "attributes必须按固定六维顺序。");
                else for (int i = 0; i < 6; i++)
                {
                    if (attributes[i] is not JsonObject attribute) { Error("/attributes/" + i, "object", "属性必须是对象。"); continue; }
                    Keys(attribute, "/attributes/" + i, "id", "value");
                    if (Text(attribute["id"]) != Attributes[i]) Error("/attributes/" + i + "/id", "attribute_order", "六维顺序不合法。");
                    Num(attribute, "value", "/attributes/" + i, 0, 999, true);
                }
                if (value["combatOverride"] is not JsonObject stats) Error("/combatOverride", "required", "必须手填combatOverride。");
                else { Keys(stats, "/combatOverride", "maxHp", "maxMp", "agilityFactor"); Num(stats, "maxHp", "/combatOverride", 1, int.MaxValue, true); Num(stats, "maxMp", "/combatOverride", 0, int.MaxValue, true); Num(stats, "agilityFactor", "/combatOverride", double.Epsilon, double.MaxValue); }
                foreach (JsonNode? action in Array(value["availableActionIds"])) Ref("skill", Text(action), "/availableActionIds");
                if (value["instructions"] is JsonArray instructions)
                {
                    var ids = new HashSet<string>(StringComparer.Ordinal);
                    for (int i = 0; i < instructions.Count; i++)
                    {
                        string p = "/instructions/" + i;
                        if (instructions[i] is not JsonObject instruction) { Error(p, "object", "指令必须是对象。"); continue; }
                        Keys(instruction, p, "id", "label", "condition", "scope", "selector", "actionId");
                        foreach (string key in new[] { "id", "label", "scope", "selector", "actionId" }) Str(instruction, key, p, key != "label");
                        if (!ids.Add(Text(instruction["id"]))) Error(p + "/id", "duplicate_instruction", "指令ID在角色内必须唯一。");
                        Ref("skill", Text(instruction["actionId"]), p + "/actionId");
                        if (!CombatTacticsCatalog.GetScopes().Any(k => k.id == Text(instruction["scope"]))) Error(p + "/scope", "catalog", "未知对象范围。");
                        if (!CombatTacticsCatalog.GetSelectors().Any(k => k.id == Text(instruction["selector"]))) Error(p + "/selector", "catalog", "未知选择方式。");
                        if (instruction["condition"] is not JsonObject condition) { Error(p + "/condition", "required", "缺少条件表达式。"); continue; }
                        Keys(condition, p + "/condition", "operation", "terms", "operators", "grouping");
                        Str(condition, "operation", p + "/condition", true); Str(condition, "grouping", p + "/condition"); Strings(condition, "operators", p + "/condition");
                        if (!CombatTacticsCatalog.GetOperations().Any(k => k.id == Text(condition["operation"]))) Error(p + "/condition/operation", "catalog", "未知条件组合方式。");
                        if (condition["terms"] is not JsonArray terms || terms.Count is < 1 or > 3) { Error(p + "/condition/terms", "conditions", "必须配置1至3个条件。"); continue; }
                        if (Text(condition["operation"]) == "mixed" && (terms.Count != 3 || condition["operators"] is not JsonArray operators || operators.Count != 2 || operators.Any(v => Text(v) is not "and" and not "or") || Text(condition["grouping"]) is not "left" and not "right")) Error(p + "/condition", "mixed", "mixed需要三项条件、两个and/or和明确left/right括号。");
                        for (int n = 0; n < terms.Count; n++)
                        {
                            string t = p + "/condition/terms/" + n;
                            if (terms[n] is not JsonObject term) { Error(t, "object", "条件项必须是对象。"); continue; }
                            Keys(term, t, "kind", "threshold", "subject", "value"); Str(term, "kind", t, true); Str(term, "subject", t); Str(term, "value", t);
                            CombatTacticsOption? option = CombatTacticsCatalog.GetConditions().FirstOrDefault(k => k.id == Text(term["kind"]));
                            if (option is null) { Error(t + "/kind", "catalog", "未知条件。"); continue; }
                            if (option.usesThreshold) Num(term, "threshold", t, option.minThreshold, option.maxThreshold, option.integerThreshold);
                            if (Text(term["subject"]) is string subject && subject != "" && !CombatTacticsCatalog.GetSubjects().Any(k => k.id == subject)) Error(t + "/subject", "catalog", "未知条件来源。");
                        }
                    }
                }
                else if (value["instructions"] is not null) Error("/instructions", "array", "指令必须是数组。");
                if (value.ContainsKey("defaultEquipment") && value["defaultEquipment"] is not JsonArray) Error("/defaultEquipment", "array", "装备必须是数组。");
                foreach (JsonNode? node in Array(value["defaultEquipment"]))
                    if (node is JsonObject equipment) { Keys(equipment, "/defaultEquipment", "slot", "itemId"); Ref("item", Text(equipment["itemId"]), "/defaultEquipment"); IdLookup item = project.Lookup(Text(equipment["itemId"])); if (item.exists && Text(project.Documents[item.path].Value["category"]) != "equipment") Error("/defaultEquipment", "equipment", "只能选择装备定义。"); }
                    else Error("/defaultEquipment", "object", "装备必须是对象。");
                break;
            case "encounter":
                Keys(value, "", "schemaVersion", "id", "name", "description", "enemies", "experiencePool", "publicCash", "publicDrops", "actionOverrides", "draft", "notes", "aliases");
                Str(value, "name", "", true); Str(value, "description", ""); Bool(value, "draft", ""); Slots(value, "enemies");
                Num(value, "experiencePool", "", 0, int.MaxValue, true, false); Num(value, "publicCash", "", 0, int.MaxValue, true, false);
                if (value.ContainsKey("publicDrops") && value["publicDrops"] is not JsonArray) Error("/publicDrops", "array", "掉落必须是数组。");
                foreach (JsonNode? node in Array(value["publicDrops"])) if (node is JsonObject drop) { Keys(drop, "/publicDrops", "itemId", "quantity"); Ref("item", Text(drop["itemId"]), "/publicDrops"); Num(drop, "quantity", "/publicDrops", 1, int.MaxValue, true); } else Error("/publicDrops", "object", "掉落必须是对象。");
                if (value.ContainsKey("actionOverrides") && value["actionOverrides"] is not JsonArray) Error("/actionOverrides", "array", "actionOverrides必须是数组。");
                var overrideIds = new HashSet<string>(StringComparer.Ordinal);
                foreach (JsonNode? node in Array(value["actionOverrides"]))
                {
                    if (node is not JsonObject local) { Error("/actionOverrides", "object", "本场技能覆盖必须是对象。"); continue; }
                    Keys(local, "/actionOverrides", "actionId", "fields", "remove");
                    string actionId = Text(local["actionId"]); Ref("skill", actionId, "/actionOverrides/actionId");
                    if (!overrideIds.Add(actionId)) Error("/actionOverrides/actionId", "duplicate_override", "同场动作覆盖不能重复。");
                    if (local["fields"] is not JsonObject fields) { Error("/actionOverrides/fields", "object", "fields必须是typed对象。"); continue; }
                    string[] allowed = ActionFields.Where(f => f != "id").ToArray();
                    Keys(fields, "/actionOverrides/fields", allowed);
                    if (local["remove"] is not JsonArray remove) { Error("/actionOverrides/remove", "array", "remove必须是字段名数组。"); continue; }
                    var removed = new HashSet<string>(StringComparer.Ordinal);
                    foreach (JsonNode? field in remove) if (!allowed.Contains(Text(field)) || !removed.Add(Text(field)) || fields.ContainsKey(Text(field))) Error("/actionOverrides/remove", "override_state", "inherit/set/remove互斥；remove字段必须唯一且不含id。");
                    IdLookup skill = project.Lookup(actionId);
                    if (skill.exists && skill.type == "skill")
                    {
                        try
                        {
                            JsonObject effective = ApplyActionOverride(RuntimeAction(project.Documents[skill.path].Value), local);
                            // Missing Runtime fields use that same DTO's defaults; numeric null/string still fail parsing.
                            effective = Object(JsonNode.Parse(UnityJson.Serialize(UnityJson.Read<CombatActionConfig>(effective.ToJsonString()))));
                            effective["schemaVersion"] = 1; effective["draft"] = false;
                            foreach (ContentError error in Validate(new(document.Path, "skill", effective), project)) Error("/actionOverrides" + error.field, error.code, error.message);
                        }
                        catch (JsonException error) { Error("/actionOverrides/fields", "type", error.Message); }
                    }
                }
                break;
            case "trial":
                Keys(value, "", "schemaVersion", "id", "title", "parameterNotice", "seed", "playerTeam", "allies", "encounters", "carryTeam", "rulesId", "runBudget", "draft", "notes", "aliases");
                foreach (string key in new[] { "title", "parameterNotice", "playerTeam", "carryTeam", "rulesId" }) Str(value, key, "", key == "title");
                Num(value, "seed", "", int.MinValue, int.MaxValue, true, false); Bool(value, "draft", ""); Slots(value, "allies");
                Ref("rule", Text(value["rulesId"]) is string ruleId && ruleId != "" ? ruleId : "rules_combat", "/rulesId");
                if (value["encounters"] is not JsonArray encounters || encounters.Count == 0) Error("/encounters", "encounters", "必须至少配置一场遭遇。");
                else for (int i = 0; i < encounters.Count; i++)
                {
                    if (encounters[i] is not JsonObject encounter) { Error("/encounters/" + i, "object", "场次必须是对象。"); continue; }
                    Keys(encounter, "/encounters/" + i, "encounterId", "waitBefore", "rulesId"); Ref("encounter", Text(encounter["encounterId"]), "/encounters/" + i + "/encounterId");
                    Num(encounter, "waitBefore", "/encounters/" + i, 0, double.MaxValue, false, false);
                    if (i == 0 && Number(encounter["waitBefore"]) != 0) Error("/encounters/0/waitBefore", "first_wait", "首场waitBefore必须为0。");
                    if (Text(encounter["rulesId"]) != "") Ref("rule", Text(encounter["rulesId"]), "/encounters/" + i + "/rulesId");
                }
                if (value["runBudget"] is JsonObject budget) { Keys(budget, "/runBudget", "maxSteps", "maxWait"); Num(budget, "maxSteps", "/runBudget", 1, int.MaxValue, true); Num(budget, "maxWait", "/runBudget", double.Epsilon, double.MaxValue); }
                else if (value.ContainsKey("runBudget")) Error("/runBudget", "object", "运行预算必须是对象。");
                break;
        }
        return errors;
    }

    public static ContentValidation ValidateCandidate(ContentProject project, string type, JsonObject entity, string mode, JsonArray? requests)
    {
        type = ContentStore.CanonicalType(type);
        string id = Text(entity["id"]), relative = ContentStore.DirectoryFor(type) + "/" + id + ".json";
        var errors = new List<ContentError>();
        if (mode is not "create" and not "update") errors.Add(ContentProject.Error(relative, "", "mode", "mode必须为create或update。"));
        if (mode == "create" && project.Lookup(id).exists) errors.Add(ContentProject.Error(relative, "/id", "id_conflict", "ID或别名已被占用：" + id));
        ContentProject candidate = project.With(relative, type, entity);
        int next = candidate.NextRequestNumber();
        if (requests is not null && requests.Any(r => r is not JsonObject)) throw new ArgumentException("需求草稿必须是对象。");
        foreach (JsonObject draft in (requests ?? new JsonArray()).OfType<JsonObject>())
        {
            JsonObject request = ContentProject.CompleteRequest(draft, id, next++, type);
            candidate = candidate.With("_requests/" + Text(request["id"]) + ".json", "request", request);
        }
        ContentValidation validation = candidate.Validate();
        return new(errors.Count == 0 && validation.ok, errors.Concat(validation.errors).ToArray(), validation.warnings);
    }

    public static JsonObject ApplyActionOverride(JsonObject shared, JsonObject? local)
    {
        JsonObject effective = Clone(shared);
        if (local?["fields"] is JsonObject fields) foreach (var field in fields) effective[field.Key] = field.Value?.DeepClone();
        foreach (JsonNode? field in Array(local?["remove"])) effective.Remove(Text(field));
        return effective;
    }
}
