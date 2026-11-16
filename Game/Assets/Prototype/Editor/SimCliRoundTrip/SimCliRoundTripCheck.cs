using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using Prototype.Combat;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Prototype.Editor.SimCliRoundTrip
{
    /// <summary>Editor-only A6 check; never creates or starts a Player.</summary>
    public static class SimCliRoundTripCheck
    {
        private const string RequiredUnityVersion = "6000.3.28f1";
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        private static readonly string[] FileNames =
        {
            "default.json", "round2_ambush.json", "round2_capacity.json", "round2_equipment.json",
            "round2_expedition.json", "round2_one_idle.json", "round2_pressure.json",
            "round2_stalemate.json", "round2_time_tie.json", "round3_focus_mark.json",
            "round3_mp_reserve.json", "round3_tactics.json", "round4_area.json", "round4_cleanse.json",
            "round4_control.json", "round4_expedition.json", "round4_mage_library.json",
            "round4_meditation.json", "round4_meditation_risk.json"
        };

        // Unity -batchmode -nographics -quit -executeMethod
        // Prototype.Editor.SimCliRoundTrip.SimCliRoundTripCheck.Run
        public static void Run()
        {
            // An accidental interactive invocation must neither run checks nor close the Editor.
            if (!Application.isBatchMode)
                throw new InvalidOperationException("A6 requires a noninteractive Unity batchmode process.");

            int exitCode = 1;
            try
            {
                if (Application.platform != RuntimePlatform.WindowsEditor ||
                    Application.unityVersion != RequiredUnityVersion ||
                    SystemInfo.graphicsDeviceType != GraphicsDeviceType.Null)
                    throw new InvalidOperationException("A6 requires Windows Unity " + RequiredUnityVersion +
                        " with -batchmode -nographics (Null graphics device).");

                string originalRoot = Path.GetFullPath(Path.Combine(Application.streamingAssetsPath, "Prototype", "Combat"));
                string roundTripRoot = ReadPathArgument("-simCliRoundTripRoot");
                string outputRoot = ReadPathArgument("-simCliRoundTripOutput");
                if (Within(outputRoot, originalRoot) || Within(outputRoot, roundTripRoot) ||
                    Within(originalRoot, outputRoot) || Within(roundTripRoot, outputRoot))
                    throw new ArgumentException("A6 output must be separate from both input directories.");
                if (Directory.Exists(outputRoot) || File.Exists(outputRoot))
                    throw new IOException("A6 output directory must be new: " + outputRoot);
                AssertFileSet(originalRoot);
                AssertFileSet(roundTripRoot);
                Directory.CreateDirectory(outputRoot);

                var report = new CheckReport
                {
                    unityVersion = Application.unityVersion,
                    platform = Application.platform.ToString(),
                    batchMode = Application.isBatchMode,
                    graphicsDevice = SystemInfo.graphicsDeviceType.ToString(),
                    originalRoot = originalRoot,
                    roundTripRoot = roundTripRoot,
                    expectedConfigurationCount = FileNames.Length
                };
                var results = new List<CaseResult>();
                foreach (string fileName in FileNames)
                {
                    CaseResult result = CheckCase(originalRoot, roundTripRoot, outputRoot, fileName);
                    results.Add(result);
                    report.comparedLogPairs += result.logPairs.Length;
                    if (result.passed) report.passedConfigurationCount++;
                    Debug.Log("[SimCliRoundTrip] " + fileName + ": " + (result.passed ? "Passed" : "Failed") +
                        "; logPairs=" + result.logPairs.Length + (result.passed ? "" : "; " + result.error));
                }
                report.cases = results.ToArray();
                report.passed = report.passedConfigurationCount == FileNames.Length && report.comparedLogPairs == 21;
                WriteText(Path.Combine(outputRoot, "A6_RESULTS.json"), JsonUtility.ToJson(report, true) + "\n");
                Debug.Log("[SimCliRoundTrip] A6 " + (report.passed ? "Passed" : "Failed") +
                    "; configurations=" + report.passedConfigurationCount + "/" + FileNames.Length +
                    "; logPairs=" + report.comparedLogPairs + "; report=" + Path.Combine(outputRoot, "A6_RESULTS.json"));
                exitCode = report.passed ? 0 : 1;
            }
            catch (Exception exception)
            {
                Debug.LogError("[SimCliRoundTrip] A6 failed before completion: " + exception);
            }
            EditorApplication.Exit(exitCode);
        }

        private static CaseResult CheckCase(string originalRoot, string roundTripRoot, string outputRoot, string fileName)
        {
            var result = new CaseResult { file = fileName, kind = IsExpedition(fileName) ? "expedition" : "combat" };
            var pairs = new List<LogPair>();
            var errors = new List<string>();
            try
            {
                string originalPath = Path.Combine(originalRoot, fileName);
                string roundTripPath = Path.Combine(roundTripRoot, fileName);
                result.originalSha256 = Hash(File.ReadAllBytes(originalPath));
                result.roundTripSha256 = Hash(File.ReadAllBytes(roundTripPath));
                string originalText = File.ReadAllText(originalPath, Utf8);
                string roundTripText = File.ReadAllText(roundTripPath, Utf8);
                string caseRoot = Path.Combine(outputRoot, Path.GetFileNameWithoutExtension(fileName));
                Directory.CreateDirectory(caseRoot);
                if (IsExpedition(fileName))
                    CheckExpedition(originalText, roundTripText, caseRoot, pairs, errors);
                else
                {
                    var original = new CombatSession(JsonUtility.FromJson<CombatScenario>(originalText));
                    var roundTrip = new CombatSession(JsonUtility.FromJson<CombatScenario>(roundTripText));
                    CombatRunResult originalRun = original.RunToCompletion();
                    CombatRunResult roundTripRun = roundTrip.RunToCompletion();
                    CompareJson(caseRoot, "run", originalRun, roundTripRun, errors);
                    pairs.Add(CompareLogs(caseRoot, "combat", original.ExportLogText(), roundTrip.ExportLogText()));
                }
            }
            catch (Exception exception)
            {
                errors.Add(exception.ToString());
            }
            result.logPairs = pairs.ToArray();
            foreach (LogPair pair in pairs)
                if (!pair.equal) errors.Add(pair.name + " ExportLogText differs at UTF-8 byte " + pair.firstDifferentByte + ".");
            result.passed = errors.Count == 0 && pairs.Count == (IsExpedition(fileName) ? 2 : 1);
            result.error = string.Join("\n", errors);
            return result;
        }

        private static void CheckExpedition(string originalText, string roundTripText, string caseRoot,
            List<LogPair> pairs, List<string> errors)
        {
            CombatExpeditionConfig originalConfig = JsonUtility.FromJson<CombatExpeditionConfig>(originalText);
            CombatExpeditionConfig roundTripConfig = JsonUtility.FromJson<CombatExpeditionConfig>(roundTripText);
            CombatExpeditionReport originalReport = new CombatExpeditionSession(originalConfig).RunToEnd();
            CombatExpeditionReport roundTripReport = new CombatExpeditionSession(roundTripConfig).RunToEnd();
            CompareJson(caseRoot, "expedition", originalReport, roundTripReport, errors);
            if (!originalReport.finished || !roundTripReport.finished ||
                originalReport.stopReason != "CompletedAllEncounters" || roundTripReport.stopReason != "CompletedAllEncounters" ||
                originalReport.encounters.Length != 2 || roundTripReport.encounters.Length != 2)
                throw new InvalidOperationException("Each A6 expedition must finish its two actual encounters.");

            // Expedition has no log-export API. Replay with the carry snapshot produced by
            // its actual RunToEnd path, then verify that replay against that encounter record.
            // All carry, timer, combat and reward rules remain in the existing Runtime.
            for (int index = 0; index < originalReport.encounters.Length; index++)
            {
                CombatSession original = ReplayEncounter(originalConfig, originalReport.encounters[index], errors, "original");
                CombatSession roundTrip = ReplayEncounter(roundTripConfig, roundTripReport.encounters[index], errors, "roundtrip");
                pairs.Add(CompareLogs(caseRoot, "encounter_" + (index + 1),
                    original.ExportLogText(), roundTrip.ExportLogText()));
            }
        }

        private static CombatSession ReplayEncounter(CombatExpeditionConfig config, CombatEncounterReport record,
            List<string> errors, string side)
        {
            CombatEncounterConfig encounter = config.encounters[record.encounterIndex - 1];
            CombatScenario scenario = CombatSession.CopyScenario(encounter.scenario);
            if (string.IsNullOrEmpty(scenario.playerTeam)) scenario.playerTeam = config.carryTeam;
            CombatSession session = record.previousBattleEnd == null
                ? new CombatSession(scenario)
                : new CombatSession(scenario, record.previousBattleEnd, config.carryTeam, encounter.waitBefore);
            if (JsonUtility.ToJson(session.GetSnapshot()) != JsonUtility.ToJson(record.battleStart))
                errors.Add(side + " encounter " + record.encounterIndex + " replay start differs from RunToEnd.");
            CombatRunResult run = session.RunToCompletion(config.maxStepsPerBattle, config.maxWaitPerBattle);
            if (JsonUtility.ToJson(run.snapshot) != JsonUtility.ToJson(record.battleEnd) ||
                JsonUtility.ToJson(new Steps { values = run.steps }) != JsonUtility.ToJson(new Steps { values = record.steps }) ||
                run.outcome != record.outcome || run.winnerTeam != record.winnerTeam || run.stopReason != record.stopReason ||
                run.executedActionCount != record.executedActionCount)
                errors.Add(side + " encounter " + record.encounterIndex + " replay result differs from RunToEnd.");
            return session;
        }

        private static void CompareJson(string root, string name, object original, object roundTrip, List<string> errors)
        {
            string left = JsonUtility.ToJson(original, true) + "\n";
            string right = JsonUtility.ToJson(roundTrip, true) + "\n";
            WriteText(Path.Combine(root, name + ".original.json"), left);
            WriteText(Path.Combine(root, name + ".roundtrip.json"), right);
            if (!string.Equals(left, right, StringComparison.Ordinal)) errors.Add(name + " report JSON differs.");
        }

        private static LogPair CompareLogs(string root, string name, string original, string roundTrip)
        {
            byte[] left = Utf8.GetBytes(original);
            byte[] right = Utf8.GetBytes(roundTrip);
            WriteText(Path.Combine(root, name + ".original.log.txt"), original);
            WriteText(Path.Combine(root, name + ".roundtrip.log.txt"), roundTrip);
            int different = 0;
            while (different < left.Length && different < right.Length && left[different] == right[different]) different++;
            bool equal = different == left.Length && different == right.Length;
            return new LogPair
            {
                name = name, equal = equal, originalSha256 = Hash(left), roundTripSha256 = Hash(right),
                originalBytes = left.Length, roundTripBytes = right.Length, firstDifferentByte = equal ? -1 : different
            };
        }

        private static bool IsExpedition(string fileName) =>
            fileName == "round2_expedition.json" || fileName == "round4_expedition.json";

        private static void AssertFileSet(string root)
        {
            if (!Directory.Exists(root)) throw new DirectoryNotFoundException(root);
            var actual = new List<string>();
            foreach (string path in Directory.GetFiles(root, "*.json", SearchOption.TopDirectoryOnly)) actual.Add(Path.GetFileName(path));
            actual.Sort(StringComparer.Ordinal);
            if (actual.Count != FileNames.Length) throw new InvalidOperationException("Expected exactly 19 JSON configurations in " + root);
            for (int index = 0; index < FileNames.Length; index++)
                if (actual[index] != FileNames[index]) throw new InvalidOperationException("Unexpected A6 configuration set in " + root);
        }

        private static string ReadPathArgument(string name)
        {
            string[] arguments = Environment.GetCommandLineArgs();
            string value = null;
            for (int index = 0; index < arguments.Length; index++)
            {
                if (arguments[index] != name) continue;
                if (value != null || index + 1 >= arguments.Length || arguments[index + 1].StartsWith("-", StringComparison.Ordinal))
                    throw new ArgumentException("Expected one path value for " + name);
                value = arguments[++index];
            }
            if (string.IsNullOrWhiteSpace(value) || !Path.IsPathRooted(value))
                throw new ArgumentException("An absolute path is required for " + name);
            return Path.GetFullPath(value).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        }

        private static bool Within(string path, string root) =>
            string.Equals(path, root, StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) +
                Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);

        private static string Hash(byte[] bytes)
        {
            using (SHA256 hash = SHA256.Create())
                return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        }

        private static void WriteText(string path, string text) => File.WriteAllText(path, text, Utf8);

        [Serializable] private sealed class Steps { public CombatStepResult[] values; }

        [Serializable] private sealed class CheckReport
        {
            public int schemaVersion = 1;
            public string requiredUnityVersion = RequiredUnityVersion;
            public string unityVersion;
            public string platform;
            public bool batchMode;
            public string graphicsDevice;
            public string originalRoot;
            public string roundTripRoot;
            public int expectedConfigurationCount;
            public int passedConfigurationCount;
            public int comparedLogPairs;
            public bool passed;
            public CaseResult[] cases;
        }

        [Serializable] private sealed class CaseResult
        {
            public string file;
            public string kind;
            public string originalSha256 = "";
            public string roundTripSha256 = "";
            public bool passed;
            public string error = "";
            public LogPair[] logPairs = Array.Empty<LogPair>();
        }

        [Serializable] private sealed class LogPair
        {
            public string name;
            public bool equal;
            public string originalSha256;
            public string roundTripSha256;
            public int originalBytes;
            public int roundTripBytes;
            public int firstDifferentByte;
        }
    }
}
