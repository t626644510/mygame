using System.Text.Json.Nodes;

namespace MyGame.Sim.Cli;

public static class BaseExports
{
    public static BaseChainResult? Contribute(ContentProject project, SortedDictionary<string, (string Text, int Count)> generated, List<ContentError> errors)
    {
        if (!project.Documents.Values.Any(BaseContent.IsDocument)) return null;
        var spatial = BaseLayouts.ValidateAll(project); errors.AddRange(spatial.Errors);
        foreach (EntityDocument doc in project.Documents.Values.Where(d => BaseContent.IsDocument(d) && !ContentProject.Flag(d.Value["draft"])))
            foreach (ReferenceOccurrence reference in ReferenceIndex.Walk(doc.Value, "", doc.Type, BaseContent.Text(doc.Value["id"]), doc.Path, false).Concat(ReferenceIndex.BaseWalk(doc.Value, "", doc.Type, BaseContent.Text(doc.Value["id"]), doc.Path)))
            {
                IdLookup target = project.Lookup(reference.Id);
                if (target.exists && target.type == reference.TargetType && ContentProject.Flag(project.Documents[target.path].Value["draft"]))
                    errors.Add(ContentProject.Error(doc.Path, reference.Reference.jsonPointer, "draft_dependency", "有效静态定义依赖了不会导出的草稿：" + target.canonicalId));
            }
        if (errors.Count != 0) return null;
        foreach (string type in BaseContent.Types)
        {
            var values = new JsonArray();
            foreach (EntityDocument doc in project.Documents.Values.Where(d => d.Type == type && !ContentProject.Flag(d.Value["draft"])).OrderBy(d => BaseContent.Text(d.Value["id"]), StringComparer.Ordinal))
            {
                JsonObject value = (JsonObject)doc.Value.DeepClone(); ContentExport.StripEditorFields(value); values.Add(value);
            }
            string plural = ContentStore.DirectoryFor(type);
            generated[plural + ".json"] = (UnityJson.Serialize(new JsonObject { ["schemaVersion"] = 1, [plural] = values }), values.Count);
        }
        JsonObject flow = project.Documents.Values.FirstOrDefault(d => BaseContent.IsFlowRule(d.Type, BaseContent.Text(d.Value["id"])))?.Value.DeepClone() as JsonObject
            ?? new JsonObject { ["schemaVersion"] = 1, ["id"] = BaseContent.FlowRulesId, ["sources"] = new JsonArray(), ["sinks"] = new JsonArray() };
        ContentExport.StripEditorFields(flow);
        foreach (string kind in new[] { "sources", "sinks" }) foreach (JsonObject row in BaseContent.Array(flow[kind]).OfType<JsonObject>()) row.Remove("note");
        generated["base_item_flows.json"] = (UnityJson.Serialize(flow), 1);
        // All five chain flags are non-blocking design hints. Never feed them into errors.
        return BaseChains.Analyze(project);
    }
}
