using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace MyGame.Sim.Cli;

public sealed record IdLookup(bool exists, string type, string canonicalId, string path, bool viaAlias);
public sealed record EntityDocument(string Path, string Type, JsonObject Value);

public sealed class ContentProject
{
    public ContentStore Store { get; }
    public string Repository { get; }
    public SortedDictionary<string, EntityDocument> Documents { get; } = new(StringComparer.Ordinal);
    public List<ContentError> LoadErrors { get; } = new();
    public ContentProject(ContentStore store, string repository) { Store = store; Repository = repository; }

    public static ContentProject Load(ContentStore store, string repository)
    {
        var project = new ContentProject(store, repository);
        foreach (string type in ContentStore.EntityTypes.Append("request"))
        {
            string folder = type == "request" ? "_requests" : ContentStore.DirectoryFor(type);
            string directory = store.Resolve(folder);
            if (!Directory.Exists(directory)) continue;
            foreach (string path in Directory.GetFiles(directory, "*.json").OrderBy(Path.GetFileName, StringComparer.Ordinal))
            {
                string relative = folder + "/" + Path.GetFileName(path);
                try
                {
                    store.Resolve(folder, Path.GetFileName(path));
                    if (JsonNode.Parse(File.ReadAllText(path)) is not JsonObject value)
                        project.LoadErrors.Add(Error(relative, "", "object", "实体必须是JSON对象。"));
                    else project.Documents[relative] = new(relative, type, value);
                }
                catch (JsonException error) { project.LoadErrors.Add(Error(relative, "", "json", error.Message)); }
            }
        }
        return project;
    }

    public ContentProject With(string path, string type, JsonObject value)
    {
        var copy = new ContentProject(Store, Repository);
        foreach (var pair in Documents) copy.Documents[pair.Key] = pair.Value;
        copy.LoadErrors.AddRange(LoadErrors.Where(error => error.path.Split('#')[0] != path));
        copy.Documents[path] = new(path, type, value);
        return copy;
    }

    public IdLookup Lookup(string id)
    {
        foreach (EntityDocument doc in Documents.Values.Where(doc => doc.Type != "request"))
        {
            string canonical = Text(doc.Value["id"]);
            if (canonical == id && id != "") return new(true, doc.Type, canonical, doc.Path, false);
            if (doc.Value["aliases"] is JsonArray aliases && aliases.Any(alias => Text(alias) == id) && id != "")
                return new(true, doc.Type, canonical, doc.Path, true);
        }
        return new(false, "", "", "", false);
    }

    public IEnumerable<RequestRecord> Requests() => Documents.Values.Where(doc => doc.Type == "request")
        .Select(doc => UnityJson.Read<RequestRecord>(doc.Value.ToJsonString()));

    public bool HasImplementationRequest(string canonicalId, string type = "item") => Documents.Values.Where(doc => doc.Type == "request").Any(doc =>
    {
        string target = Text(doc.Value["target"]);
        return target.StartsWith(type + ":", StringComparison.Ordinal) && Lookup(target[(type.Length + 1)..]).canonicalId == canonicalId &&
            (type is not "skill" and not "character" || Text(doc.Value["owner"]) == "combat") &&
            Text(doc.Value["kind"]) is not "" and not "note";
    });

