using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using MyGame.Sim.Cli;
using Prototype.Combat;

namespace P2.Verification;

internal static class Program
{
    private static readonly UTF8Encoding Utf8 = new(false);

    public static int Main(string[] args)
    {
        Console.OutputEncoding = Utf8;
        try
        {
            if (args.Length < 2) throw new ArgumentException("Use single|snapshot|linked|compare-priority|compare|action-equivalent <input> --out <fresh-directory>.");
            string command = args[0];
            string input = Path.GetFullPath(args[1]);
            var options = Options(args.Skip(2).ToArray());
            string output = Path.GetFullPath(Require(options, "out"));
            if (Directory.Exists(output) && Directory.EnumerateFileSystemEntries(output).Any())
                throw new ArgumentException("Oracle output must be new or empty; original evidence is never overwritten.");
            Directory.CreateDirectory(output);
            byte[] inputBytes = File.ReadAllBytes(input);
            WriteBytes(output, "input.raw.json", inputBytes);
            object result;
            string logHash = null;
            switch (command)
            {
                case "single":
                case "snapshot":
                {
                    Check(options, "out", "max-steps", "max-wait");
                    CombatScenario scenario = UnityJson.Read<CombatScenario>(Utf8.GetString(inputBytes));
                    var session = new CombatSession(scenario);
                    WriteJson(output, "normalized-scenario.json", session.GetScenario());
                    WriteJson(output, "initial-snapshot.json", session.GetSnapshot());
                    WriteJson(output, "available-actions.json", session.GetScenario().units.Select(unit =>
                        new { unitId = unit.id, actions = session.GetAvailableActions(unit.id) }).ToArray());
                    WriteJson(output, "normalized-actions.json", session.GetScenario().actions
                        .Select(CombatSession.NormalizeActionDefinition).ToArray());
                    if (command == "snapshot") result = new { kind = "snapshot" };
                    else
                    {
                        int steps = options.TryGetValue("max-steps", out string value) ? int.Parse(value, CultureInfo.InvariantCulture) : 10000;
                        double wait = options.TryGetValue("max-wait", out value) ? double.Parse(value, CultureInfo.InvariantCulture) : 100000;
                        CombatRunResult run = session.RunToCompletion(steps, wait);
                        WriteJson(output, "run-result.json", run);
                        byte[] log = Utf8.GetBytes(session.ExportLogText());
                        WriteBytes(output, "combat.log", log);
                        logHash = Hash(log);
                        result = new { kind = "single", callMaxSteps = steps, callMaxWait = wait, run.outcome, run.winnerTeam, run.stopReason, run.time, run.executedActionCount, logBytes = log.Length, logSha256 = logHash };
                    }
                    break;
                }
                case "linked":
                {
                    Check(options, "out");
                    CombatExpeditionConfig config = UnityJson.Read<CombatExpeditionConfig>(Utf8.GetString(inputBytes));
                    WriteJson(output, "normalized-expedition.json", CombatExpeditionSession.CopyConfig(config));
                    var expedition = new CombatExpeditionSession(config);
                    CombatExpeditionReport report = expedition.RunToEnd();
                    string settledReport = UnityJson.Serialize(report, true);
                    WriteBytes(output, "expedition-report.json", Utf8.GetBytes(settledReport));
                    var logs = new List<object>();
                    foreach (CombatEncounterReport record in report.encounters)
                    {
                        string first = expedition.ExportEncounterLogText(record.encounterIndex);
                        string again = expedition.ExportEncounterLogText(record.encounterIndex);
                        if (!string.Equals(first, again, StringComparison.Ordinal))
                            throw new InvalidOperationException("Repeated same-instance log reads changed the text.");
                        byte[] bytes = Utf8.GetBytes(first);
                        string file = "encounter_" + record.encounterIndex.ToString(CultureInfo.InvariantCulture) + ".log";
                        WriteBytes(output, file, bytes);
                        logs.Add(new { record.encounterIndex, record.encounterId, record.scenarioId, file, bytes = bytes.Length, sha256 = Hash(bytes) });
                    }
                    string afterReads = UnityJson.Serialize(expedition.GetReport(), true);
                    WriteBytes(output, "post-getter-report.json", Utf8.GetBytes(afterReads));
                    if (!string.Equals(settledReport, afterReads, StringComparison.Ordinal))
                        throw new InvalidOperationException("Reading cached same-instance logs changed the settled report.");
                    result = new { kind = "linked", sameRuntimeInstance = true, runToEndCalls = 1, replayCalls = 0,
                        getterReadsPerEncounter = 2, settledReportUnchangedByReads = true, logs = logs.ToArray() };
                    break;
                }
                case "compare-priority":
                {
                    Check(options, "out", "unit", "from", "to");
                    CombatScenario scenario = UnityJson.Read<CombatScenario>(Utf8.GetString(inputBytes));
                    string unit = options.GetValueOrDefault("unit", "mage");
                    int from = int.Parse(options.GetValueOrDefault("from", "1"), CultureInfo.InvariantCulture);
                    int to = int.Parse(options.GetValueOrDefault("to", "0"), CultureInfo.InvariantCulture);
                    CombatComparisonReport report = CombatSampleRuns.ComparePriority(scenario, unit, from, to);
                    WriteJson(output, "comparison.json", report);
                    result = new { kind = command, unitId = unit, fromIndex = from, toIndex = to, report.onlyDeclaredSettingChanged };
                    break;
                }
                case "compare":
                {
                    Check(options, "out", "variant");
                    byte[] rightBytes = File.ReadAllBytes(Path.GetFullPath(Require(options, "variant")));
                    WriteBytes(output, "variant.raw.json", rightBytes);
                    CombatComparisonReport report = CombatSampleRuns.CompareScenarios(
                        UnityJson.Read<CombatScenario>(Utf8.GetString(inputBytes)), UnityJson.Read<CombatScenario>(Utf8.GetString(rightBytes)));
                    WriteJson(output, "comparison.json", report);
                    result = new { kind = command, report.onlyDeclaredSettingChanged, variantSha256 = Hash(rightBytes) };
                    break;
                }
                case "action-equivalent":
                {
                    Check(options, "out", "variant");
                    byte[] rightBytes = File.ReadAllBytes(Path.GetFullPath(Require(options, "variant")));
                    WriteBytes(output, "variant.raw.json", rightBytes);
                    var left = UnityJson.Read<CombatActionConfig>(Utf8.GetString(inputBytes));
                    var right = UnityJson.Read<CombatActionConfig>(Utf8.GetString(rightBytes));
                    result = new { kind = command, equivalent = CombatSession.ActionDefinitionsEquivalent(left, right), variantSha256 = Hash(rightBytes) };
                    break;
                }
                default:
                    throw new ArgumentException("Unknown oracle mode.");
            }
            WriteJson(output, "ORACLE_RESULT.json", new
            {
                schemaVersion = 1, oracle = "RealGameKernelDirectSource", command,
                reader = "UnityJson.Read<T>(raw), reportMode=false; identical to existing Program.Read<T>",
                input, inputBytes = inputBytes.Length, inputSha256 = Hash(inputBytes),
                runtime = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
                processId = Environment.ProcessId, result,
                logCapture = "UTF8.GetBytes(CombatSession.ExportLogText()); no newline normalization",
                linkedLog = command == "linked" ? "Executed_SameInstanceExportEncounterLogText" : "NotRun"
            });
            Console.WriteLine(UnityJson.Serialize(new { ok = true, command, output, logSha256 = logHash }, true));
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.GetType().Name + ": " + error.Message);
            return 1;
        }
    }

    private static Dictionary<string, string> Options(string[] args)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        for (int index = 0; index < args.Length; index += 2)
        {
            if (!args[index].StartsWith("--", StringComparison.Ordinal) || index + 1 >= args.Length ||
                !values.TryAdd(args[index][2..], args[index + 1])) throw new ArgumentException("Options must be unique --name value pairs.");
        }
        return values;
    }
    private static string Require(Dictionary<string, string> values, string key) => values.TryGetValue(key, out string value)
        ? value : throw new ArgumentException("Missing --" + key);
    private static void Check(Dictionary<string, string> values, params string[] allowed)
    {
        foreach (string key in values.Keys) if (!allowed.Contains(key, StringComparer.Ordinal)) throw new ArgumentException("Unknown option --" + key);
    }
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static void WriteJson(string root, string name, object value) => WriteBytes(root, name, Utf8.GetBytes(UnityJson.Serialize(value, true)));
    private static void WriteBytes(string root, string name, byte[] bytes)
    {
        using var file = new FileStream(Path.Combine(root, name), FileMode.CreateNew, FileAccess.Write, FileShare.Read);
        file.Write(bytes);
    }
}
