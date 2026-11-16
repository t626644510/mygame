using System.Diagnostics;
using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using Prototype.Combat;

namespace MyGame.Sim.Cli;

public sealed class LocalServer(ContentStore content, string repository)
{
    public const string Version = "0.1.0-p0";
    private readonly SemaphoreSlim gate = new(1, 1);

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
                response.Headers["Access-Control-Allow-Headers"] = "Content-Type";
            }
            string raw = (context.Features.Get<IHttpRequestFeature>()?.RawTarget ?? "").Split('?')[0];
            string path = Uri.UnescapeDataString(raw);
            string[] parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Any(part => part is "." or ".." || part.Contains('\\') || part.Contains(':') || part.Contains('\0')))
                throw new ArgumentException("Invalid content path.");
            if (request.Method == "OPTIONS") { response.StatusCode = 204; return; }
            if (request.Method == "GET" && path == "/api/health")
                await Reply(200, new { ok = true, version = Version, contentRoot = content.Root, gitCommit = GitCommit(repository) });
            else if (request.Method == "GET" && path == "/api/catalog") await Reply(200, Simulation.Catalog());
            else if (request.Method == "POST" && path == "/api/validate")
            {
                ValidationResult result = Simulation.Validate(UnityJson.Read<CombatScenario>(await Body()));
                await Reply(result.ok ? 200 : 422, result);
            }
            else if (request.Method == "POST" && path == "/api/run-combat")
                await Reply(200, Simulation.Run(UnityJson.Read<CombatScenario>(await Body())));
            else if (request.Method == "POST" && path == "/api/run-expedition")
                await Reply(200, Simulation.Expedition(UnityJson.Read<CombatExpeditionConfig>(await Body())));
            else if (request.Method == "POST" && path == "/api/compare")
            {
                using JsonDocument doc = JsonDocument.Parse(await Body());
                if (doc.RootElement.ValueKind != JsonValueKind.Object ||
                    !doc.RootElement.TryGetProperty("baseline", out var baseline) || !doc.RootElement.TryGetProperty("variant", out var variant))
                    throw new ArgumentException("Compare body must contain baseline and variant objects.");
                await Reply(200, Simulation.Compare(UnityJson.Read<CombatScenario>(baseline.GetRawText()), UnityJson.Read<CombatScenario>(variant.GetRawText())));
            }
            else if (request.Method == "GET" && path == "/api/requests") await Reply(200, new RequestStore(content).ReadAll());
            else if (request.Method == "POST" && path == "/api/requests")
            {
                RequestRecord draft = UnityJson.Read<RequestRecord>(await Body());
                if (!RequestStore.ValidDate(draft.createdAt)) throw new ArgumentException("createdAt must be empty or a valid yyyy-MM-dd calendar date.");
                await Reply(201, new RequestStore(content).Create(draft));
            }
            else if (parts.Length is 3 or 4 && parts[0] == "api" && parts[1] == "content")
            {
                string type = parts[2];
                if (parts.Length == 3 && request.Method == "GET") await Reply(200, content.List(type));
                else if (parts.Length == 4)
                {
                    string id = parts[3];
                    string file = content.EntityPath(type, id);
                    if (request.Method == "GET")
                    {
                        if (!File.Exists(file)) { await Reply(404, new { ok = false, error = "Entity not found." }); return; }
                        using JsonDocument doc = JsonDocument.Parse(File.ReadAllText(file));
                        await Reply(200, doc.RootElement);
                    }
                    else if (request.Method == "PUT")
                    {
                        using JsonDocument doc = JsonDocument.Parse(await Body());
                        ContentValidation result = ContentStore.ValidateEntity(type, id, doc.RootElement);
                        if (!result.ok) { await Reply(422, result); return; }
                        UnityJson.WriteFile(file, UnityJson.Serialize(doc.RootElement));
                        await Reply(200, doc.RootElement);
                    }
                    else if (request.Method == "DELETE")
                    {
                        if (!File.Exists(file)) { await Reply(404, new { ok = false, error = "Entity not found." }); return; }
                        File.Delete(file);
                        await Reply(200, new { ok = true });
                    }
                    else await Reply(405, new { ok = false, error = "Method not allowed." });
                }
                else await Reply(405, new { ok = false, error = "Method not allowed." });
            }
            else await Reply(404, new { ok = false, error = "Route not found." });
        }
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