    public ContentValidation Validate()
    {
        var errors = new List<ContentError>(LoadErrors);
        var pool = new Dictionary<string, (string Path, string Field)>(StringComparer.Ordinal);
        var requests = new HashSet<string>(StringComparer.Ordinal);
        foreach (EntityDocument doc in Documents.Values)
        {
            JsonObject value = doc.Value;
            string id = Text(value["id"]);
            if (doc.Type == "request")
            {
                using JsonDocument json = JsonDocument.Parse(value.ToJsonString());
                errors.AddRange(RequestStore.ValidateRecord(json.RootElement, doc.Path, Path.GetFileNameWithoutExtension(doc.Path)));
                if (!requests.Add(id)) errors.Add(Error(doc.Path, "/id", "duplicate_id", "需求ID重复：" + id));
                string target = Text(value["target"]);
                int separator = target.IndexOf(':');
                if (separator > 0 && ContentStore.EntityTypes.Contains(target[..separator]))
                {
                    IdLookup lookup = Lookup(target[(separator + 1)..]);
                    if (!lookup.exists || lookup.type != target[..separator]) errors.Add(Error(doc.Path, "/target", "target_missing", "需求指向的实体不存在：" + target));
                }
                continue;
            }
            using (JsonDocument json = JsonDocument.Parse(value.ToJsonString()))
            {
                ContentValidation basic = ContentStore.ValidateEntity(doc.Type, id, json.RootElement);
                foreach (ContentError error in basic.errors)
                    errors.Add(Error(doc.Path, error.code is "id" or "schemaVersion" ? "/" + error.code : "", error.code, error.message));
            }
            if (!Regex.IsMatch(id, "^[a-z][a-z0-9_]*$", RegexOptions.CultureInvariant)) errors.Add(Error(doc.Path, "/id", "id_format", "ID必须以小写字母开头，只含小写字母、数字和下划线。"));
            if (Path.GetFileNameWithoutExtension(doc.Path) != id) errors.Add(Error(doc.Path, "/id", "filename", "文件名必须与ID一致。"));
            Add(id, "/id");
            if (value["aliases"] is JsonArray aliases)
                for (int index = 0; index < aliases.Count; index++)
                {
                    string alias = Text(aliases[index]);
                    if (!Regex.IsMatch(alias, "^[a-z][a-z0-9_-]*$", RegexOptions.CultureInvariant)) errors.Add(Error(doc.Path, "/aliases/" + index, "alias_format", "别名必须是安全的旧ID写法。"));
                    Add(alias, "/aliases/" + index);
                }
            else if (value["aliases"] is not null) errors.Add(Error(doc.Path, "/aliases", "type", "aliases必须是字符串数组。"));
            if (doc.Type == "item") errors.AddRange(ItemValidation.Validate(doc, this));
            if (CombatContent.Types.Contains(doc.Type)) errors.AddRange(CombatContent.Validate(doc, this));

            void Add(string name, string field)
            {
                if (name == "") return;
                if (pool.TryGetValue(name, out var previous))
                    errors.Add(Error(doc.Path, field, "id_conflict", "ID或别名已被占用：" + name + "（" + previous.Path + previous.Field + "）"));
                else pool[name] = (doc.Path, field);
            }
        }
        return new(errors.Count == 0, errors.ToArray(), Array.Empty<string>());
    }

    public ContentValidation ValidateItem(JsonObject entity, string mode, IEnumerable<JsonObject>? requestDrafts = null)
    {
        string id = Text(entity["id"]);
        var extra = new List<ContentError>();
        string path = "items/" + id + ".json";
        if (mode is not "create" and not "update") extra.Add(Error(path, "", "mode", "校验模式必须是create或update。"));
        if (mode == "create" && Lookup(id).exists) extra.Add(Error(path, "/id", "id_conflict", "ID或别名已被占用：" + id));
        ContentProject prospective = With(path, "item", entity);
        int next = NextRequestNumber();
        if (requestDrafts is not null)
            foreach (JsonObject draft in requestDrafts)
            {
                JsonObject request = CompleteRequest(draft, id, next++);
                string requestPath = "_requests/" + Text(request["id"]) + ".json";
                prospective = prospective.With(requestPath, "request", request);
            }
        ContentValidation full = prospective.Validate();
        return new(extra.Count == 0 && full.ok, extra.Concat(full.errors).ToArray(), full.warnings);
    }

    public int NextRequestNumber() => Documents.Values.Where(doc => doc.Type == "request").Select(doc => Text(doc.Value["id"]))
        .Where(id => Regex.IsMatch(id, "^REQ-[0-9]{4}$", RegexOptions.CultureInvariant)).Select(id => int.Parse(id.AsSpan(4), System.Globalization.CultureInfo.InvariantCulture)).DefaultIfEmpty(0).Max() + 1;

    public static JsonObject CompleteRequest(JsonObject draft, string itemId, int number, string type = "item")
    {
        JsonObject result = (JsonObject)draft.DeepClone();
        string target = type + ":" + itemId;
        if (result["target"] is not null && Text(result["target"]) != target) throw new ArgumentException("Compound请求target必须与保存实体一致。");
        if (result["status"] is not null && Text(result["status"]) != "open") throw new ArgumentException("新需求只能是open，分拣权属于策划或User。");
        result["schemaVersion"] = 1; result["id"] = "REQ-" + number.ToString("D4", System.Globalization.CultureInfo.InvariantCulture);
        result["target"] = target; result["status"] = "open";
        if (result["createdAt"] is null) result["createdAt"] = "";
        return result;
    }

    public static string Text(JsonNode? value) => value is JsonValue json && json.TryGetValue<string>(out string? text) ? text ?? "" : "";
    public static bool Flag(JsonNode? value) => value is JsonValue json && json.TryGetValue<bool>(out bool flag) && flag;
    public static int? Integer(JsonNode? value) => value is JsonValue json && json.TryGetValue<int>(out int number) ? number : null;
    public static ContentError Error(string path, string field, string code, string message) => new(path + (field == "" ? "" : "#" + field), code, message, field);
}
