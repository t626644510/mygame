using System.Text.Json.Nodes;

namespace MyGame.Sim.Cli;

public static class BaseContent
{
    public const string FlowRulesId = "rules_base_item_flows";
    public const string StaticNotice = "建筑与配方目前只做设计和静态检查，游戏运行时尚未接入。";
    public static readonly string[] Types = { "building", "recipe", "layout" };
    public static readonly string[] Functions = { "workshop", "storage", "housing", "shop", "public_service", "decoration", "pending" };
    public static readonly string[] SourceKinds = { "starting", "resident_sale", "external_market", "gathering" };
    public static readonly string[] SinkKinds = { "resident_need", "external_sale" };
    public static bool IsDocument(EntityDocument doc) => Types.Contains(doc.Type) || IsFlowRule(doc.Type, ContentProject.Text(doc.Value["id"]));
    public static bool IsFlowRule(string type, string id) => type is "rule" or "rules" && id == FlowRulesId;
    public static int Integer(JsonNode? value, int fallback = 0)
    {
        double number = CombatContent.Number(value, double.NaN);
        return double.IsFinite(number) && Math.Truncate(number) == number && number >= int.MinValue && number <= int.MaxValue ? (int)number : fallback;
    }
    public static JsonObject Object(JsonNode? value) => value as JsonObject ?? new JsonObject();
    public static JsonArray Array(JsonNode? value) => value as JsonArray ?? new JsonArray();
    public static string Text(JsonNode? value) => ContentProject.Text(value);
    public static string Canonical(ContentProject project, string id, string type = "item")
    {
        IdLookup found = project.Lookup(id);
        return found.exists && found.type == type ? found.canonicalId : id;
    }

