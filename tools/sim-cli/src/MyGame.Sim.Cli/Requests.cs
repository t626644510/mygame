using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace MyGame.Sim.Cli;

public sealed class RequestRecord
{
    public int schemaVersion = 1;
    public string id = "";
    public string kind = "";
    public string owner = "";
    public string target = "";
    public string title = "";
    public string status = "open";
    public string createdAt = "";
    public string field = "";
    public string body = "";
    public string expected = "";
    public string resolvedBy = "";
}

public sealed record ContentError(string path, string code, string message, string field = "");
public sealed record ContentValidation(bool ok, ContentError[] errors, string[] warnings);

public sealed class RequestStore
{
    public static readonly string[] Kinds = { "note", "new_effect", "new_condition", "new_selector", "new_status", "new_building_function", "new_item_property", "balance", "bug" };
    public static readonly string[] Owners = { "combat", "base", "engineering", "art", "world", "planning" };
    public static readonly string[] Statuses = { "open", "triaged", "in_progress", "done", "rejected" };
    private static readonly string[] Required = { "schemaVersion", "id", "kind", "owner", "target", "title", "status", "createdAt" };
    private static readonly string[] Optional = { "field", "body", "expected", "resolvedBy" };
    private readonly ContentStore files;

    public RequestStore(ContentStore files) { this.files = files; }

    // This is the BCL implementation of docs/editor/schemas/request.schema.json, plus cross-file rules.
    public static List<ContentError> ValidateRecord(JsonElement value, string path, string? expectedId = null)
    {
        var errors = new List<ContentError>();
        void Error(string code, string message) => errors.Add(new(path, code, message));
        if (value.ValueKind != JsonValueKind.Object) { Error("schema", "Request must be an object."); return errors; }
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (JsonProperty property in value.EnumerateObject())
        {
            if (!seen.Add(property.Name)) Error("schema", "Duplicate property: " + property.Name);
            if (!Required.Contains(property.Name) && !Optional.Contains(property.Name)) Error("schema", "Unknown property: " + property.Name);
            if (property.Name != "schemaVersion" && property.Value.ValueKind != JsonValueKind.String)
                Error("schema", property.Name + " must be a string.");
        }
        foreach (string key in Required) if (!seen.Contains(key)) Error("required", "Missing field: " + key);
        if (!value.TryGetProperty("schemaVersion", out JsonElement version) || !version.TryGetInt32Safe(out int number) || number != 1)
            Error("schemaVersion", "schemaVersion must be 1.");
        string Text(string key) => value.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";
        string id = Text("id");
        if (!Regex.IsMatch(id, "^REQ-[0-9]{4}$", RegexOptions.CultureInvariant)) Error("id", "id must match REQ-NNNN.");
        if (expectedId is not null && id != expectedId) Error("filename", "Filename must equal id + .json.");
        if (!Kinds.Contains(Text("kind"))) Error("kind", "Invalid kind: " + Text("kind"));
        if (!Owners.Contains(Text("owner"))) Error("owner", "Invalid owner: " + Text("owner"));
        if (!Statuses.Contains(Text("status"))) Error("status", "Invalid status: " + Text("status"));
        if (!Regex.IsMatch(Text("target"), "^(global|(item|skill|character|encounter|trial|rule|building|recipe|layout|scenario):[a-z][a-z0-9_-]*)$", RegexOptions.CultureInvariant))
            Error("target", "target must be global or <type>:<id>.");
        if (string.IsNullOrWhiteSpace(Text("title"))) Error("title", "title must not be empty.");
        string date = Text("createdAt");
        if (!ValidDate(date))
            Error("createdAt", "createdAt must be empty (unknown) or an ISO calendar date.");
        return errors;
    }

