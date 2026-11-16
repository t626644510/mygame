using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Prototype.Editor.SimCliRoundTrip
{
    /// <summary>
    /// B8 transport evidence only. Independent Node checks compare this complete
    /// JsonUtility readback against the actual exported JSON and source projection.
    /// Never creates or starts a Player or reads a window/accessibility tree.
    /// </summary>
    public static class P1ItemExportCheck
    {
        private const string RequiredUnityVersion = "6000.3.28f1";
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);

        // -batchmode -nographics -quit -executeMethod
        // Prototype.Editor.SimCliRoundTrip.P1ItemExportCheck.Run
        // -p1FormalItemsInput <Game StreamingAssets/Content/items.json>
        // -p1ItemsInput <probe items.json> -p1ItemsOutput <new outputs directory>
        public static void Run()
        {
            // An accidental interactive call must not run or close an Editor.
            if (!Application.isBatchMode)
                throw new InvalidOperationException("B8 requires a noninteractive batchmode process.");

            int exitCode = 1;
            string outputRoot = null;
            bool ownsOutput = false;
            try
            {
                if (Application.platform != RuntimePlatform.WindowsEditor ||
                    Application.unityVersion != RequiredUnityVersion ||
                    SystemInfo.graphicsDeviceType != GraphicsDeviceType.Null)
                    throw new InvalidOperationException("B8 requires Windows Unity " + RequiredUnityVersion +
                        " with -batchmode -nographics and a Null graphics device.");

                string repository = Directory.GetParent(Directory.GetParent(Application.dataPath).FullName).FullName;
                string inputPath = ReadPathArgument("-p1ItemsInput");
                string formalInput = ReadPathArgument("-p1FormalItemsInput");
                string expectedFormal = Path.GetFullPath(Path.Combine(Application.streamingAssetsPath, "Content", "items.json"));
                if (!string.Equals(formalInput, expectedFormal, StringComparison.OrdinalIgnoreCase))
                    throw new ArgumentException("Primary B8 input must be the actual Game StreamingAssets/Content/items.json.");
                outputRoot = ReadPathArgument("-p1ItemsOutput");
                if (!Within(inputPath, repository) || !Within(outputRoot, Path.Combine(repository, "outputs")))
                    throw new ArgumentException("B8 input must be in the repository and output below its outputs directory.");
                if (!string.Equals(Path.GetFileName(inputPath), "items.json", StringComparison.Ordinal))
                    throw new ArgumentException("B8 input must be the exported items.json file.");
                if (Within(inputPath, outputRoot) || Within(formalInput, outputRoot) || Directory.Exists(outputRoot) || File.Exists(outputRoot))
                    throw new IOException("B8 output must be new and separate from its input: " + outputRoot);

                Directory.CreateDirectory(outputRoot);
                ownsOutput = true;
                ReadReport formal = ReadExport(formalInput, Path.Combine(outputRoot, "formal"), "formal");
                ReadReport probe = ReadExport(inputPath, Path.Combine(outputRoot, "probe"), "probe");
                var report = new DualReadReport
                {
                    schemaVersion = 1,
                    readCompleted = true,
                    unityVersion = Application.unityVersion,
                    platform = Application.platform.ToString(),
                    batchMode = Application.isBatchMode,
                    graphicsDevice = SystemInfo.graphicsDeviceType.ToString(),
                    processId = System.Diagnostics.Process.GetCurrentProcess().Id,
                    streamingAssetsPath = Application.streamingAssetsPath,
                    cases = new[] { formal, probe }
                };
                File.WriteAllBytes(Path.Combine(outputRoot, "P1_UNITY_DUAL_READBACK.json"),
                    Utf8.GetBytes(JsonUtility.ToJson(report, true) + "\n"));
                Debug.Log("[P1ItemExportCheck] One-process dual JsonUtility read completed; formal=" + formal.itemCount +
                    ", probe=" + probe.itemCount + "; independent semantic comparisons still required; output=" + outputRoot);
                exitCode = 0;
            }
            catch (Exception exception)
            {
                Debug.LogException(exception);
                if (ownsOutput)
                    File.WriteAllBytes(Path.Combine(outputRoot, "P1_UNITY_READBACK_ERROR.txt"), Utf8.GetBytes(exception.ToString()));
            }
            finally
            {
                EditorApplication.Exit(exitCode);
            }
        }

        private static ReadReport ReadExport(string inputPath, string outputRoot, string caseName)
        {
            byte[] inputBytes = File.ReadAllBytes(inputPath);
            ItemExport loaded = JsonUtility.FromJson<ItemExport>(Utf8.GetString(inputBytes));
            if (loaded == null || loaded.schemaVersion != 1 || loaded.items == null || loaded.items.Length == 0)
                throw new InvalidDataException("B8 requires schemaVersion 1 and a nonempty items array: " + caseName);
            AssertNonNullFields(loaded, "");
            Directory.CreateDirectory(outputRoot);
            string readbackPath = Path.Combine(outputRoot, "items.unity-readback.json");
            byte[] readbackBytes = Utf8.GetBytes(JsonUtility.ToJson(loaded, true) + "\n");
            File.WriteAllBytes(readbackPath, readbackBytes);
            var report = new ReadReport
            {
                schemaVersion = 1, caseName = caseName, readCompleted = true,
                semanticComparison = "pending independent full-key and source-projection checks",
                unityVersion = Application.unityVersion, platform = Application.platform.ToString(),
                batchMode = Application.isBatchMode, graphicsDevice = SystemInfo.graphicsDeviceType.ToString(),
                processId = System.Diagnostics.Process.GetCurrentProcess().Id,
                inputPath = inputPath, inputSha256 = Hash(inputBytes), readbackPath = readbackPath,
                readbackSha256 = Hash(readbackBytes), itemCount = loaded.items.Length,
                declaredFields = DescribeFields(typeof(ItemExport), "").ToArray()
            };
            File.WriteAllBytes(Path.Combine(outputRoot, "P1_UNITY_READBACK.json"), Utf8.GetBytes(JsonUtility.ToJson(report, true) + "\n"));
            return report;
        }

        private static string ReadPathArgument(string option)
        {
            string[] args = Environment.GetCommandLineArgs();
            int index = Array.IndexOf(args, option);
            if (index < 0 || index + 1 >= args.Length || !Path.IsPathRooted(args[index + 1]))
                throw new ArgumentException(option + " requires an absolute path.");
            return Path.GetFullPath(args[index + 1]).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        }

        private static bool Within(string candidate, string root)
        {
            string prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            return Path.GetFullPath(candidate).StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
        }

        private static string Hash(byte[] bytes)
        {
            using (SHA256 hash = SHA256.Create())
                return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        }

        private static void AssertNonNullFields(object value, string pointer)
        {
            if (value == null) throw new InvalidDataException("JsonUtility returned null at " + pointer);
            Type type = value.GetType();
            if (type.IsPrimitive || type == typeof(string)) return;
            Array array = value as Array;
            if (array != null)
            {
                for (int index = 0; index < array.Length; index++) AssertNonNullFields(array.GetValue(index), pointer + "/" + index);
                return;
            }
            foreach (FieldInfo field in type.GetFields(BindingFlags.Public | BindingFlags.Instance))
                AssertNonNullFields(field.GetValue(value), pointer + "/" + field.Name);
        }

        private static List<string> DescribeFields(Type type, string pointer)
        {
            var fields = new List<string>();
            foreach (FieldInfo field in type.GetFields(BindingFlags.Public | BindingFlags.Instance))
            {
                string location = pointer + "/" + field.Name;
                fields.Add(location + ":" + field.FieldType.FullName);
                Type nested = field.FieldType.IsArray ? field.FieldType.GetElementType() : field.FieldType;
                if (!nested.IsPrimitive && nested != typeof(string)) fields.AddRange(DescribeFields(nested, location + (field.FieldType.IsArray ? "/*" : "")));
            }
            return fields;
        }

        [Serializable] public sealed class ItemExport { public int schemaVersion; public Item[] items; }
        [Serializable] public sealed class Item
        {
            public int schemaVersion;
            public string id;
            public string[] aliases;
            public string name;
            public string category;
            public string description;
            public string icon;
            public int stackLimit;
            public int baseValue;
            public string[] tags;
            public Equipment equipment;
            public Consumable consumable;
        }
        [Serializable] public sealed class Equipment { public string slot; public CombatBonus[] combatBonus; public Enhancement[] enhancement; }
        [Serializable] public sealed class CombatBonus { public string id; public int value; }
        [Serializable] public sealed class Enhancement { public int level; public int cash; public int attackBonusDelta; public Material[] materials; }
        [Serializable] public sealed class Material { public string itemId; public int quantity; }
        [Serializable] public sealed class Consumable { public Effect[] effects; }
        [Serializable] public sealed class Effect { public string kind; public string note; }
        [Serializable] private sealed class ReadReport
        {
            public int schemaVersion;
            public string caseName;
            public bool readCompleted;
            public string semanticComparison;
            public string unityVersion;
            public string platform;
            public bool batchMode;
            public string graphicsDevice;
            public int processId;
            public string inputPath;
            public string inputSha256;
            public string readbackPath;
            public string readbackSha256;
            public int itemCount;
            public string[] declaredFields;
        }
        [Serializable] private sealed class DualReadReport
        {
            public int schemaVersion;
            public bool readCompleted;
            public string unityVersion;
            public string platform;
            public bool batchMode;
            public string graphicsDevice;
            public int processId;
            public string streamingAssetsPath;
            public ReadReport[] cases;
        }
    }
}