    public static List<ContentError> Validate(EntityDocument doc, ContentProject project)
    {
        var v = new Validator(doc.Path, project);
        JsonObject value = doc.Value;
        string[] common = { "schemaVersion", "id", "name", "notes", "aliases", "draft" };
        if (doc.Type is "building" or "recipe" or "layout")
        {
            v.String(value, "name", "", true); v.Boolean(value, "draft", "", true);
            v.Strings(value, "aliases", "", false); v.String(value, "notes", "", false);
        }
        switch (doc.Type)
        {
            case "building":
                v.Keys(value, "", common.Concat(new[] { "description", "footprint", "walkableFootprint", "entrance", "function", "recipeIds", "workSlots", "storageSlots", "ownership", "buildCost" }).ToArray());
                v.String(value, "description", "", true); v.Boolean(value, "walkableFootprint", "", true);
                JsonObject? footprint = v.Object(value, "footprint", "");
                if (footprint is not null) { v.Keys(footprint, "/footprint", "w", "h"); v.Number(footprint, "w", "/footprint", 1, 16); v.Number(footprint, "h", "/footprint", 1, 16); }
                JsonObject? entrance = v.Object(value, "entrance", "");
                if (entrance is not null)
                {
                    v.Keys(entrance, "/entrance", "x", "y"); v.Number(entrance, "x", "/entrance", -1, 16); v.Number(entrance, "y", "/entrance", -1, 16);
                    if (footprint is not null)
                    {
                        int w = Integer(footprint["w"]), h = Integer(footprint["h"]), x = Integer(entrance["x"]), y = Integer(entrance["y"]);
                        bool inside = x >= 0 && x < w && y >= 0 && y < h;
                        bool adjacent = x >= 0 && x < w && (y == -1 || y == h) || y >= 0 && y < h && (x == -1 || x == w);
                        if (!adjacent && !(ContentProject.Flag(value["walkableFootprint"]) && inside)) v.Error("/entrance", "entrance", "入口必须正交相邻于占地外侧；可通行占地也允许内部入口。");
                    }
                }
                string function = v.Choice(value, "function", "", Functions);
                JsonArray? recipeIds = v.Strings(value, "recipeIds", "", true);
                if (recipeIds is not null)
                {
                    if (function != "workshop" && recipeIds.Count != 0) v.Error("/recipeIds", "function_recipes", "只有workshop可以引用配方。");
                    for (int i = 0; i < recipeIds.Count; i++) v.Reference("recipe", Text(recipeIds[i]), "/recipeIds/" + i);
                }
                foreach (string key in new[] { "workSlots", "storageSlots" }) v.Number(value, key, "", 0, int.MaxValue);
                v.Choice(value, "ownership", "", new[] { "public", "private", "both" });
                JsonObject? cost = v.Object(value, "buildCost", "");
                if (cost is not null)
                {
                    v.Keys(cost, "/buildCost", "cash", "workTicks", "materials");
                    v.Number(cost, "cash", "/buildCost", 0, int.MaxValue); v.Number(cost, "workTicks", "/buildCost", 0, int.MaxValue);
                    v.Amounts(cost, "materials", "/buildCost", 0);
                }
                if (function == "pending")
                {
                    if (!ContentProject.Flag(value["draft"])) v.Error("/draft", "implementation", "未实现建筑功能必须标为draft。");
                    string id = Text(value["id"]);
                    bool requested = project.Documents.Values.Any(d => d.Type == "request" && Text(d.Value["kind"]) == "new_building_function" && Text(d.Value["owner"]) == "base" &&
                        Text(d.Value["target"]).StartsWith("building:", StringComparison.Ordinal) && Canonical(project, Text(d.Value["target"])[9..], "building") == id);
                    if (!requested) v.Error("/function", "implementation_request", "未实现功能须关联owner=base、kind=new_building_function的建筑需求。");
                }
                break;
            case "recipe":
                v.Keys(value, "", common.Concat(new[] { "inputs", "outputs", "workTicks", "workerTags" }).ToArray());
                v.Amounts(value, "inputs", "", 0); v.Amounts(value, "outputs", "", 1);
                v.Number(value, "workTicks", "", 1, int.MaxValue); v.Strings(value, "workerTags", "", true);
                break;
            case "layout":
                v.Keys(value, "", common.Concat(new[] { "width", "height", "movementTicksPerTile", "tiles", "buildings", "spawns", "zones" }).ToArray());
                v.Number(value, "width", "", 1, 256); v.Number(value, "height", "", 1, 256); v.Number(value, "movementTicksPerTile", "", 1, int.MaxValue);
                JsonArray? tiles = v.Array(value, "tiles", "", 0, 65536);
                if (tiles is not null)
                {
                    var cells = new HashSet<(int, int)>();
                    for (int i = 0; i < tiles.Count; i++)
                    {
                        string p = "/tiles/" + i;
                        if (tiles[i] is not JsonObject tile) { v.Error(p, "object", "地形格必须为对象。"); continue; }
                        v.Keys(tile, p, "x", "y", "kind"); v.Coordinates(tile, p); v.Choice(tile, "kind", p, new[] { "blocked", "water" });
                        if (!cells.Add((Integer(tile["x"]), Integer(tile["y"])))) v.Error(p, "duplicate_tile", "同一格不能重复记录地形。");
                    }
                }
                JsonArray? instances = v.Array(value, "buildings", "", 0);
                if (instances is not null)
                {
                    var ids = new HashSet<string>(StringComparer.Ordinal);
                    for (int i = 0; i < instances.Count; i++)
                    {
                        string p = "/buildings/" + i;
                        if (instances[i] is not JsonObject instance) { v.Error(p, "object", "建筑实例必须为对象。"); continue; }
                        v.Keys(instance, p, "instanceId", "buildingId", "x", "y", "rotation", "ownership");
                        string id = v.String(instance, "instanceId", p, true, true);
                        if (!ids.Add(id)) v.Error(p + "/instanceId", "duplicate_instance", "布局内instanceId必须唯一。");
                        v.String(instance, "buildingId", p, true, true); v.Reference("building", Text(instance["buildingId"]), p + "/buildingId");
                        v.Coordinates(instance, p); v.Number(instance, "rotation", p, 0, 270);
                        if (!new[] { 0, 90, 180, 270 }.Contains(Integer(instance["rotation"]))) v.Error(p + "/rotation", "rotation", "rotation必须是0/90/180/270。");
                        v.Choice(instance, "ownership", p, new[] { "public", "private" });
                    }
                }
                JsonArray? spawns = v.Array(value, "spawns", "", 0);
                if (spawns is not null)
                {
                    var ids = new HashSet<string>(StringComparer.Ordinal);
                    for (int i = 0; i < spawns.Count; i++)
                    {
                        string p = "/spawns/" + i;
                        if (spawns[i] is not JsonObject spawn) { v.Error(p, "object", "出生点必须为对象。"); continue; }
                        v.Keys(spawn, p, "id", "x", "y", "role"); string id = v.String(spawn, "id", p, true, true);
                        if (!ids.Add(id)) v.Error(p + "/id", "duplicate_spawn", "布局内出生点ID必须唯一。");
                        v.Coordinates(spawn, p); v.String(spawn, "role", p, true, true);
                    }
                }
                v.Array(value, "zones", "", 0, 0);
                break;
            case "rule" when Text(value["id"]) == FlowRulesId:
                v.Keys(value, "", "schemaVersion", "id", "sources", "sinks", "notes"); v.String(value, "notes", "", false);
                foreach (string key in new[] { "sources", "sinks" })
                {
                    JsonArray? rows = v.Array(value, key, "", 0);
                    if (rows is null) continue;
                    for (int i = 0; i < rows.Count; i++)
                    {
                        string p = "/" + key + "/" + i;
                        if (rows[i] is not JsonObject row) { v.Error(p, "object", "物品流条目必须为对象。"); continue; }
                        v.Keys(row, p, "itemId", "kind", "note"); v.String(row, "itemId", p, true, true); v.Reference("item", Text(row["itemId"]), p + "/itemId");
                        v.Choice(row, "kind", p, key == "sources" ? SourceKinds : SinkKinds); v.String(row, "note", p, false);
                    }
                }
                break;
        }
        return v.Errors;
    }

