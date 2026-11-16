using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using MyGame.Sim.Cli;
using Prototype.Combat;

internal static class Verification
{
    private static string root = "";
    private static string output = "";
    private static string cli = "";
    private static string host = "";
    private static int callIndex;
    private static readonly List<object> checks = new();
    private static readonly List<object> commands = new();

    public static async Task<int> Main(string[] args)
    {
        root = MyGame.Sim.Cli.Program.Repository();
        output = Path.GetFullPath(args.Length > 0 ? args[0] : Path.Combine(root, "outputs", "p0_20261116"));
        cli = Path.Combine(root, "tools", "sim-cli", "src", "MyGame.Sim.Cli", "bin", "Release", "net8.0", "sim-cli.dll");
        host = Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? Path.GetFullPath(Path.Combine(RuntimeEnvironment.GetRuntimeDirectory(), "..", "..", "..", OperatingSystem.IsWindows() ? "dotnet.exe" : "dotnet"));
        Directory.CreateDirectory(output);
        try
        {
            if (args.Contains("--errors-only", StringComparer.Ordinal))
            {
                await ErrorEvidence();
            }
            else if (args.Contains("--http-only", StringComparer.Ordinal))
            {
                await Compare();
                await Http();
            }
            else
            {
                await Catalog();
                await RunsAndRoundTrip();
                await Validate();
                await Compare();
                await Requests();
                await Http();
                await Reports();
            }
            Save("verification.json", new { ok = true, processId = Environment.ProcessId, processExecutable = Environment.ProcessPath, user = Environment.UserName,
                arguments = Environment.GetCommandLineArgs(), platform = RuntimeInformation.OSDescription, runtime = RuntimeInformation.FrameworkDescription, gitCommit = LocalServer.GitCommit(root), checks, commands });
            Console.WriteLine("PASS " + checks.Count + " checks; evidence: " + output);
            return 0;
        }
        catch (Exception error)
        {
            Save("verification.json", new { ok = false, error = error.ToString(), platform = RuntimeInformation.OSDescription, gitCommit = LocalServer.GitCommit(root), checks, commands });
            Console.Error.WriteLine(error);
            return 1;
        }
    }

    private static string Config(string file) => Path.Combine(root, "Game", "Assets", "StreamingAssets", "Prototype", "Combat", file);
    private static void Save(string file, object value) => UnityJson.WriteFile(Path.Combine(output, file), UnityJson.Serialize(value));
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static void Require(bool condition, string id, object? evidence = null)
    {
        checks.Add(new { id, passed = condition, evidence });
        if (!condition) throw new InvalidOperationException("FAIL: " + id);
    }

    private static async Task<(int Exit, string Text, string Error)> Call(params string[] args)
    {
        var info = new ProcessStartInfo(host) { WorkingDirectory = root, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = UnityJson.Utf8, StandardErrorEncoding = UnityJson.Utf8, UseShellExecute = false, CreateNoWindow = true };
        info.ArgumentList.Add(cli);
        foreach (string arg in args) info.ArgumentList.Add(arg);
        using Process process = Process.Start(info)!;
        using var stdout = new MemoryStream();
        using var stderr = new MemoryStream();
        Task stdoutCopy = process.StandardOutput.BaseStream.CopyToAsync(stdout);
        Task stderrCopy = process.StandardError.BaseStream.CopyToAsync(stderr);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        try { await process.WaitForExitAsync(timeout.Token); }
        catch { process.Kill(true); throw; }
        await Task.WhenAll(stdoutCopy, stderrCopy);
        byte[] stdoutBytes = stdout.ToArray(), stderrBytes = stderr.ToArray();
        string text = UnityJson.Utf8.GetString(stdoutBytes), error = UnityJson.Utf8.GetString(stderrBytes);
        string name = (++callIndex).ToString("D3") + "-" + args[0];
        Directory.CreateDirectory(Path.Combine(output, "commands"));
        File.WriteAllBytes(Path.Combine(output, "commands", name + ".stdout"), stdoutBytes);
        File.WriteAllBytes(Path.Combine(output, "commands", name + ".stderr"), stderrBytes);
        commands.Add(new { name, processId = process.Id, executable = host, arguments = new[] { cli }.Concat(args), exit = process.ExitCode,
            capture = "concurrent BaseStream.CopyToAsync; unchanged bytes saved and hashed", stdoutSha256 = Hash(stdoutBytes), stderrSha256 = Hash(stderrBytes) });
        return (process.ExitCode, text, error);
    }

