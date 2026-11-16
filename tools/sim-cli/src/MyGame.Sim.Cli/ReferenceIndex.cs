using System.Text.Json.Nodes;

namespace MyGame.Sim.Cli;

public sealed record ItemReference(string sourceType, string sourceId, string path, string jsonPointer, int? quantity, bool legacy, string direction);
public sealed record ReferenceOccurrence(string Id, ItemReference Reference);

public static class ReferenceIndex
{
    private static readonly string[] Fields = { "itemId", "oreItemId", "auxiliaryItemId", "combatItemId", "preparationItemId", "equipmentSourceId" };

    public static IEnumerable<ReferenceOccurrence> Walk(JsonNode? node, string pointer, string sourceType, string sourceId, string path, bool legacy)
    {
        if (node is JsonArray array)
        {
            for (int i = 0; i < array.Count; i++) foreach (var value in Walk(array[i], pointer + "/" + i, sourceType, sourceId, path, legacy)) yield return value;
        }
        else if (node is JsonObject obj)
        {
            foreach (var property in obj)
            {
                string child = pointer + "/" + Escape(property.Key);
                string id = ContentProject.Text(property.Value);
                if (Fields.Contains(property.Key) && id != "")
                {
                    string lower = child.ToLowerInvariant();
                    string direction = property.Key is "combatItemId" or "preparationItemId" ? "mapping" :
                        property.Key is "oreItemId" or "auxiliaryItemId" || lower.Contains("/materials/", StringComparison.Ordinal) ? "usage" :
                        lower.Contains("drop", StringComparison.Ordinal) || lower.Contains("/loot/", StringComparison.Ordinal) || lower.Contains("reward", StringComparison.Ordinal) ? "source" :
                        property.Key == "equipmentSourceId" ? "usage" : "reference";
                    yield return new(id, new(sourceType, sourceId, path, child, ContentProject.Integer(obj["quantity"]), legacy, direction));
                }
                if (property.Key != "notes") foreach (var value in Walk(property.Value, child, sourceType, sourceId, path, legacy)) yield return value;
            }
        }
    }

    public static ReferenceOccurrence[] Legacy(ContentProject project)
    {
        string root = Path.Combine(project.Repository, "Game", "Assets", "StreamingAssets", "Prototype");
        var result = new List<ReferenceOccurrence>();
        foreach (string file in Directory.GetFiles(root, "*.json", SearchOption.AllDirectories).Order(StringComparer.Ordinal))
        {
            JsonNode? value = JsonNode.Parse(File.ReadAllText(file));
            string path = Path.GetRelativePath(project.Repository, file).Replace('\\', '/');
            string type = path.Contains("/Combat/", StringComparison.Ordinal) ? "legacy_combat" : path.Contains("/BaseEconomy/", StringComparison.Ordinal) ? "legacy_base" : "legacy_expedition";
            string id = value is JsonObject obj ? ContentProject.Text(obj["id"]) : "";
            if (id == "" && value is JsonObject scenario) id = ContentProject.Text(scenario["scenarioId"]);
            if (id == "") id = Path.GetFileNameWithoutExtension(file);
            result.AddRange(Walk(value, "", type, id, path, true));
        }
        return result.ToArray();
    }

    public static ItemReference[] Refs(ContentProject project, string id)
    {
        IdLookup requested = project.Lookup(id);
        bool Matches(string raw) => requested.exists ? project.Lookup(raw) is { exists: true } found && found.canonicalId == requested.canonicalId && found.type == requested.type : raw == id;
        var values = new List<ReferenceOccurrence>(Legacy(project));
        foreach (EntityDocument doc in project.Documents.Values)
        {
            string sourceId = ContentProject.Text(doc.Value["id"]);
            if (doc.Type == "request")
            {
                string target = ContentProject.Text(doc.Value["target"]);
                if (target.StartsWith("item:", StringComparison.Ordinal)) values.Add(new(target[5..], new("request", sourceId, doc.Path, "/target", null, false, "reference")));
            }
            else values.AddRange(Walk(doc.Value, "", doc.Type, sourceId, doc.Path, false));
        }
        return values.Where(value => Matches(value.Id)).Select(value => value.Reference).OrderBy(value => value.path, StringComparer.Ordinal).ThenBy(value => value.jsonPointer, StringComparer.Ordinal).ToArray();
    }

    public static object Scan(ContentProject project)
    {
        var entries = Legacy(project).GroupBy(value => value.Id).OrderBy(group => group.Key, StringComparer.Ordinal).Select(group =>
        {
            IdLookup lookup = project.Lookup(group.Key);
            return new { id = group.Key, status = lookup.exists ? lookup.viaAlias ? "alias" : "registered" : "unregistered", lookup.canonicalId, lookup.type,
                occurrences = group.Select(value => value.Reference).OrderBy(value => value.path, StringComparer.Ordinal).ThenBy(value => value.jsonPointer, StringComparer.Ordinal).ToArray() };
        }).ToArray();
        return new { schemaVersion = 1, entries, summary = new { registered = entries.Count(value => value.status == "registered"), alias = entries.Count(value => value.status == "alias"), unregistered = entries.Count(value => value.status == "unregistered") } };
    }

    public static void EnsureRunnable(ContentProject project, JsonNode? scenario)
    {
        var errors = new List<ContentError>();
        foreach (var occurrence in Walk(scenario, "", "scenario", "", "input", false))
        {
            if (Unavailable(occurrence.Id, new HashSet<string>(StringComparer.Ordinal)))
                errors.Add(ContentProject.Error("input", occurrence.Reference.jsonPointer, "draft_dependency", "试跑引用的物品或其依赖包含待实现能力或草稿：" + project.Lookup(occurrence.Id).canonicalId));
        }
        if (errors.Count != 0) throw new ContentValidationException(new(false, errors.ToArray(), Array.Empty<string>()));

        bool Unavailable(string id, HashSet<string> visited)
        {
            IdLookup lookup = project.Lookup(id);
            if (!lookup.exists || lookup.type != "item" || !visited.Add(lookup.canonicalId)) return false;
            EntityDocument document = project.Documents[lookup.path];
            if (ContentProject.Flag(document.Value["draft"]) || ItemValidation.Validate(document, project).Count != 0) return true;
            return Walk(document.Value, "", "item", lookup.canonicalId, document.Path, false).Any(reference => Unavailable(reference.Id, visited));
        }
    }

    private static string Escape(string value) => value.Replace("~", "~0").Replace("/", "~1");
}
