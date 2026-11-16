using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using Prototype.Combat;

namespace MyGame.Sim.Cli;

public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding = UnityJson.Utf8;
        try
        {
            if (args.Length == 0 || args[0] is "help" or "--help" or "-h")
            {
                Console.Write("sim-cli: catalog | validate | refs | legacy-scan | export | import-scenario | import-expedition | assemble | run-trial | export-scenario | run-combat | run-expedition | compare | requests | selftest round4 | serve\nSee tools/sim-cli/README.md for arguments.\n");
                return args.Length == 0 ? 2 : 0;
            }
            var options = new Options(args.Skip(1).ToArray());
            string repository = Repository();
            string content = options.Get("content", Path.Combine(repository, "content"));
            object result;
            int exitCode = 0;
            switch (args[0])
            {
                case "import-scenario":
                case "import-expedition":
                    options.Check(1, "content", "prefix", "out");
                    byte[] sourceBytes = File.ReadAllBytes(options.Positionals[0]);
                    result = CombatImport.Import(ContentProject.Load(new ContentStore(content), repository), File.ReadAllText(options.Positionals[0]), Path.GetFileName(options.Positionals[0]), args[0] == "import-expedition", options.Has("prefix") ? options.Get("prefix") : null, CombatImport.Hash(sourceBytes));
                    break;
                case "assemble":
                    options.Check(1, "content", "out");
                    result = CombatAssembly.Build(ContentProject.Load(new ContentStore(content), repository), new JsonObject { ["trialId"] = options.Positionals[0] }).config;
                    break;
                case "run-trial":
                    options.Check(1, "content", "out", "log");
                    result = CombatRuns.Run(ContentProject.Load(new ContentStore(content), repository), new JsonObject { ["trialId"] = options.Positionals[0] });
                    if (options.Has("log"))
                    {
                        JsonObject runEnvelope = (JsonObject)JsonNode.Parse(UnityJson.Serialize(result))!;
                        string logFile = Path.GetFullPath(options.Get("log")); Directory.CreateDirectory(Path.GetDirectoryName(logFile)!);
                        File.WriteAllBytes(logFile, UnityJson.Utf8.GetBytes(CombatContent.Text(runEnvelope["logText"])));
                    }
                    break;
                case "export-scenario":
                    options.Check(1, "content", "out");
                    result = CombatRuns.ExportScenario(ContentProject.Load(new ContentStore(content), repository), options.Positionals[0], options.Require("out"));
                    Console.Write(UnityJson.Serialize(result)); return 0;
                case "catalog":
                    options.Check(0, "out"); result = Simulation.Catalog(); break;
                case "validate":
                    if (options.Has("content"))
                    {
                        options.Check(0, "content", "out");
                        ContentValidation validation = ContentProject.Load(new ContentStore(content), repository).Validate();
                        result = validation; exitCode = validation.ok ? 0 : 1;
                        foreach (ContentError error in validation.errors) Console.Error.WriteLine(error.path + ": " + error.message);
                    }
                    else
                    {
                        options.Check(1, "out");
                        ValidationResult validation = Simulation.Validate(Read<CombatScenario>(options.Positionals[0]));
                        result = validation; exitCode = validation.ok ? 0 : 1;
                        if (!validation.ok) Console.Error.WriteLine(validation.error);
                    }
                    break;
                case "run-combat":
                    options.Check(1, "max-steps", "max-wait", "log", "out");
                    ReferenceIndex.EnsureRunnable(ContentProject.Load(new ContentStore(content), repository), JsonNode.Parse(File.ReadAllText(options.Positionals[0])));
                    var session = new CombatSession(Read<CombatScenario>(options.Positionals[0]));
                    result = session.RunToCompletion(options.Integer("max-steps", 10000), options.Number("max-wait", 100000));
                    if (options.Has("log")) UnityJson.WriteFile(options.Get("log"), session.ExportLogText());
                    break;
                case "run-expedition":
                    options.Check(1, "out");
                    ReferenceIndex.EnsureRunnable(ContentProject.Load(new ContentStore(content), repository), JsonNode.Parse(File.ReadAllText(options.Positionals[0])));
                    result = Simulation.Expedition(Read<CombatExpeditionConfig>(options.Positionals[0])); break;
                case "compare":
                    options.Check(2, "out");
                    foreach (string file in options.Positionals) ReferenceIndex.EnsureRunnable(ContentProject.Load(new ContentStore(content), repository), JsonNode.Parse(File.ReadAllText(file)));
                    result = Simulation.Compare(Read<CombatScenario>(options.Positionals[0]), Read<CombatScenario>(options.Positionals[1])); break;
                case "refs":
                    options.Check(1, "content", "out"); result = ReferenceIndex.Refs(ContentProject.Load(new ContentStore(content), repository), options.Positionals[0]); break;
                case "legacy-scan":
                    options.Check(0, "content", "out"); result = ReferenceIndex.Scan(ContentProject.Load(new ContentStore(content), repository)); break;
                case "export":
                    options.Check(0, "content", "out");
                    Console.Write(UnityJson.Serialize(ContentExport.Export(ContentProject.Load(new ContentStore(content), repository), options.Require("out")))); return 0;
                case "requests":
                    var requests = new RequestStore(new ContentStore(content));
                    if (options.Positionals.Count == 1 && options.Positionals[0] == "new")
                    {
                        options.Check(1, "content", "kind", "owner", "target", "title", "body", "field", "expected", "created-at");
                        if (!RequestStore.ValidDate(options.Get("created-at", ""))) throw new UsageException("--created-at must be a valid yyyy-MM-dd calendar date.");
                        RequestRecord created = ContentEditing.CreateRequest(ContentProject.Load(new ContentStore(content), repository), new RequestRecord
                        {
                            kind = options.Require("kind"), owner = options.Require("owner"), target = options.Require("target"), title = options.Require("title"),
                            body = options.Get("body", ""), field = options.Get("field", ""), expected = options.Get("expected", ""), createdAt = options.Get("created-at", "")
                        });
                        Console.Write(created.id + "\n"); return 0;
                    }
                    options.Check(0, "content", "out");
                    UnityJson.WriteFile(options.Get("out", Path.Combine(content, "REQUESTS.md")), requests.Markdown()); return 0;
                case "selftest":
                    options.Check(1, "out");
                    if (options.Positionals[0] != "round4") throw new UsageException("Only selftest round4 is supported.");
                    Simulation.Selftest(repository, options.Require("out"));
                    Console.Write(UnityJson.Serialize(new { ok = true, reportCount = 10 })); return 0;
                case "serve":
                    options.Check(0, "content", "port", "export-out");
                    int port = options.Integer("port", 5178);
                    if (port is < 1 or > 65535) throw new UsageException("Port must be 1..65535.");
                    using (var cancel = new CancellationTokenSource())
                    {
                        ConsoleCancelEventHandler handler = (_, e) => { e.Cancel = true; cancel.Cancel(); };
                        Console.CancelKeyPress += handler;
                        try { await new LocalServer(new ContentStore(content), repository, options.Has("export-out") ? options.Get("export-out") : null).Run(port, cancel.Token); }
                        finally { Console.CancelKeyPress -= handler; }
                    }
                    return 0;
                default: throw new UsageException("Unknown command: " + args[0]);
            }
            string json = UnityJson.Serialize(result);
            if (options.Has("out")) UnityJson.WriteFile(options.Get("out"), json); else Console.Write(json);
            return exitCode;
        }
        catch (ContentValidationException error) { Console.Error.WriteLine(error.Message); Console.Write(UnityJson.Serialize(error.Result)); return 1; }
        catch (Exception error) when (error is ArgumentException or JsonException or NotImplementedException)
        { Console.Error.WriteLine(error.Message); Console.Write(UnityJson.Serialize(new { ok = false, error = error.Message })); return 1; }
        catch (Exception error) when (error is UsageException or IOException or UnauthorizedAccessException or HttpListenerException)
        { Console.Error.WriteLine(error.Message); return 2; }
    }

    private static T Read<T>(string path) where T : class => UnityJson.Read<T>(File.ReadAllText(path));

    public static string Repository()
    {
        foreach (string start in new[] { Environment.CurrentDirectory, AppContext.BaseDirectory })
            for (DirectoryInfo? directory = new(start); directory is not null; directory = directory.Parent)
                if (Directory.Exists(Path.Combine(directory.FullName, "Game", "Assets")) && Directory.Exists(Path.Combine(directory.FullName, "docs", "editor"))) return directory.FullName;
        throw new IOException("Run inside the mygame checkout (Game/Assets and docs/editor required).");
    }
}

