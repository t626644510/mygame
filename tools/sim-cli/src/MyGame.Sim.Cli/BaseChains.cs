using System.Text.Json.Nodes;

namespace MyGame.Sim.Cli;

public sealed record BaseChainResult(object[] items, object[] recipes, string[][] cycles, object graph, BaseIssue[] issues, string[] excludedDraftIds);

public static class BaseChains
{
    public static BaseChainResult Analyze(ContentProject project)
    {
        ContentValidation validation = project.Validate();
        if (!validation.ok) throw new ContentValidationException(validation);
        EntityDocument[] active = project.Documents.Values.Where(d => d.Type != "request" && !ContentProject.Flag(d.Value["draft"])).ToArray();
        EntityDocument[] items = active.Where(d => d.Type == "item").ToArray(), recipes = active.Where(d => d.Type == "recipe").ToArray();
        var sources = new Dictionary<string, List<BaseFlow>>(StringComparer.Ordinal);
        var sinks = new Dictionary<string, List<BaseFlow>>(StringComparer.Ordinal);
        var issues = new List<BaseIssue>();
        var itemFlags = new Dictionary<string, SortedSet<string>>(StringComparer.Ordinal);
        var recipeFlags = recipes.ToDictionary(d => Id(d), _ => new SortedSet<string>(StringComparer.Ordinal), StringComparer.Ordinal);
        var requiredItems = new HashSet<string>(StringComparer.Ordinal); var producedItems = new HashSet<string>(StringComparer.Ordinal);
        var graphEdges = new List<object>();
        foreach (EntityDocument item in items) { sources[Id(item)] = new(); sinks[Id(item)] = new(); itemFlags[Id(item)] = new(StringComparer.Ordinal); }
        string Canonical(string id) => BaseContent.Canonical(project, id);
        void Flow(Dictionary<string, List<BaseFlow>> collection, string raw, BaseFlow flow)
        {
            string id = Canonical(raw);
            if (!collection.TryGetValue(id, out List<BaseFlow>? list)) collection[id] = list = new();
            list.Add(flow);
        }
        foreach (EntityDocument recipe in recipes)
        {
            string recipeId = Id(recipe);
            foreach (string direction in new[] { "inputs", "outputs" })
            {
                JsonArray amounts = BaseContent.Array(recipe.Value[direction]);
                for (int index = 0; index < amounts.Count; index++)
                {
                    JsonObject amount = BaseContent.Object(amounts[index]); string itemId = Canonical(BaseContent.Text(amount["itemId"]));
                    int quantity = BaseContent.Integer(amount["quantity"]); bool input = direction == "inputs";
                    if (input) requiredItems.Add(itemId); else producedItems.Add(itemId);
                    Flow(input ? sinks : sources, itemId, new(input ? "recipe_input" : "recipe_output", "recipe", recipeId, recipe.Path, "/" + direction + "/" + index + "/itemId", quantity));
                    graphEdges.Add(new { id = recipeId + ":" + (input ? "input" : "output") + ":" + index, source = input ? "item:" + itemId : "recipe:" + recipeId,
                        target = input ? "recipe:" + recipeId : "item:" + itemId, itemId, recipeId, quantity });
                }
            }
        }
        foreach (EntityDocument building in active.Where(d => d.Type == "building"))
        {
            JsonArray materials = BaseContent.Array(BaseContent.Object(building.Value["buildCost"])["materials"]);
            for (int i = 0; i < materials.Count; i++)
            {
                JsonObject amount = BaseContent.Object(materials[i]); string id = Canonical(BaseContent.Text(amount["itemId"])); requiredItems.Add(id);
                Flow(sinks, id, new("building_cost", "building", Id(building), building.Path, "/buildCost/materials/" + i + "/itemId", BaseContent.Integer(amount["quantity"])));
            }
        }
        foreach (EntityDocument item in items)
            foreach (ReferenceOccurrence occurrence in ReferenceIndex.Walk(item.Value, "", "item", Id(item), item.Path, false).Where(r => r.Reference.jsonPointer.StartsWith("/equipment/enhancement/", StringComparison.Ordinal)))
            {
                string id = Canonical(occurrence.Id); requiredItems.Add(id);
                Flow(sinks, id, new("enhancement_material", "item", Id(item), item.Path, occurrence.Reference.jsonPointer, occurrence.Reference.quantity));
            }
        foreach (EntityDocument rule in active.Where(d => BaseContent.IsFlowRule(d.Type, Id(d))))
            foreach (string key in new[] { "sources", "sinks" })
            {
                JsonArray rows = BaseContent.Array(rule.Value[key]);
                for (int i = 0; i < rows.Count; i++)
                {
                    JsonObject row = BaseContent.Object(rows[i]);
                    Flow(key == "sources" ? sources : sinks, BaseContent.Text(row["itemId"]), new(BaseContent.Text(row["kind"]), "rule", Id(rule), rule.Path, "/" + key + "/" + i + "/itemId", null));
                }
            }
        foreach (ReferenceOccurrence occurrence in ReferenceIndex.Legacy(project).Where(r => r.Reference.direction == "source"))
            if (project.Lookup(occurrence.Id) is { exists: true, type: "item" })
                Flow(sources, occurrence.Id, new("combat_drop", occurrence.Reference.sourceType, occurrence.Reference.sourceId, occurrence.Reference.path, occurrence.Reference.jsonPointer, occurrence.Reference.quantity));
        foreach (EntityDocument encounter in active.Where(d => d.Type == "encounter"))
            foreach (ReferenceOccurrence occurrence in ReferenceIndex.Walk(encounter.Value, "", "encounter", Id(encounter), encounter.Path, false).Where(r => r.Reference.direction == "source"))
                Flow(sources, occurrence.Id, new("combat_drop", "encounter", Id(encounter), encounter.Path, occurrence.Reference.jsonPointer, occurrence.Reference.quantity));

        foreach (EntityDocument item in items)
        {
            string id = Id(item);
            if (requiredItems.Contains(id) && (!sources.TryGetValue(id, out List<BaseFlow>? origin) || origin.Count == 0)) ItemFlag(id, "no_source", "作为投入或消耗的物品尚无已登记来源。", item.Path);
            if (producedItems.Contains(id) && (!sinks.TryGetValue(id, out List<BaseFlow>? uses) || uses.Count == 0)) ItemFlag(id, "no_sink", "配方产物尚无已登记去处。", item.Path);
        }
        var byInput = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        foreach (EntityDocument recipe in recipes)
            foreach (JsonObject amount in BaseContent.Array(recipe.Value["inputs"]).OfType<JsonObject>())
            {
                string id = Canonical(BaseContent.Text(amount["itemId"]));
                if (!byInput.TryGetValue(id, out HashSet<string>? found)) byInput[id] = found = new(StringComparer.Ordinal);
                found.Add(Id(recipe));
            }
        var adjacency = recipes.ToDictionary(d => Id(d), _ => new SortedSet<string>(StringComparer.Ordinal), StringComparer.Ordinal);
        foreach (EntityDocument recipe in recipes)
            foreach (JsonObject amount in BaseContent.Array(recipe.Value["outputs"]).OfType<JsonObject>())
                if (byInput.TryGetValue(Canonical(BaseContent.Text(amount["itemId"])), out HashSet<string>? consumers)) adjacency[Id(recipe)].UnionWith(consumers);
        string[][] cycles = Components(adjacency).Where(c => c.Length > 1 || adjacency[c[0]].Contains(c[0])).OrderBy(c => c[0], StringComparer.Ordinal).ToArray();
        foreach (string[] component in cycles)
            foreach (string recipeId in component) RecipeFlag(recipeId, "cycle", "配方处于有向循环中：" + string.Join(" → ", component), "");
        var recipeResults = new List<object>();
        foreach (EntityDocument recipe in recipes)
        {
            string recipeId = Id(recipe);
            // A definition reference is enough. Placement is deliberately not part of this test.
            string[] buildings = project.Documents.Values.Where(d => d.Type == "building" && BaseContent.Array(d.Value["recipeIds"]).Any(r => BaseContent.Canonical(project, BaseContent.Text(r), "recipe") == recipeId)).Select(Id).Order(StringComparer.Ordinal).ToArray();
            if (buildings.Length == 0) RecipeFlag(recipeId, "no_building", "尚无建筑定义引用此配方。", "");
            decimal inputValue = Value(recipe.Value["inputs"]), outputValue = Value(recipe.Value["outputs"]);
            int workTicks = BaseContent.Integer(recipe.Value["workTicks"]);
            decimal margin = decimal.Round((outputValue - inputValue) / workTicks, 4, MidpointRounding.ToEven);
            if (outputValue <= inputValue) RecipeFlag(recipeId, "non_positive_margin", "单位工时参考增值不为正；这不是正式经济平衡结论。", "/workTicks");
            recipeResults.Add(new { recipeId, buildings, inputValue, outputValue, workTicks, valueAddedPerTick = margin, flags = recipeFlags[recipeId].ToArray() });
        }
        var nodes = new List<object>();
        foreach (EntityDocument item in items)
        {
            string[] flags = itemFlags[Id(item)].ToArray();
            nodes.Add(new { id = "item:" + Id(item), type = "item", entityId = Id(item), label = BaseContent.Text(item.Value["name"]), flags, tone = Tone(flags) });
        }
        // Keep referenced draft endpoints visible as unavailable helper nodes, never as active source/output definitions.
        foreach (string id in requiredItems.Concat(producedItems).Except(items.Select(Id), StringComparer.Ordinal).Distinct().Order(StringComparer.Ordinal))
            if (project.Lookup(id) is { exists: true, type: "item" } found)
                nodes.Add(new { id = "item:" + id, type = "item", entityId = id, label = BaseContent.Text(project.Documents[found.path].Value["name"]), flags = new[] { "draft_dependency" }, tone = "red" });
        foreach (EntityDocument recipe in recipes)
        {
            string[] flags = recipeFlags[Id(recipe)].ToArray();
            nodes.Add(new { id = "recipe:" + Id(recipe), type = "recipe", entityId = Id(recipe), label = BaseContent.Text(recipe.Value["name"]), flags, tone = Tone(flags) });
        }
        return new(
            items.Select(item => (object)new { itemId = Id(item), sources = Sorted(sources, Id(item)), sinks = Sorted(sinks, Id(item)), flags = itemFlags[Id(item)].ToArray() }).ToArray(),
            recipeResults.ToArray(), cycles, new { nodes = nodes.ToArray(), edges = graphEdges.ToArray() },
            issues.OrderBy(i => i.entityType, StringComparer.Ordinal).ThenBy(i => i.entityId, StringComparer.Ordinal).ThenBy(i => i.code, StringComparer.Ordinal).ToArray(),
            project.Documents.Values.Where(d => d.Type != "request" && ContentProject.Flag(d.Value["draft"])).Select(d => d.Type + ":" + Id(d)).Order(StringComparer.Ordinal).ToArray());

        decimal Value(JsonNode? list) => BaseContent.Array(list).OfType<JsonObject>().Sum(amount =>
        {
            IdLookup found = project.Lookup(BaseContent.Text(amount["itemId"]));
            return (decimal)BaseContent.Integer(amount["quantity"]) * BaseContent.Integer(project.Documents[found.path].Value["baseValue"]);
        });
        void ItemFlag(string id, string code, string message, string path)
        {
            itemFlags[id].Add(code); issues.Add(new(code, message, "warning", false, "item", id, ""));
        }
        void RecipeFlag(string id, string code, string message, string field)
        {
            recipeFlags[id].Add(code); issues.Add(new(code, message, "warning", false, "recipe", id, field));
        }
    }