    private static async Task ErrorEvidence()
    {
        CombatScenario scenario = UnityJson.Read<CombatScenario>(File.ReadAllText(Config("round4_mage_library.json")));
        scenario.units.Single(unit => unit.id == "mage").intelligence = 10;
        scenario.units[1].id = scenario.units[0].id;
        string duplicate = Path.Combine(output, "fixtures", "duplicate-unit.json");
        UnityJson.WriteFile(duplicate, UnityJson.Serialize(scenario));
        string original = "";
        try { _ = new CombatSession(scenario); } catch (ArgumentException error) { original = error.Message; }
        var duplicateResult = await Call("validate", duplicate);
        using JsonDocument duplicateJson = JsonDocument.Parse(duplicateResult.Text);
        Require(duplicateResult.Exit == 1 && original != "" && duplicateJson.RootElement.GetProperty("error").GetString() == original && duplicateResult.Error.Contains(original, StringComparison.Ordinal), "replacement for run4 024-validate duplicate ID");
        Require((await Call("run-combat", Path.Combine(output, "missing.json"))).Exit == 2, "replacement for run4 025-run-combat missing file");
        Require((await Call("run-combat", Config("default.json"), "--max-steps", "bad")).Exit == 2, "replacement for run4 026-run-combat invalid number");
        string newRequests = CopyRequests("request-new");
        var date = await Call("requests", "new", "--content", newRequests, "--kind", "note", "--owner", "planning", "--target", "global", "--title", "bad date", "--created-at", "2026-02-30");
        Require(date.Exit == 2, "replacement for run4 033-requests invalid calendar date");
        string badContent = CopyRequests("request-errors");
        string badFile = Path.Combine(badContent, "_requests", "REQ-0001.json");
        JsonNode bad = JsonNode.Parse(File.ReadAllText(badFile))!;
        bad["kind"] = "invalid_kind"; bad["target"] = "invalid/target";
        UnityJson.WriteFile(badFile, UnityJson.Serialize(bad));
        File.Copy(badFile, Path.Combine(badContent, "_requests", "REQ-0999.json"), true);
        var content = await Call("validate", "--content", badContent);
        using JsonDocument contentJson = JsonDocument.Parse(content.Text);
        string[] codes = contentJson.RootElement.GetProperty("errors").EnumerateArray().Select(value => value.GetProperty("code").GetString()!).ToArray();
        Require(content.Exit == 1 && new[] { "kind", "duplicate_id", "target" }.All(codes.Contains), "replacement for run4 034-validate all three content errors", codes);
    }

    private static async Task Catalog()
    {
        var result = await Call("catalog");
        Require(result.Exit == 0, "A3 catalog CLI exit");
        using JsonDocument doc = JsonDocument.Parse(result.Text);
        var actual = doc.RootElement;
        var expected = new (string Key, object Value)[]
        {
            ("conditions", CombatTacticsCatalog.GetConditions()), ("selectors", CombatTacticsCatalog.GetSelectors()),
            ("scopes", CombatTacticsCatalog.GetScopes()), ("operations", CombatTacticsCatalog.GetOperations()),
            ("groupings", CombatTacticsCatalog.GetGroupings()), ("subjects", CombatTacticsCatalog.GetSubjects()),
            ("effectKinds", CombatTacticsCatalog.GetEffectKinds()), ("statusKinds", CombatTacticsCatalog.GetStatusKinds()),
            ("targetModes", CombatTacticsCatalog.GetTargetModes()), ("damageTypes", CombatTacticsCatalog.GetDamageTypes())
        };
        foreach (var entry in expected)
            Require(UnityJson.Serialize(actual.GetProperty(entry.Key)) == UnityJson.Serialize(entry.Value), "A3 direct catalog " + entry.Key);
        Require(actual.GetProperty("conditions").GetArrayLength() == 37 && actual.GetProperty("selectors").GetArrayLength() == 24 &&
                actual.GetProperty("effectKinds").GetArrayLength() == 7 && actual.GetProperty("statusKinds").GetArrayLength() == 9 &&
                actual.GetProperty("scopes").GetArrayLength() == 3 && actual.GetProperty("targetModes").GetArrayLength() == 4, "A3 counts 37/24/7/9/3/4");
    }

