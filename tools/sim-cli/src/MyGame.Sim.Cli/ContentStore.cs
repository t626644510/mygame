using System.Text.Json;
using System.Text.RegularExpressions;
using Prototype.Combat;

namespace MyGame.Sim.Cli;

public sealed class ContentStore
{
    private static readonly Dictionary<string, string> Types = new(StringComparer.Ordinal)
    {
        ["item"] = "items", ["items"] = "items", ["skill"] = "skills", ["skills"] = "skills",
        ["character"] = "characters", ["characters"] = "characters", ["encounter"] = "encounters", ["encounters"] = "encounters",
        ["building"] = "buildings", ["buildings"] = "buildings", ["recipe"] = "recipes", ["recipes"] = "recipes",
        ["layout"] = "layouts", ["layouts"] = "layouts", ["scenario"] = "scenarios", ["scenarios"] = "scenarios",
        ["trial"] = "trials", ["trials"] = "trials", ["rule"] = "rules", ["rules"] = "rules"
    };
    public string Root { get; }

    public ContentStore(string root)
    {
        Root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        CheckLinks(Root);
    }

    public string Resolve(params string[] parts)
    {
        foreach (string part in parts)
            if (part.Length == 0 || part is "." or ".." || part.IndexOfAny(new[] { '/', '\\', ':', '\0' }) >= 0)
                throw new ArgumentException("Invalid content path segment.");
        string result = Path.GetFullPath(Path.Combine(new[] { Root }.Concat(parts).ToArray()));
        StringComparison comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        if (!result.StartsWith(Root + Path.DirectorySeparatorChar, comparison)) throw new ArgumentException("Path escapes content root.");
        string current = Root;
        CheckLinks(current);
        foreach (string part in parts) { current = Path.Combine(current, part); CheckLinks(current); }
        return result;
    }

    private static void CheckLinks(string path)
    {
        try
        {
            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new ArgumentException("Content paths must not contain symbolic links or reparse points.");
        }
        catch (FileNotFoundException) { }
        catch (DirectoryNotFoundException) { }
    }

    public static string DirectoryFor(string type) => Types.TryGetValue(type, out string? directory) ? directory : throw new ArgumentException("Unknown content type: " + type);
    public static string CanonicalType(string type) => DirectoryFor(type) switch
    {
        "items" => "item", "skills" => "skill", "characters" => "character", "encounters" => "encounter",
        "buildings" => "building", "recipes" => "recipe", "layouts" => "layout", "scenarios" => "scenario", "trials" => "trial", "rules" => "rule", _ => throw new ArgumentException("Unknown content type.")
    };
    public static string[] EntityTypes => new[] { "item", "skill", "character", "encounter", "trial", "rule", "building", "recipe", "layout", "scenario" };

    public string EntityPath(string type, string id)
    {
        if (!Regex.IsMatch(id, "^[a-z][a-z0-9_]*$", RegexOptions.CultureInvariant)) throw new ArgumentException("Invalid entity id.");
        return Resolve(DirectoryFor(type), id + ".json");
    }

    public object[] List(string type)
    {
        string directory = DirectoryFor(type);
        string path = Resolve(directory);
        if (!Directory.Exists(path)) return Array.Empty<object>();
        return Directory.GetFiles(path, "*.json").OrderBy(Path.GetFileName, StringComparer.Ordinal).Select(file =>
        {
            Resolve(directory, Path.GetFileName(file));
            return (object)new { id = Path.GetFileNameWithoutExtension(file), path = directory + "/" + Path.GetFileName(file) };
        }).ToArray();
    }

    public static ContentValidation ValidateEntity(string type, string id, JsonElement value)
    {
        DirectoryFor(type);
        var errors = new List<ContentError>();
        void Error(string code, string message) => errors.Add(new(type + "/" + id, code, message));
        if (value.ValueKind != JsonValueKind.Object) Error("json", "Entity must be an object.");
        else
        {
            if (!value.TryGetProperty("id", out var field) || field.ValueKind != JsonValueKind.String || field.GetString() != id)
                Error("id", "Entity id must equal URL id.");
            if (!value.TryGetProperty("schemaVersion", out var version) || !version.TryGetInt32Safe(out int number) || number != 1)
                Error("schemaVersion", "schemaVersion must be 1.");
            if (type is "scenario" or "scenarios")
            {
                try
                {
                    ValidationResult result = Simulation.Validate(UnityJson.Read<CombatScenario>(value.GetRawText()));
                    if (!result.ok) Error("runtime", result.error);
                }
                catch (JsonException error) { Error("json", error.Message); }
            }
        }
        return new(errors.Count == 0, errors.ToArray(), Array.Empty<string>());
    }
}