    private static string Id(EntityDocument doc) => BaseContent.Text(doc.Value["id"]);
    private static string Tone(string[] flags) => flags.Length == 0 ? "normal" : flags.All(f => f == "non_positive_margin") ? "amber" : "red";
    private static BaseFlow[] Sorted(Dictionary<string, List<BaseFlow>> map, string id) => map.TryGetValue(id, out List<BaseFlow>? values)
        ? values.Distinct().OrderBy(f => f.path, StringComparer.Ordinal).ThenBy(f => f.jsonPointer, StringComparer.Ordinal).ThenBy(f => f.kind, StringComparer.Ordinal).ToArray() : System.Array.Empty<BaseFlow>();

    private static List<string[]> Components(IDictionary<string, SortedSet<string>> graph)
    {
        int next = 0; var index = new Dictionary<string, int>(StringComparer.Ordinal); var low = new Dictionary<string, int>(StringComparer.Ordinal);
        var stack = new Stack<string>(); var onStack = new HashSet<string>(StringComparer.Ordinal); var result = new List<string[]>();
        foreach (string node in graph.Keys.Order(StringComparer.Ordinal)) if (!index.ContainsKey(node)) Visit(node);
        return result;
        void Visit(string node)
        {
            index[node] = low[node] = next++; stack.Push(node); onStack.Add(node);
            foreach (string edge in graph[node])
            {
                if (!index.ContainsKey(edge)) { Visit(edge); low[node] = Math.Min(low[node], low[edge]); }
                else if (onStack.Contains(edge)) low[node] = Math.Min(low[node], index[edge]);
            }
            if (low[node] != index[node]) return;
            var component = new List<string>(); string current;
            do { current = stack.Pop(); onStack.Remove(current); component.Add(current); } while (current != node);
            result.Add(component.Order(StringComparer.Ordinal).ToArray());
        }
    }
}