    private static async Task RunsAndRoundTrip()
    {
        var expected = new (string File, string Outcome, double Wait, int Actions)[]
        {
            ("default.json", "Victory", 200, 13), ("round2_ambush.json", "Victory", 40, 3),
            ("round2_capacity.json", "Defeat", 185, 5), ("round2_equipment.json", "Victory", 120, 5),
            ("round2_one_idle.json", "Victory", 300, 11), ("round2_pressure.json", "Victory", 190, 11),
            ("round2_stalemate.json", "Stalemate", 35, 0), ("round2_time_tie.json", "Victory", 40, 3),
            ("round3_focus_mark.json", "Victory", 90, 8), ("round3_mp_reserve.json", "Victory", 240, 17),
            ("round3_tactics.json", "Victory", 135, 10), ("round4_area.json", "Victory", 80, 7),
            ("round4_cleanse.json", "Victory", 150, 9), ("round4_control.json", "Victory", 40, 4),
            ("round4_mage_library.json", "Victory", 230, 19), ("round4_meditation.json", "Victory", 160, 12),
            ("round4_meditation_risk.json", "Victory", 0, 1)
        };
        var rows = new List<object>();
        var provenance = new List<object>();
        foreach (var entry in expected)
        {
            string file = Config(entry.File);
            string log = Path.Combine(output, "logs", entry.File + ".txt");
            var result = await Call("run-combat", file, "--log", log);
            Require(result.Exit == 0, "A4 " + entry.File + " CLI exit");
            using JsonDocument doc = JsonDocument.Parse(result.Text);
            var run = doc.RootElement;
            string outcome = run.GetProperty("outcome").GetString()!;
            double wait = run.GetProperty("time").GetDouble();
            int actions = run.GetProperty("executedActionCount").GetInt32();
            rows.Add(new { file = entry.File, outcome, wait, actions });
            Require(outcome == entry.Outcome && wait == entry.Wait && actions == entry.Actions, "A4 " + entry.File, rows[^1]);
            string roundTrip = UnityJson.Serialize(UnityJson.Read<CombatScenario>(File.ReadAllText(file)));
            UnityJson.WriteFile(Path.Combine(output, "roundtrip", entry.File), roundTrip);
            provenance.Add(new { file = entry.File, type = "CombatScenario", sourceSha256 = Hash(File.ReadAllBytes(file)), roundTripSha256 = Hash(UnityJson.Utf8.GetBytes(roundTrip)) });
        }
        foreach (string name in new[] { "round2_expedition.json", "round4_expedition.json" })
        {
            string file = Config(name);
            var result = await Call("run-expedition", file);
            Require(result.Exit == 0, "A4 " + name + " CLI exit");
            using JsonDocument doc = JsonDocument.Parse(result.Text);
            var run = doc.RootElement;
            Require(run.GetProperty("stopReason").GetString() == "CompletedAllEncounters" && run.GetProperty("encounters").GetArrayLength() == 2, "A4 " + name);
            rows.Add(new { file = name, stopReason = run.GetProperty("stopReason").GetString(), encounterCount = run.GetProperty("encounters").GetArrayLength(), observedFinalWait = run.GetProperty("finalSnapshot").GetProperty("time").GetDouble() });
            string roundTrip = UnityJson.Serialize(UnityJson.Read<CombatExpeditionConfig>(File.ReadAllText(file)));
            UnityJson.WriteFile(Path.Combine(output, "roundtrip", name), roundTrip);
            provenance.Add(new { file = name, type = "CombatExpeditionConfig", sourceSha256 = Hash(File.ReadAllBytes(file)), roundTripSha256 = Hash(UnityJson.Utf8.GetBytes(roundTrip)) });
        }
        Save("run-results.json", rows);
        Save("roundtrip-provenance.json", new { generator = "UnityJson.Read<T> then UnityJson.Serialize", inputs = provenance });
        var first = await Call("run-combat", Config("round4_mage_library.json"));
        var second = await Call("run-combat", Config("round4_mage_library.json"));
        Require(first.Exit == 0 && second.Exit == 0 && first.Text == second.Text, "A11 run-combat byte equality", Hash(UnityJson.Utf8.GetBytes(first.Text)));
    }

