using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace MyGame.Sim.Cli;

public sealed class ContentConflict(string code, string message, object? current, string etag, ItemReference[]? refs = null) : Exception(message)
{
    public object Payload => new { ok = false, code, error = Message, current, etag = ETag, refs };
    public string ETag { get; } = etag;
}

public static class ContentEditing
{
    public static string ETag(string file) => File.Exists(file) ? "\"" + Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file))).ToLowerInvariant() + "\"" : "";

    public static JsonObject? Current(string file) => File.Exists(file) ? JsonNode.Parse(File.ReadAllText(file)) as JsonObject : null;

    public static void Preconditions(string file, string ifMatch, string ifNoneMatch)
    {
        string etag = ETag(file);
        JsonObject? current = Current(file);
        if (ifMatch != "" && ifNoneMatch != "") throw new ArgumentException("不能同时发送If-Match和If-None-Match。");
        if (etag == "")
        {
            if (ifMatch != "") throw new ContentConflict("etag_conflict", "磁盘上的实体已不存在。", null, "");
            if (ifNoneMatch != "*") throw new ContentConflict("precondition_required", "新建必须提供If-None-Match: *。", null, "");
        }
        else
        {
            if (ifNoneMatch != "") throw new ContentConflict("already_exists", "磁盘上的实体已存在，请重新读取当前版本。", current, etag);
            if (ifMatch == "") throw new ContentConflict("precondition_required", "更新必须提供当前实体的ETag。", current, etag);
            if (ifMatch != etag) throw new ContentConflict("etag_conflict", "磁盘上的实体已改变，请比较两个版本。", current, etag);
        }
    }

    public static object Save(ContentProject project, string type, string id, JsonObject body, string ifMatch, string ifNoneMatch, out string etag, out bool created)
    {
        bool compound = body["entity"] is JsonObject;
        JsonObject entity = compound ? (JsonObject)body["entity"]! : body;
        string relative = ContentStore.DirectoryFor(type) + "/" + id + ".json";
        var identity = new List<ContentError>();
        if (!System.Text.RegularExpressions.Regex.IsMatch(id, "^[a-z][a-z0-9_]*$")) identity.Add(ContentProject.Error(relative, "/id", "id_format", "ID格式不合规。"));
        if (ContentProject.Text(entity["id"]) != id) identity.Add(ContentProject.Error(relative, "/id", "id_immutable", "路径ID与实体ID必须一致，已有ID不能修改。"));
        if (identity.Count != 0) throw new ContentValidationException(new(false, identity.ToArray(), Array.Empty<string>()));
        string file = project.Store.EntityPath(type, id);
        created = !File.Exists(file);
        Preconditions(file, ifMatch, ifNoneMatch);
        var writes = new Dictionary<string, string?>(StringComparer.Ordinal) { [relative] = UnityJson.Serialize(entity) };
        var createdRequests = new List<JsonObject>();
        ContentProject prospective = project.With(relative, ContentStore.CanonicalType(type), entity);
        if (compound && body["requests"] is not JsonArray) throw new ArgumentException("Compound保存的requests必须是数组。");
        if (compound)
        {
            int number = project.NextRequestNumber();
            foreach (JsonNode? raw in (JsonArray)body["requests"]!)
            {
                if (raw is not JsonObject draft) throw new ArgumentException("需求草稿必须是对象。");
                JsonObject request = ContentProject.CompleteRequest(draft, id, number++, ContentStore.CanonicalType(type));
                string path = "_requests/" + ContentProject.Text(request["id"]) + ".json";
                prospective = prospective.With(path, "request", request);
                writes[path] = UnityJson.Serialize(request);
                createdRequests.Add(request);
            }
        }
        ContentValidation validation = prospective.Validate();
        if (!validation.ok) throw new ContentValidationException(validation);
        if (CombatContent.Types.Contains(ContentStore.CanonicalType(type)) && !BaseContent.IsFlowRule(type, id))
            CombatImport.TrackEdits(project, ContentStore.CanonicalType(type), id, entity, compound ? body["editIntent"] : null, writes);
        if (createdRequests.Count != 0) writes["REQUESTS.md"] = RequestStore.FormatMarkdown(prospective.Requests());
        // Recheck after validation so an ordinary external edit while validation ran becomes a conflict.
        Preconditions(file, ifMatch, ifNoneMatch);
        Apply(project.Store, writes);
        etag = ETag(file);
        return compound ? new { entity, createdRequests = createdRequests.ToArray() } : entity;
    }

    public static RequestRecord CreateRequest(ContentProject project, RequestRecord request)
    {
        if (request.status != "open") throw new ArgumentException("新需求只能为open，分拣权属于策划或User。");
        if (!RequestStore.ValidDate(request.createdAt)) throw new ArgumentException("createdAt必须为空或真实yyyy-MM-dd日期。");
        int separator = request.target.IndexOf(':');
        if (separator > 0 && ContentStore.EntityTypes.Contains(request.target[..separator]))
        {
            IdLookup lookup = project.Lookup(request.target[(separator + 1)..]);
            if (lookup.exists) request.target = lookup.type + ":" + lookup.canonicalId;
        }
        request.id = "REQ-" + project.NextRequestNumber().ToString("D4", System.Globalization.CultureInfo.InvariantCulture);
        JsonObject raw = (JsonObject)JsonNode.Parse(UnityJson.Serialize(request))!;
        string path = "_requests/" + request.id + ".json";
        ContentProject prospective = project.With(path, "request", raw);
        ContentValidation validation = prospective.Validate();
        if (!validation.ok) throw new ContentValidationException(validation);
        Apply(project.Store, new() { [path] = UnityJson.Serialize(request), ["REQUESTS.md"] = RequestStore.FormatMarkdown(prospective.Requests()) });
        return request;
    }

    public static void Delete(ContentProject project, string type, string id, string ifMatch)
    {
        string path = project.Store.EntityPath(type, id);
        if (!File.Exists(path)) throw new FileNotFoundException("Entity not found.");
        ItemReference[] refs = ReferenceIndex.Refs(project, id);
        if (refs.Length != 0) throw new ContentConflict("referenced", "物品被引用，不能删除。", Current(path), ETag(path), refs);
        if (ifMatch != "" && ifMatch != ETag(path)) throw new ContentConflict("etag_conflict", "磁盘上的实体已改变，不能删除旧版本。", Current(path), ETag(path));
        Apply(project.Store, new() { [ContentStore.DirectoryFor(type) + "/" + id + ".json"] = null });
    }

    public static void Apply(ContentStore store, Dictionary<string, string?> writes)
    {
        var before = new Dictionary<string, byte[]?>(StringComparer.Ordinal);
        var applied = new List<string>();
        foreach (string relative in writes.Keys)
        {
            string file = store.Resolve(relative.Split('/'));
            before[relative] = File.Exists(file) ? File.ReadAllBytes(file) : null;
        }
        try
        {
            foreach (var write in writes)
            {
                string file = store.Resolve(write.Key.Split('/'));
                applied.Add(write.Key);
                if (write.Value is null) { if (File.Exists(file)) File.Delete(file); }
                else Atomic(file, UnityJson.Utf8.GetBytes(UnityJson.Lf(write.Value)));
            }
        }
        catch
        {
            foreach (string relative in applied.AsEnumerable().Reverse())
            {
                string file = store.Resolve(relative.Split('/'));
                if (before[relative] is byte[] original) Atomic(file, original);
                else if (File.Exists(file)) File.Delete(file);
            }
            throw;
        }
    }

    private static void Atomic(string file, byte[] bytes)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        string temp = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try { File.WriteAllBytes(temp, bytes); File.Move(temp, file, true); }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
}