internal sealed class UsageException(string message) : Exception(message);

internal sealed class Options
{
    private readonly Dictionary<string, string> named = new(StringComparer.Ordinal);
    public List<string> Positionals { get; } = new();
    public Options(string[] args)
    {
        for (int i = 0; i < args.Length; i++)
        {
            string arg = args[i];
            if (!arg.StartsWith("--", StringComparison.Ordinal)) { Positionals.Add(arg); continue; }
            if (i + 1 == args.Length || args[i + 1].StartsWith("--", StringComparison.Ordinal)) throw new UsageException("Missing value for " + arg);
            if (!named.TryAdd(arg[2..], args[++i])) throw new UsageException("Duplicate option: " + arg);
        }
    }
    public bool Has(string key) => named.ContainsKey(key);
    public string Get(string key, string fallback = "") => named.TryGetValue(key, out string? value) ? value : fallback;
    public string Require(string key) => Has(key) ? Get(key) : throw new UsageException("Missing --" + key);
    public int Integer(string key, int fallback) => !Has(key) ? fallback : int.TryParse(Get(key), NumberStyles.Integer, CultureInfo.InvariantCulture, out int number) ? number : throw new UsageException("Invalid integer --" + key);
    public double Number(string key, double fallback) => !Has(key) ? fallback : double.TryParse(Get(key), NumberStyles.Float, CultureInfo.InvariantCulture, out double number) && double.IsFinite(number) ? number : throw new UsageException("Invalid number --" + key);
    public void Check(int positionalCount, params string[] allowed)
    {
        if (Positionals.Count != positionalCount) throw new UsageException("Expected " + positionalCount + " positional argument(s).");
        foreach (string key in named.Keys) if (!allowed.Contains(key)) throw new UsageException("Unknown option: --" + key);
    }
}