    private static async Task Validate()
    {
        CombatScenario scenario = UnityJson.Read<CombatScenario>(File.ReadAllText(Config("round4_mage_library.json")));
        scenario.units.Single(unit => unit.id == "mage").intelligence = 10;
        string low = Path.Combine(output, "fixtures", "low-intelligence.json");
        UnityJson.WriteFile(low, UnityJson.Serialize(scenario));
        var result = await Call("validate", low);
        Require(result.Exit == 0, "A7 low intelligence is a valid scenario");
        using JsonDocument doc = JsonDocument.Parse(result.Text);
        CombatSnapshot direct = new CombatSession(scenario).GetSnapshot();
        Save("direct/low-intelligence-snapshot.json", direct);
        foreach (var unit in direct.units)
        {
            var actual = doc.RootElement.GetProperty("units").EnumerateArray().Single(value => value.GetProperty("id").GetString() == unit.id);
            Require(actual.GetProperty("instructionCapacity").GetInt32() == unit.instructionCapacity && actual.GetProperty("conditionTermCapacity").GetInt32() == unit.conditionTermCapacity, "A7 direct capacity " + unit.id);
            for (int i = 0; i < unit.instructions.Length; i++)
            {
                var instruction = actual.GetProperty("instructions")[i];
                Require(instruction.GetProperty("capacityAllowed").GetBoolean() == unit.instructions[i].capacityAllowed && instruction.GetProperty("validationReason").GetString() == unit.instructions[i].validationReason, "A7 direct instruction " + unit.id + "/" + i);
            }
        }
        scenario.units[1].id = scenario.units[0].id;
        string duplicate = Path.Combine(output, "fixtures", "duplicate-unit.json");
        UnityJson.WriteFile(duplicate, UnityJson.Serialize(scenario));
        string original = "";
        try { _ = new CombatSession(scenario); } catch (ArgumentException error) { original = error.Message; }
        var invalid = await Call("validate", duplicate);
        using JsonDocument bad = JsonDocument.Parse(invalid.Text);
        Require(original != "" && invalid.Exit == 1 && bad.RootElement.GetProperty("error").GetString() == original && invalid.Error.Contains(original, StringComparison.Ordinal), "A7 duplicate ID original ArgumentException", original);
        Require((await Call("run-combat", Path.Combine(output, "missing.json"))).Exit == 2, "usage missing file exit 2");
        Require((await Call("run-combat", Config("default.json"), "--max-steps", "bad")).Exit == 2, "usage invalid number exit 2");
    }