    private sealed class Validator(string path, ContentProject project)
    {
        public List<ContentError> Errors { get; } = new();
        public void Error(string field, string code, string message) => Errors.Add(ContentProject.Error(path, field, code, message));
        public void Keys(JsonObject obj, string pointer, params string[] allowed)
        {
            foreach (string key in obj.Select(p => p.Key)) if (!allowed.Contains(key)) Error(pointer + "/" + key.Replace("~", "~0").Replace("/", "~1"), "unknown_field", "未知字段：" + key);
        }
        public string String(JsonObject obj, string key, string pointer, bool required, bool nonempty = false)
        {
            string field = pointer + "/" + key;
            if (!obj.ContainsKey(key)) { if (required) Error(field, "required", "缺少字段：" + key); return ""; }
            if (obj[key] is not JsonValue value || !value.TryGetValue<string>(out string? text)) { Error(field, "string", "必须是字符串：" + key); return ""; }
            if (nonempty && string.IsNullOrWhiteSpace(text)) Error(field, "required", "字符串不能为空：" + key);
            return text ?? "";
        }
        public string Choice(JsonObject obj, string key, string pointer, string[] choices)
        {
            string text = String(obj, key, pointer, true);
            if (!choices.Contains(text)) Error(pointer + "/" + key, "enum", "不支持的选项：" + key);
            return text;
        }
        public void Boolean(JsonObject obj, string key, string pointer, bool required)
        {
            if (!obj.ContainsKey(key)) { if (required) Error(pointer + "/" + key, "required", "缺少字段：" + key); }
            else if (obj[key] is not JsonValue field || !field.TryGetValue<bool>(out _)) Error(pointer + "/" + key, "boolean", "必须是布尔值：" + key);
        }
        public void Number(JsonObject obj, string key, string pointer, int min, int max)
        {
            double value = CombatContent.Number(obj[key], double.NaN);
            if (!obj.ContainsKey(key)) Error(pointer + "/" + key, "required", "缺少字段：" + key);
            else if (!double.IsFinite(value) || Math.Truncate(value) != value || value < min || value > max) Error(pointer + "/" + key, "integer", "必须是范围内的32位整数：" + key);
        }
        public void Coordinates(JsonObject obj, string pointer)
        { Number(obj, "x", pointer, int.MinValue, int.MaxValue); Number(obj, "y", pointer, int.MinValue, int.MaxValue); }
        public JsonObject? Object(JsonObject obj, string key, string pointer)
        {
            if (obj[key] is JsonObject value) return value;
            Error(pointer + "/" + key, "object", "必须是对象：" + key); return null;
        }
        public JsonArray? Array(JsonObject obj, string key, string pointer, int min, int max = int.MaxValue, bool required = true)
        {
            if (!obj.ContainsKey(key) && !required) return null;
            if (obj[key] is not JsonArray value) { Error(pointer + "/" + key, "array", "必须是数组：" + key); return null; }
            if (value.Count < min || value.Count > max) Error(pointer + "/" + key, "array_count", "数组项数超出范围：" + key);
            return value;
        }
        public JsonArray? Strings(JsonObject obj, string key, string pointer, bool required)
        {
            JsonArray? array = Array(obj, key, pointer, 0, required: required);
            if (array is not null) for (int i = 0; i < array.Count; i++) if (array[i] is not JsonValue value || !value.TryGetValue<string>(out _)) Error(pointer + "/" + key + "/" + i, "string", "必须是字符串。");
            return array;
        }
        public void Reference(string type, string id, string field)
        {
            IdLookup found = project.Lookup(id);
            if (!found.exists || found.type != type) Error(field, "reference_missing", "找不到" + type + "定义：" + id);
        }
        public void Amounts(JsonObject obj, string key, string pointer, int min)
        {
            JsonArray? rows = Array(obj, key, pointer, min);
            if (rows is null) return;
            for (int i = 0; i < rows.Count; i++)
            {
                string p = pointer + "/" + key + "/" + i;
                if (rows[i] is not JsonObject row) { Error(p, "object", "物品数量必须为对象。"); continue; }
                Keys(row, p, "itemId", "quantity"); String(row, "itemId", p, true, true); Number(row, "quantity", p, 1, int.MaxValue); Reference("item", Text(row["itemId"]), p + "/itemId");
            }
        }
    }
}