    public static bool ValidDate(string date) => date == "" || DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);

    public ContentValidation Validate()
    {
        var errors = new List<ContentError>();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (string file in Files())
        {
            string relative = "_requests/" + Path.GetFileName(file);
            try
            {
                using JsonDocument doc = JsonDocument.Parse(File.ReadAllText(file));
                errors.AddRange(ValidateRecord(doc.RootElement, relative, Path.GetFileNameWithoutExtension(file)));
                if (doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String && !ids.Add(id.GetString()!))
                    errors.Add(new(relative, "duplicate_id", "Duplicate request id: " + id.GetString()));
            }
            catch (JsonException error) { errors.Add(new(relative, "json", error.Message)); }
        }
        return new(errors.Count == 0, errors.ToArray(), Array.Empty<string>());
    }

    public RequestRecord[] ReadAll()
    {
        ContentValidation validation = Validate();
        if (!validation.ok) throw new ContentValidationException(validation);
        return Files().Select(file => UnityJson.Read<RequestRecord>(File.ReadAllText(file))).ToArray();
    }

    private string[] Files()
    {
        string directory = files.Resolve("_requests");
        if (!Directory.Exists(directory)) return Array.Empty<string>();
        return Directory.GetFiles(directory, "*.json").OrderBy(Path.GetFileName, StringComparer.Ordinal)
            .Select(file => files.Resolve("_requests", Path.GetFileName(file))).ToArray();
    }

    public RequestRecord Create(RequestRecord draft)
    {
        if (draft.status != "open") throw new ArgumentException("New requests must be open; triage belongs to planning/User.");
        var existing = ReadAll();
        int next = existing.Select(record => int.Parse(record.id.AsSpan(4), CultureInfo.InvariantCulture)).DefaultIfEmpty(0).Max() + 1;
        Directory.CreateDirectory(files.Resolve("_requests"));
        while (next <= 9999)
        {
            draft.id = "REQ-" + next.ToString("D4", CultureInfo.InvariantCulture);
            using JsonDocument doc = JsonDocument.Parse(UnityJson.Serialize(draft));
            var errors = ValidateRecord(doc.RootElement, "_requests/" + draft.id + ".json", draft.id);
            if (errors.Count != 0) throw new ContentValidationException(new(false, errors.ToArray(), Array.Empty<string>()));
            string path = files.Resolve("_requests", draft.id + ".json");
            try
            {
                using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                byte[] bytes = UnityJson.Utf8.GetBytes(UnityJson.Serialize(draft));
                stream.Write(bytes);
                return draft;
            }
            catch (IOException) when (File.Exists(path)) { next++; }
        }
        throw new ArgumentException("Request id space REQ-0001..REQ-9999 is exhausted.");
    }

    public string Markdown() => FormatMarkdown(ReadAll());

    public static string FormatMarkdown(IEnumerable<RequestRecord> records)
    {
        var text = new StringBuilder("# 需求单\n\n由 sim-cli 生成，勿手改。分拣权属于总策划或 User。\n");
        foreach (var owner in records.GroupBy(record => record.owner).OrderBy(group => group.Key, StringComparer.Ordinal))
        {
            text.Append("\n## ").Append(owner.Key).Append("\n");
            var ordered = owner.OrderBy(record => Array.IndexOf(Statuses, record.status)).ThenBy(record => record.id, StringComparer.Ordinal).ToArray();
            foreach (var record in ordered.Where(record => record.status is not "done" and not "rejected")) Append(record);
            if (ordered.Any(record => record.status is "done" or "rejected"))
            {
                text.Append("\n<details>\n<summary>已完成或拒绝</summary>\n");
                foreach (var record in ordered.Where(record => record.status is "done" or "rejected")) Append(record);
                text.Append("\n</details>\n");
            }
        }
        return text.ToString();

        void Append(RequestRecord record)
        {
            text.Append("\n- ").Append(record.id).Append(" — ").Append(record.title.Replace('\n', ' ').Replace('\r', ' '))
                .Append(" | `").Append(record.target).Append("` | `").Append(record.kind).Append("` | `").Append(record.status).Append("`\n");
            if (record.body != "") text.Append("\n    ").Append(UnityJson.Lf(record.body).Replace("\n", "\n    ")).Append("\n");
        }
    }
}

public sealed class ContentValidationException(ContentValidation result) : Exception("Content validation failed.")
{
    public ContentValidation Result { get; } = result;
}

internal static class JsonElementExtensions
{
    public static bool TryGetInt32Safe(this JsonElement element, out int value)
    {
        value = 0;
        return element.ValueKind == JsonValueKind.Number && element.TryGetInt32(out value);
    }
}