    private static async Task Compare()
    {
        CombatScenario scenario = UnityJson.Read<CombatScenario>(File.ReadAllText(Config("round2_ambush.json")));
        var instructions = scenario.units.Single(unit => unit.id == "mage").instructions;
        (instructions[0], instructions[1]) = (instructions[1], instructions[0]);
        string variant = Path.Combine(output, "fixtures", "priority-variant.json");
        UnityJson.WriteFile(variant, UnityJson.Serialize(scenario));
        var result = await Call("compare", Config("round2_ambush.json"), variant);
        Require(result.Exit == 0, "A8 compare CLI exit");
        using JsonDocument doc = JsonDocument.Parse(result.Text);
        var direct = CombatSampleRuns.ComparePriority(UnityJson.Read<CombatScenario>(File.ReadAllText(Config("round2_ambush.json"))));
        Save("direct/compare-priority.json", direct);
        Require(UnityJson.Serialize(doc.RootElement.GetProperty("firstDivergence")) == UnityJson.Serialize(direct.firstDivergence), "A8 same FirstDivergence as ComparePriority");
        Require(!doc.RootElement.GetProperty("onlyDeclaredSettingChanged").GetBoolean(), "A8 no single-setting verification claim");
        var repeat = await Call("compare", Config("round2_ambush.json"), variant);
        Require(repeat.Exit == 0 && repeat.Text == result.Text, "A11 compare byte equality", Hash(UnityJson.Utf8.GetBytes(result.Text)));
    }

    private static string CopyRequests(string name)
    {
        string path = Path.Combine(output, name);
        Directory.CreateDirectory(Path.Combine(path, "_requests"));
        foreach (string file in Directory.GetFiles(Path.Combine(root, "content", "_requests"), "*.json")) File.Copy(file, Path.Combine(path, "_requests", Path.GetFileName(file)), true);
        return path;
    }

    private static async Task Requests()
    {
        string content = CopyRequests("request-fixtures");
        var valid = await Call("validate", "--content", content);
        Require(valid.Exit == 0, "A9 three samples valid");
        string md1 = Path.Combine(output, "requests-first.md"), md2 = Path.Combine(output, "requests-second.md");
        Require((await Call("requests", "--content", content, "--out", md1)).Exit == 0 && (await Call("requests", "--content", content, "--out", md2)).Exit == 0, "A9 requests generated");
        byte[] first = File.ReadAllBytes(md1);
        Require(first.SequenceEqual(File.ReadAllBytes(md2)), "A11 requests byte equality", Hash(first));
        string markdown = File.ReadAllText(md1);
        Require(markdown.Contains("由 sim-cli 生成，勿手改", StringComparison.Ordinal) && markdown.IndexOf("## base", StringComparison.Ordinal) < markdown.IndexOf("## combat", StringComparison.Ordinal) && markdown.IndexOf("## combat", StringComparison.Ordinal) < markdown.IndexOf("## engineering", StringComparison.Ordinal), "A9 owner sections sorted");
        var store = new RequestStore(new ContentStore(content));
        var record = new RequestRecord { kind = "note", owner = "combat", target = "global", title = "status ordering", createdAt = "2026-11-15" };
        foreach (string status in new[] { "rejected", "done", "in_progress", "triaged", "open" })
        {
            record.status = "open";
            RequestRecord created = store.Create(record);
            created.status = status;
            UnityJson.WriteFile(Path.Combine(content, "_requests", created.id + ".json"), UnityJson.Serialize(created));
        }
        string sorted = store.Markdown();
        Require(sorted.IndexOf("REQ-0008", StringComparison.Ordinal) < sorted.IndexOf("REQ-0007", StringComparison.Ordinal) && sorted.IndexOf("REQ-0007", StringComparison.Ordinal) < sorted.IndexOf("REQ-0006", StringComparison.Ordinal) && sorted.IndexOf("REQ-0006", StringComparison.Ordinal) < sorted.IndexOf("<details>", StringComparison.Ordinal), "A9 status order and folded done/rejected");
        string fresh = CopyRequests("request-new");
        var createdCli = await Call("requests", "new", "--content", fresh, "--kind", "note", "--owner", "planning", "--target", "global", "--title", "CLI sample");
        Require(createdCli.Exit == 0 && createdCli.Text == "REQ-0004\n", "request new deterministic next ID");
        using JsonDocument createdDoc = JsonDocument.Parse(File.ReadAllText(Path.Combine(fresh, "_requests", "REQ-0004.json")));
        Require(createdDoc.RootElement.GetProperty("createdAt").GetString() == "", "createdAt exists and defaults to unfilled");
        var badDate = await Call("requests", "new", "--content", fresh, "--kind", "note", "--owner", "planning", "--target", "global", "--title", "bad date", "--created-at", "2026-02-30");
        Require(badDate.Exit == 2, "invalid calendar date CLI exit 2");
        string badContent = CopyRequests("request-errors");
        string badFile = Path.Combine(badContent, "_requests", "REQ-0001.json");
        JsonNode bad = JsonNode.Parse(File.ReadAllText(badFile))!;
        bad["kind"] = "invalid_kind"; bad["target"] = "invalid/target";
        UnityJson.WriteFile(badFile, UnityJson.Serialize(bad));
        File.Copy(badFile, Path.Combine(badContent, "_requests", "REQ-0999.json"), true);
        var errors = await Call("validate", "--content", badContent);
        using JsonDocument errorsDoc = JsonDocument.Parse(errors.Text);
        string[] codes = errorsDoc.RootElement.GetProperty("errors").EnumerateArray().Select(value => value.GetProperty("code").GetString()!).ToArray();
        Require(errors.Exit == 1 && new[] { "kind", "duplicate_id", "target" }.All(codes.Contains), "A9 all three intentional errors", codes);
    }

