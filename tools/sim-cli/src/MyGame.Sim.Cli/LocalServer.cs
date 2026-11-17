using System.Diagnostics;
using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http.Features;
using Prototype.Combat;

namespace MyGame.Sim.Cli;

public sealed class LocalServer(ContentStore content, string repository, string? exportDirectory = null)
{
    public const string Version = "0.4.0-p3";
    private readonly SemaphoreSlim gate = new(1, 1);
    private string ExportRoot => Path.GetFullPath(exportDirectory ?? (string.Equals(content.Root, Path.Combine(repository, "content"), OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal)
        ? Path.Combine(repository, "Game", "Assets", "StreamingAssets", "Content") : Path.Combine(content.Root, "..", "runtime")));
    private ContentProject Project() => ContentProject.Load(content, repository);

    public async Task Run(int port, CancellationToken cancellation)
    {
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { Args = Array.Empty<string>() });
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.Listen(IPAddress.Loopback, port);
            options.Limits.MaxRequestBodySize = 2 * 1024 * 1024;
        });
        await using var app = builder.Build();
        app.Run(Handle);
        await app.StartAsync(cancellation);
        Console.Error.WriteLine("sim-cli listening on http://127.0.0.1:" + port);
        try
        {
            await app.WaitForShutdownAsync(cancellation);
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
        finally { await app.StopAsync(CancellationToken.None); }
    }

    private async Task Handle(HttpContext context)
    {
        HttpRequest request = context.Request;
        HttpResponse response = context.Response;
        await gate.WaitAsync(context.RequestAborted);
        try
        {
            string? origin = request.Headers.TryGetValue("Origin", out var originValues) ? originValues.ToString() : null;
            if (origin is not null)
            {
                if (!AllowedOrigin(origin)) { await Reply(403, new { ok = false, error = "Origin is not allowed." }); return; }
                response.Headers["Access-Control-Allow-Origin"] = origin;
                response.Headers["Vary"] = "Origin";
                response.Headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
                response.Headers["Access-Control-Allow-Headers"] = "Content-Type, If-Match, If-None-Match";
                response.Headers["Access-Control-Expose-Headers"] = "ETag";
            }
            string raw = (context.Features.Get<IHttpRequestFeature>()?.RawTarget ?? "").Split('?')[0];
            string path = Uri.UnescapeDataString(raw);
            string[] parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Any(part => part is "." or ".." || part.Contains('\\') || part.Contains(':') || part.Contains('\0')))
                throw new ArgumentException("Invalid content path.");
            if (request.Method == "OPTIONS") { response.StatusCode = 204; return; }
            if (request.Method == "GET" && path == "/api/health")
                await Reply(200, new { ok = true, version = Version, contentRoot = content.Root, exportRoot = ExportRoot, gitCommit = GitCommit(repository) });
            else if (request.Method == "GET" && path == "/api/catalog") await Reply(200, Simulation.Catalog());
            else if (request.Method == "GET" && path == "/api/capabilities")
                await Reply(200, new { schemaVersion = 1, contentTypes = ContentStore.EntityTypes.Select(type => new { id = type, plural = ContentStore.DirectoryFor(type), label = type == "item" ? "物品" : type, editable = type == "item" || BaseContent.Types.Contains(type) || CombatContent.Types.Contains(type) && type != "rule" }).ToArray(),
                    itemCategories = ItemValidation.Categories, equipmentSlots = ItemValidation.Slots,
                    combatBonusFields = JsonSerializer.SerializeToElement(Simulation.Catalog(), new JsonSerializerOptions { IncludeFields = true }).GetProperty("combatBonusFields"), consumableEffectKinds = Array.Empty<string>(), exportRoot = ExportRoot,
                    @base = new { staticOnly = true, notice = BaseContent.StaticNotice, buildingFunctions = BaseContent.Functions, sourceKinds = BaseContent.SourceKinds, sinkKinds = BaseContent.SinkKinds, editableRuleIds = new[] { BaseContent.FlowRulesId }, farFromStorageThreshold = BaseLayouts.FarFromStorageThreshold } });
            else if (request.Method == "POST" && path == "/api/layout/check")
            {
                JsonObject body = CombatContent.Object(JsonNode.Parse(await Body()));
                if (body.Count != 1 || body["layout"] is not JsonObject layout) throw new ArgumentException("layout/check body必须为{layout}。");
                await Reply(200, BaseLayouts.Check(Project(), layout));
            }
            else if (request.Method == "POST" && path == "/api/layout/distance") await Reply(200, BaseLayouts.Distance(Project(), CombatContent.Object(JsonNode.Parse(await Body()))));
            else if (request.Method == "GET" && path == "/api/chain") await Reply(200, BaseChains.Analyze(Project()));
            else if (request.Method == "POST" && path == "/api/import-first-meal")
            {
                JsonObject body = CombatContent.Object(JsonNode.Parse(await Body()));
                if (body.Count != 0) throw new ArgumentException("首餐导入body必须为{}，来源固定为旧default.json。");
                await Reply(200, BaseImport.FirstMeal(Project()));
            }
            else if (request.Method == "GET" && parts.Length == 3 && parts[0] == "api" && parts[1] == "ids") await Reply(200, Project().Lookup(parts[2]));
            else if (request.Method == "GET" && parts.Length == 3 && parts[0] == "api" && parts[1] == "refs") await Reply(200, ReferenceIndex.Refs(Project(), parts[2]));
            else if (request.Method == "POST" && path is "/api/import-scenario" or "/api/import-expedition")
            {
                JsonObject body = CombatContent.Object(JsonNode.Parse(await Body()));
                if (body.Any(p => p.Key is not "sourceName" and not "jsonText" and not "prefix")) throw new ArgumentException("Unknown import field.");
                await Reply(200, CombatImport.Import(Project(), CombatContent.Text(body["jsonText"]), CombatContent.Text(body["sourceName"]), path == "/api/import-expedition", body.ContainsKey("prefix") ? CombatContent.Text(body["prefix"]) : null));
            }
            else if (request.Method == "POST" && path == "/api/assemble") await Reply(200, CombatAssembly.Build(Project(), JsonNode.Parse(await Body())).Envelope());
            else if (request.Method == "POST" && path == "/api/trial/run") await Reply(200, CombatRuns.Run(Project(), JsonNode.Parse(await Body())));
            else if (request.Method == "POST" && path == "/api/trial/compare") await Reply(200, CombatRuns.Compare(Project(), CombatContent.Object(JsonNode.Parse(await Body()))));
            else if (request.Method == "POST" && path == "/api/character/validate") await Reply(200, CombatRuns.Character(Project(), CombatContent.Object(JsonNode.Parse(await Body()))));
            else if (request.Method == "POST" && path == "/api/export-scenario")
            {
                JsonObject body = CombatContent.Object(JsonNode.Parse(await Body()));
                if (body.Count != 1 || CombatContent.Text(body["trialId"]) == "") throw new ArgumentException("export-scenario body必须仅为{trialId}。");
                await Reply(200, CombatRuns.ExportScenario(Project(), CombatContent.Text(body["trialId"])));
            }
            else if (request.Method == "POST" && path == "/api/validate-entity")
            {
                JsonObject body = CombatContent.Object(JsonNode.Parse(await Body()));
                if (body.Any(p => p.Key is not "type" and not "mode" and not "entity" and not "requests" and not "editIntent")) throw new ArgumentException("未知entity校验字段。");
                if (body["requests"] is not null && body["requests"] is not JsonArray) throw new ArgumentException("requests必须是数组。");
                ContentProject project = Project();
                string type = ContentStore.CanonicalType(CombatContent.Text(body["type"]));
                JsonObject entity = CombatContent.Object(body["entity"]);
                ContentValidation result = CombatContent.ValidateCandidate(project, type, entity, CombatContent.Text(body["mode"]), body["requests"] as JsonArray);
                if (result.ok && CombatContent.Types.Contains(type) && !BaseContent.IsFlowRule(type, CombatContent.Text(entity["id"]))) CombatImport.TrackEdits(project, type, CombatContent.Text(entity["id"]), entity, body["editIntent"], new Dictionary<string, string?>(StringComparer.Ordinal));
                await Reply(result.ok ? 200 : 422, result);
            }
            else if (request.Method == "POST" && path == "/api/validate-item")
            {
                JsonObject body = JsonNode.Parse(await Body()) as JsonObject ?? throw new ArgumentException("校验body必须是对象。");
                if (body["entity"] is not JsonObject entity) throw new ArgumentException("校验body必须包含entity对象。");
                if (body["requests"] is not null && body["requests"] is not JsonArray) throw new ArgumentException("requests必须是数组。");
                var drafts = (body["requests"] as JsonArray)?.Select(node => node as JsonObject ?? throw new ArgumentException("需求必须是对象。"));
                ContentValidation result = Project().ValidateItem(entity, ContentProject.Text(body["mode"]), drafts);
                await Reply(result.ok ? 200 : 422, result);
            }
            else if (request.Method == "POST" && path is "/api/validate-content" or "/api/export")
            {
                string rawBody = await Body();
                if (JsonNode.Parse(rawBody == "" ? "{}" : rawBody) is not JsonObject body || body.Count != 0) throw new ArgumentException("此接口body必须是空对象；目录由serve参数固定。");
                if (path == "/api/export") await Reply(200, ContentExport.Export(Project(), ExportRoot));
                else { ContentValidation result = Project().Validate(includeBaseDiagnostics: true); await Reply(result.ok ? 200 : 422, result); }
            }
            else if (request.Method == "POST" && path == "/api/validate")
            {
                ValidationResult result = Simulation.Validate(UnityJson.Read<CombatScenario>(await Body()));
                await Reply(result.ok ? 200 : 422, result);
            }
            else if (request.Method == "POST" && path is "/api/run-combat" or "/api/run-expedition")
            {
                string body = await Body(); ReferenceIndex.EnsureRunnable(Project(), JsonNode.Parse(body));
                if (path == "/api/run-combat") await Reply(200, Simulation.Run(UnityJson.Read<CombatScenario>(body)));
                else await Reply(200, Simulation.Expedition(UnityJson.Read<CombatExpeditionConfig>(body)));
            }
            else if (request.Method == "POST" && path == "/api/compare")
            {
                using JsonDocument doc = JsonDocument.Parse(await Body());
                if (doc.RootElement.ValueKind != JsonValueKind.Object ||
                    !doc.RootElement.TryGetProperty("baseline", out var baseline) || !doc.RootElement.TryGetProperty("variant", out var variant))
                    throw new ArgumentException("Compare body must contain baseline and variant objects.");
                ReferenceIndex.EnsureRunnable(Project(), JsonNode.Parse(baseline.GetRawText()));
                ReferenceIndex.EnsureRunnable(Project(), JsonNode.Parse(variant.GetRawText()));
                await Reply(200, Simulation.Compare(UnityJson.Read<CombatScenario>(baseline.GetRawText()), UnityJson.Read<CombatScenario>(variant.GetRawText())));
            }
            else if (request.Method == "GET" && path == "/api/requests") await Reply(200, new RequestStore(content).ReadAll());
            else if (request.Method == "POST" && path == "/api/requests")
            {
                RequestRecord draft = UnityJson.Read<RequestRecord>(await Body());
                if (!RequestStore.ValidDate(draft.createdAt)) throw new ArgumentException("createdAt must be empty or a valid yyyy-MM-dd calendar date.");
                await Reply(201, ContentEditing.CreateRequest(Project(), draft));
            }
            else if (parts.Length is 3 or 4 && parts[0] == "api" && parts[1] == "content")
            {
                string type = parts[2];
                if (parts.Length == 3 && request.Method == "GET") await Reply(200, content.List(type));
                else if (parts.Length == 4)
                {
                    string id = parts[3];
                    if (request.Method == "GET")
                    {
                        string file = content.EntityPath(type, id);
                        if (!File.Exists(file)) { await Reply(404, new { ok = false, error = "Entity not found." }); return; }
                        response.Headers["ETag"] = ContentEditing.ETag(file);
                        using JsonDocument doc = JsonDocument.Parse(File.ReadAllText(file));
                        await Reply(200, doc.RootElement);
                    }
                    else if (request.Method == "PUT")
                    {
                        JsonObject body = JsonNode.Parse(await Body()) as JsonObject ?? throw new ArgumentException("实体必须是对象。");
                        object result = ContentEditing.Save(Project(), type, id, body, request.Headers["If-Match"].ToString(), request.Headers["If-None-Match"].ToString(), out string etag, out bool created);
                        response.Headers["ETag"] = etag;
                        await Reply(created ? 201 : 200, result);
                    }
                    else if (request.Method == "DELETE")
                    {
                        string file = content.EntityPath(type, id);
                        if (!File.Exists(file)) { await Reply(404, new { ok = false, error = "Entity not found." }); return; }
                        ContentEditing.Delete(Project(), type, id, request.Headers["If-Match"].ToString());
                        await Reply(200, new { ok = true });
                    }
                    else await Reply(405, new { ok = false, error = "Method not allowed." });
                }
                else await Reply(405, new { ok = false, error = "Method not allowed." });
            }
            else await Reply(404, new { ok = false, error = "Route not found." });
        }
        catch (ContentConflict error) { if (error.ETag != "") response.Headers["ETag"] = error.ETag; await Reply(409, error.Payload); }
        catch (ContentValidationException error) { await Reply(422, error.Result); }
        catch (NotImplementedException error) { await Reply(501, new { ok = false, error = error.Message }); }
        catch (JsonException error) { await Reply(400, new { ok = false, error = error.Message }); }
        catch (ArgumentException error) { await Reply(400, new { ok = false, error = error.Message }); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        { Console.Error.WriteLine(error.Message); await Reply(500, new { ok = false, error = "Content IO failed." }); }
        finally { gate.Release(); }

        async Task<string> Body()
        {
            const int limit = 2 * 1024 * 1024;
            if (request.ContentLength > limit) throw new ArgumentException("Request body exceeds 2 MiB.");
            using var bytes = new MemoryStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = await request.Body.ReadAsync(buffer)) > 0)
            {
                if (bytes.Length + read > limit) throw new ArgumentException("Request body exceeds 2 MiB.");
                bytes.Write(buffer, 0, read);
            }
            return UnityJson.Utf8.GetString(bytes.ToArray());
        }

        async Task Reply(int status, object value)
        {
            byte[] bytes = UnityJson.Utf8.GetBytes(UnityJson.Serialize(value));
            response.StatusCode = status;
            response.ContentType = "application/json; charset=utf-8";
            response.ContentLength = bytes.Length;
            await response.Body.WriteAsync(bytes);
        }
    }

    public static bool AllowedOrigin(string origin) => Uri.TryCreate(origin, UriKind.Absolute, out Uri? uri) &&
        uri.Scheme == "http" && uri.UserInfo == "" && uri.AbsolutePath == "/" && uri.Query == "" && uri.Fragment == "" &&
        (uri.Host == "localhost" || uri.Host == "127.0.0.1");

    public static string GitCommit(string repository)
    {
        try
        {
            var info = new ProcessStartInfo("git") { WorkingDirectory = repository, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
            info.ArgumentList.Add("-c"); info.ArgumentList.Add("safe.directory=" + repository.Replace('\\', '/'));
            info.ArgumentList.Add("rev-parse"); info.ArgumentList.Add("HEAD");
            using Process? process = Process.Start(info);
            if (process is null) return "";
            string result = process.StandardOutput.ReadToEnd();
            if (!process.WaitForExit(3000)) { process.Kill(); return ""; }
            return process.ExitCode == 0 ? result.Trim() : "";
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or IOException or InvalidOperationException) { return ""; }
    }
}
