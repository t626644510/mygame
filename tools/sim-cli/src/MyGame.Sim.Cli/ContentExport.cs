using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace MyGame.Sim.Cli;

public static class ContentExport
{
    public static object Export(ContentProject project, string output)
    {
        ContentValidation validation = project.Validate();
        if (!validation.ok) throw new ContentValidationException(validation);
        var items = new JsonArray();
        var errors = new List<ContentError>();
        foreach (EntityDocument doc in project.Documents.Values.Where(doc => doc.Type == "item" && !ContentProject.Flag(doc.Value["draft"])).OrderBy(doc => ContentProject.Text(doc.Value["id"]), StringComparer.Ordinal))
        {
            foreach (ReferenceOccurrence reference in ReferenceIndex.Walk(doc.Value, "", "item", ContentProject.Text(doc.Value["id"]), doc.Path, false))
            {
                IdLookup target = project.Lookup(reference.Id);
                if (target.exists && target.type == "item" && ContentProject.Flag(project.Documents[target.path].Value["draft"])) errors.Add(ContentProject.Error(doc.Path, reference.Reference.jsonPointer, "draft_dependency", "有效物品引用了不会导出的草稿物品：" + target.canonicalId));
            }
            JsonObject item = (JsonObject)doc.Value.DeepClone();
            StripEditorFields(item);
            items.Add(item);
        }
        if (errors.Count != 0) throw new ContentValidationException(new(false, errors.ToArray(), Array.Empty<string>()));
        var generated = new SortedDictionary<string, (string Text, int Count)>(StringComparer.Ordinal)
        { ["items.json"] = (UnityJson.Serialize(new JsonObject { ["schemaVersion"] = 1, ["items"] = items }), items.Count) };
        foreach (string type in new[] { "skill", "character", "encounter" })
        {
            // P1-only content roots keep their original one-table manifest bytes.
            if (!project.Documents.Values.Any(d => d.Type == type)) continue;
            var values = new JsonArray();
            foreach (EntityDocument doc in project.Documents.Values.Where(d => d.Type == type && !ContentProject.Flag(d.Value["draft"])).OrderBy(d => ContentProject.Text(d.Value["id"]), StringComparer.Ordinal))
            {
                foreach (ReferenceOccurrence reference in ReferenceIndex.CombatWalk(doc.Value, "", type, ContentProject.Text(doc.Value["id"]), doc.Path, false).Concat(ReferenceIndex.Walk(doc.Value, "", type, ContentProject.Text(doc.Value["id"]), doc.Path, false)))
                {
                    IdLookup target = project.Lookup(reference.Id);
                    if (target.exists && ContentProject.Flag(project.Documents[target.path].Value["draft"])) errors.Add(ContentProject.Error(doc.Path, reference.Reference.jsonPointer, "draft_dependency", "有效定义依赖不会导出的草稿：" + target.canonicalId));
                }
                JsonObject value = type == "skill" ? CombatContent.RuntimeAction(doc.Value) : (JsonObject)doc.Value.DeepClone();
                StripEditorFields(value); values.Add(value);
            }
            string plural = ContentStore.DirectoryFor(type);
            generated[plural + ".json"] = (UnityJson.Serialize(new JsonObject { ["schemaVersion"] = 1, [plural] = values }), values.Count);
        }
        BaseChainResult? baseAnalysis = BaseExports.Contribute(project, generated, errors);
        if (errors.Count != 0) throw new ContentValidationException(new(false, errors.ToArray(), Array.Empty<string>()));
        var files = generated.Select(pair => new { path = pair.Key, sha256 = Hash(UnityJson.Utf8.GetBytes(pair.Value.Text)), count = pair.Value.Count }).ToArray();
        string contentHash = Hash(UnityJson.Utf8.GetBytes(string.Concat(files.Select(file => file.path + "\n" + file.sha256 + "\n"))));
        string manifest = UnityJson.Serialize(new { schemaVersion = 1, contentHash, files });
        var destination = new ContentStore(output);
        var writes = generated.ToDictionary(pair => pair.Key, pair => (string?)pair.Value.Text, StringComparer.Ordinal);
        writes["manifest.json"] = manifest;
        string previousManifest = destination.Resolve("manifest.json");
        if (File.Exists(previousManifest))
        {
            JsonObject previous = JsonNode.Parse(File.ReadAllText(previousManifest)) as JsonObject ?? throw new ArgumentException("上次export清单无效。");
            if (previous["files"] is not JsonArray previousFiles) throw new ArgumentException("上次export清单缺少files。");
            foreach (JsonNode? node in previousFiles)
            {
                if (node is not JsonObject entry) throw new ArgumentException("上次export清单文件记录无效。");
                string path = ContentProject.Text(entry["path"]);
                destination.Resolve(path.Split('/'));
                if (path.EndsWith(".meta", StringComparison.OrdinalIgnoreCase) || path == "manifest.json") continue;
                if (!writes.ContainsKey(path)) writes[path] = null;
            }
        }
        ContentEditing.Apply(destination, writes);
        return baseAnalysis is null ? new { ok = true, contentHash, files, exportRoot = destination.Root } :
            new { ok = true, contentHash, files, exportRoot = destination.Root, analysisWarnings = baseAnalysis.issues, staticOnly = true };
    }

    internal static void StripEditorFields(JsonNode? node)
    {
        if (node is JsonObject obj)
        {
            obj.Remove("notes"); obj.Remove("draft");
            foreach (var property in obj.ToArray()) StripEditorFields(property.Value);
        }
        else if (node is JsonArray array) foreach (JsonNode? child in array) StripEditorFields(child);
    }
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
}