    private static async Task Http()
    {
        string content = CopyRequests("http-content");
        var reserve = new TcpListener(IPAddress.Loopback, 0);
        reserve.Start(); int port = ((IPEndPoint)reserve.LocalEndpoint).Port; reserve.Stop();
        using var cancel = new CancellationTokenSource();
        Task server = new LocalServer(new ContentStore(content), root).Run(port, cancel.Token);
        try
        {
            using var client = new HttpClient(new RecordingHandler()) { BaseAddress = new Uri("http://127.0.0.1:" + port), Timeout = TimeSpan.FromSeconds(10) };
            var health = await client.GetAsync("/api/health");
            Require(health.IsSuccessStatusCode, "A10 HTTP health");
            var listeners = System.Net.NetworkInformation.IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Where(endpoint => endpoint.Port == port).ToArray();
            Save("http/listeners.json", listeners.Select(endpoint => new { address = endpoint.Address.ToString(), endpoint.Port }).ToArray());
            Require(listeners.Length > 0 && listeners.All(endpoint => endpoint.Address.Equals(IPAddress.Loopback)), "A10 loopback only", listeners.Select(endpoint => endpoint.ToString()).ToArray());
            var catalog = await client.GetByteArrayAsync("/api/catalog");
            var cliCatalog = await Call("catalog");
            Require(catalog.SequenceEqual(UnityJson.Utf8.GetBytes(cliCatalog.Text)), "A10 HTTP catalog exact CLI bytes", Hash(catalog));
            string source = File.ReadAllText(Config("round2_ambush.json"));
            foreach (var entry in new[] { (Route: "run-combat", Command: "run-combat"), (Route: "validate", Command: "validate") })
            {
                var response = await client.PostAsync("/api/" + entry.Route, new StringContent(source, UnityJson.Utf8, "application/json"));
                var command = await Call(entry.Command, Config("round2_ambush.json"));
                Require(response.IsSuccessStatusCode && (await response.Content.ReadAsByteArrayAsync()).SequenceEqual(UnityJson.Utf8.GetBytes(command.Text)), "HTTP/CLI exact bytes " + entry.Route);
            }
            var expedition = await client.PostAsync("/api/run-expedition", new StringContent(File.ReadAllText(Config("round2_expedition.json")), UnityJson.Utf8, "application/json"));
            var expCli = await Call("run-expedition", Config("round2_expedition.json"));
            Require(expedition.IsSuccessStatusCode && (await expedition.Content.ReadAsByteArrayAsync()).SequenceEqual(UnityJson.Utf8.GetBytes(expCli.Text)), "HTTP/CLI exact bytes run-expedition");
            string variantFile = Path.Combine(output, "fixtures", "priority-variant.json");
            var compareBody = new { baseline = JsonNode.Parse(source), variant = JsonNode.Parse(File.ReadAllText(variantFile)) };
            var comparison = await client.PostAsync("/api/compare", new StringContent(UnityJson.Serialize(compareBody), UnityJson.Utf8, "application/json"));
            var compareCli = await Call("compare", Config("round2_ambush.json"), variantFile);
            Require(comparison.IsSuccessStatusCode && (await comparison.Content.ReadAsByteArrayAsync()).SequenceEqual(UnityJson.Utf8.GetBytes(compareCli.Text)), "HTTP/CLI exact bytes compare");
            string entity = UnityJson.Serialize(new
            {
                schemaVersion = 1, id = "mat_probe", aliases = Array.Empty<string>(), name = "HTTP probe", category = "material",
                description = "Isolated HTTP regression fixture.", icon = "", stackLimit = 99, baseValue = 0, tags = Array.Empty<string>(),
                equipment = new { slot = "", combatBonus = Array.Empty<object>(), enhancement = Array.Empty<object>() },
                consumable = new { effects = Array.Empty<object>() }, draft = false
            });
            using var create = new HttpRequestMessage(HttpMethod.Put, "/api/content/items/mat_probe")
            {
                Content = new StringContent(entity, UnityJson.Utf8, "application/json")
            };
            create.Headers.Add("If-None-Match", "*");
            var put = await client.SendAsync(create);
            byte[] got = await client.GetByteArrayAsync("/api/content/items/mat_probe");
            Require(put.IsSuccessStatusCode && got.SequenceEqual(UnityJson.Utf8.GetBytes(entity)) && File.ReadAllBytes(Path.Combine(content, "items", "mat_probe.json")).SequenceEqual(got), "A10 PUT then GET exact bytes");
            var invalid = await client.PutAsync("/api/content/items/mat_probe", new StringContent("{\"schemaVersion\":1,\"id\":\"other\"}", UnityJson.Utf8, "application/json"));
            Require((int)invalid.StatusCode == 422 && File.ReadAllBytes(Path.Combine(content, "items", "mat_probe.json")).SequenceEqual(got), "HTTP invalid PUT 422 preserves file");
            var list = await client.GetStringAsync("/api/content/items");
            Require(list.Contains("mat_probe", StringComparison.Ordinal), "HTTP content list");
            using (var message = new HttpRequestMessage(HttpMethod.Get, "/api/catalog"))
            {
                message.Headers.Add("Origin", "https://example.com");
                Require((int)(await client.SendAsync(message)).StatusCode == 403, "HTTP remote origin rejected");
            }
            foreach (string origin in new[] { "http://localhost:5173", "http://127.0.0.1:5173" })
            {
                using var message = new HttpRequestMessage(HttpMethod.Options, "/api/catalog");
                message.Headers.Add("Origin", origin);
                var allowed = await client.SendAsync(message);
                Require((int)allowed.StatusCode == 204 && allowed.Headers.GetValues("Access-Control-Allow-Origin").Single() == origin, "HTTP loopback CORS " + origin);
            }
            var draft = new { kind = "note", owner = "planning", target = "global", title = "HTTP new" };
            var created = await client.PostAsync("/api/requests", new StringContent(UnityJson.Serialize(draft), UnityJson.Utf8, "application/json"));
            Require((int)created.StatusCode == 201, "HTTP request created");
            var dateError = await client.PostAsync("/api/requests", new StringContent("{\"kind\":\"note\",\"owner\":\"planning\",\"target\":\"global\",\"title\":\"bad date\",\"createdAt\":\"2026-02-30\"}", UnityJson.Utf8, "application/json"));
            Require((int)dateError.StatusCode == 400, "HTTP invalid calendar date 400");
            Require((await client.GetStringAsync("/api/requests")).Contains("REQ-0004", StringComparison.Ordinal), "HTTP request ID allocated");
            Require((await client.DeleteAsync("/api/content/items/mat_probe")).IsSuccessStatusCode && (int)(await client.GetAsync("/api/content/items/mat_probe")).StatusCode == 404, "HTTP delete");
            foreach (string path in new[] { "/api/content/items/../outside", "/api/content/items/%2e%2e%2foutside", "/api/content/items/%2e%2e%5coutside" })
            {
                using var socket = new TcpClient();
                await socket.ConnectAsync(IPAddress.Loopback, port);
                await socket.GetStream().WriteAsync(UnityJson.Utf8.GetBytes("GET " + path + " HTTP/1.1\r\nHost: 127.0.0.1:" + port + "\r\nConnection: close\r\n\r\n"));
                using var rawResponse = new MemoryStream();
                await socket.GetStream().CopyToAsync(rawResponse);
                byte[] responseBytes = rawResponse.ToArray();
                string response = UnityJson.Utf8.GetString(responseBytes);
                File.WriteAllBytes(Path.Combine(output, "http", "raw-traversal-" + Hash(UnityJson.Utf8.GetBytes(path))[..12] + ".response"), responseBytes);
                Require(response.StartsWith("HTTP/1.1 400", StringComparison.Ordinal), "A10 raw traversal 400 " + path, response.Split('\n')[0].Trim());
            }
        }
        finally { cancel.Cancel(); await server; }
    }

