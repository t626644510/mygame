using System.Text.Json.Nodes;
using Prototype.BaseEconomy;

namespace MyGame.Sim.Cli;

public static class BaseImport
{
    public static object FirstMeal(ContentProject project)
    {
        const string relativeSource = "Game/Assets/StreamingAssets/Prototype/BaseEconomy/default.json";
        byte[] source = File.ReadAllBytes(Path.Combine(project.Repository, relativeSource));
        BaseScenario scenario = UnityJson.Read<BaseScenario>(UnityJson.Utf8.GetString(source));
        scenario.Validate();
        var entities = new (string Type, JsonObject Value)[]
        {
            ("building", new JsonObject
            {
                ["schemaVersion"] = 1, ["id"] = "bld_legacy_kitchen", ["name"] = "首餐预置厨房",
                ["description"] = "旧首餐点状设施的静态设计映射，不代表免费建设或通用建筑运行时。",
                ["footprint"] = new JsonObject { ["w"] = 1, ["h"] = 1 }, ["walkableFootprint"] = true,
                ["entrance"] = new JsonObject { ["x"] = 0, ["y"] = 0 }, ["function"] = "workshop",
                ["recipeIds"] = new JsonArray("rcp_simple_meal"), ["workSlots"] = 1, ["storageSlots"] = 0, ["ownership"] = "both",
                ["buildCost"] = new JsonObject { ["cash"] = 0, ["workTicks"] = 0, ["materials"] = new JsonArray() },
                ["draft"] = false, ["notes"] = "旧场景没有建设价和施工字段；0仅静态占位，不能作为免费建设或正式经济规则。"
            }),
            ("recipe", new JsonObject
            {
                ["schemaVersion"] = 1, ["id"] = "rcp_simple_meal", ["name"] = "简餐",
                ["inputs"] = new JsonArray(new JsonObject { ["itemId"] = "mat_grain", ["quantity"] = scenario.grainPerMeal }),
                ["outputs"] = new JsonArray(new JsonObject { ["itemId"] = "con_simple_meal", ["quantity"] = 1 }),
                ["workTicks"] = scenario.productionTicks, ["workerTags"] = new JsonArray("cook"), ["draft"] = false,
                ["notes"] = "读取旧首餐grainPerMeal/productionTicks，仅静态配方，不接入新居民或通用生产运行时。"
            }),
            ("layout", Layout("layout_first_meal_near", "首餐·近厨房", scenario.nearKitchenPosition)),
            ("layout", Layout("layout_first_meal_far", "首餐·远厨房", scenario.farKitchenPosition))
        };
        var created = new List<object>(); var reused = new List<object>(); var errors = new List<ContentError>();
        var writes = new Dictionary<string, string?>(StringComparer.Ordinal);
        ContentProject prospective = project;
        foreach (var entity in entities)
        {
            string id = BaseContent.Text(entity.Value["id"]), relative = ContentStore.DirectoryFor(entity.Type) + "/" + id + ".json";
            if (project.Documents.TryGetValue(relative, out EntityDocument? existing))
            {
                foreach (string difference in Differences(existing.Value, entity.Value, "")) errors.Add(ContentProject.Error(relative, difference, "import_conflict", "已有首餐实体内容不同；未覆盖：" + id));
                reused.Add(new { type = entity.Type, id, path = relative });
            }
            else
            {
                IdLookup occupied = project.Lookup(id);
                if (occupied.exists) errors.Add(ContentProject.Error(relative, "/id", "id_conflict", "首餐ID已被其它实体或别名占用：" + id));
                prospective = prospective.With(relative, entity.Type, entity.Value); writes[relative] = UnityJson.Serialize(entity.Value);
                created.Add(new { type = entity.Type, id, path = relative });
            }
        }
        ContentValidation validation = prospective.Validate(); errors.AddRange(validation.errors);
        if (errors.Count != 0) throw new ContentValidationException(new(false, errors.ToArray(), validation.warnings));
        ContentEditing.Apply(project.Store, writes);
        return new { ok = true, created = created.ToArray(), reused = reused.ToArray(), source = new { path = relativeSource, sha256 = CombatImport.Hash(source) }, layoutIds = new[] { "layout_first_meal_near", "layout_first_meal_far" }, staticOnly = true };

        JsonObject Layout(string id, string name, GridPosition kitchen) => new()
        {
            ["schemaVersion"] = 1, ["id"] = id, ["name"] = name, ["width"] = scenario.mapWidth, ["height"] = scenario.mapHeight,
            ["movementTicksPerTile"] = scenario.movementTicksPerTile, ["tiles"] = new JsonArray(),
            ["buildings"] = new JsonArray(new JsonObject { ["instanceId"] = "kitchen_01", ["buildingId"] = "bld_legacy_kitchen", ["x"] = kitchen.x, ["y"] = kitchen.y, ["rotation"] = 0, ["ownership"] = "private" }),
            ["spawns"] = new JsonArray(
                new JsonObject { ["id"] = "supplier", ["x"] = scenario.supplierStart.x, ["y"] = scenario.supplierStart.y, ["role"] = "supplier" },
                new JsonObject { ["id"] = "customer", ["x"] = scenario.customerStart.x, ["y"] = scenario.customerStart.y, ["role"] = "customer" }),
            ["zones"] = new JsonArray(), ["draft"] = false, ["notes"] = scenario.testValueNotice
        };
    }

    private static IEnumerable<string> Differences(JsonNode? current, JsonNode? expected, string pointer)
    {
        if (JsonNode.DeepEquals(current, expected)) yield break;
        if (current is JsonObject a && expected is JsonObject b)
        {
            foreach (string key in a.Select(p => p.Key).Concat(b.Select(p => p.Key)).Distinct().Order(StringComparer.Ordinal))
                foreach (string difference in Differences(a[key], b[key], pointer + "/" + key.Replace("~", "~0").Replace("/", "~1"))) yield return difference;
        }
        else if (current is JsonArray x && expected is JsonArray y && x.Count == y.Count)
        {
            for (int i = 0; i < x.Count; i++) foreach (string difference in Differences(x[i], y[i], pointer + "/" + i)) yield return difference;
        }
        else yield return pointer;
    }
}