    private sealed class RecordingHandler() : DelegatingHandler(new HttpClientHandler())
    {
        private int requestNumber;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            string name = (++requestNumber).ToString("D3") + "-" + request.Method.Method;
            byte[] requestBytes = request.Content is null ? Array.Empty<byte>() : await request.Content.ReadAsByteArrayAsync(cancellationToken);
            HttpResponseMessage response = await base.SendAsync(request, cancellationToken);
            byte[] responseBytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
            string directory = Path.Combine(output, "http");
            Directory.CreateDirectory(directory);
            File.WriteAllBytes(Path.Combine(directory, name + ".request.body"), requestBytes);
            File.WriteAllBytes(Path.Combine(directory, name + ".response.body"), responseBytes);
            Save("http/" + name + ".json", new
            {
                method = request.Method.Method, url = request.RequestUri!.ToString(), status = (int)response.StatusCode,
                protocol = response.Version.ToString(), requestHeaders = request.Headers.ToString(), responseHeaders = response.Headers.ToString(),
                contentHeaders = response.Content.Headers.ToString(), requestSha256 = Hash(requestBytes), responseSha256 = Hash(responseBytes)
            });
            return response;
        }
    }

    private static async Task Reports()
    {
        string destination = Path.Combine(output, "reports-cli");
        var result = await Call("selftest", "round4", "--out", destination);
        Require(result.Exit == 0, "A5 selftest exit");
        string expectedFile = Path.Combine(root, "tools", "sim-cli", "verification", OperatingSystem.IsWindows() ? "expected-round4-sha256.json" : "expected-round4-sha256-lf.json");
        var expected = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(expectedFile))!;
        var actual = Directory.GetFiles(destination, "ROUND4_*_REPORT.*").OrderBy(Path.GetFileName, StringComparer.Ordinal)
            .ToDictionary(file => Path.GetFileName(file), file => Hash(File.ReadAllBytes(file)), StringComparer.Ordinal);
        Save("report-hashes-cli.json", actual);
        Require(actual.Count == 10 && expected.Count == 10 && expected.All(pair => actual.GetValueOrDefault(pair.Key) == pair.Value),
            OperatingSystem.IsWindows() ? "A5 matches independently frozen Windows historical 10 report hashes" : "A5 matches explicitly LF-derived hashes from frozen Windows history", actual);
    }
}
