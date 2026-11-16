import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareTrees } from './json-assertions.mjs';
import { runRecorded, sha256, verifySavedBytes, writeJson } from './raw-evidence.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '../..');
const args = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, index) => process.argv.slice(2 + index * 2, 4 + index * 2)));
if (!args['--output'] || !args['--work'] || !args['--pwsh'] || !args['--dotnet']) throw new Error('Expected --output NEW_DIR --work NEW_DIR --pwsh EXE --dotnet EXE');
const output = path.resolve(args['--output']);
const work = path.resolve(args['--work']);
for (const candidate of [output, work]) if (!candidate.startsWith(`${repository}${path.sep}`)) throw new Error('Static-check paths must remain in this workspace.');
await mkdir(output, { recursive: false });
await mkdir(work, { recursive: false });
const receipts = [];
const checks = [];
async function run(name, executable, argumentsList, cwd = repository) {
  const receipt = await runRecorded({ executable, args: argumentsList, cwd, prefix: path.join(output, name), timeoutMs: 120000, env: { DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', DOTNET_CLI_HOME: path.join(work, 'dotnet-home') } });
  await verifySavedBytes(receipt);
  const { stdoutBytes, stderrBytes, ...saved } = receipt;
  receipts.push(saved);
  checks.push({ name, passed: receipt.exitCode === 0 && !receipt.timedOut });
  return receipt;
}

const launcher = path.join(here, 'Run-P1UnityItemCheck.ps1');
const psLiteral = `'${launcher.replaceAll("'", "''")}'`;
const parseCommand = `$parseErrors=$null;$tokens=$null;[void][Management.Automation.Language.Parser]::ParseFile(${psLiteral},[ref]$tokens,[ref]$parseErrors);if($parseErrors.Count){$parseErrors|Format-List;exit 1};Write-Output 'PowerShell syntax valid; launcher was not executed.'`;
await run('powershell-parser', args['--pwsh'], ['-NoProfile', '-Command', parseCommand]);
for (const file of ['raw-evidence.mjs', 'capture-selfcheck.mjs', 'json-assertions.mjs', 'compare-unity-readback.mjs', 'compare-dual-unity.mjs', 'static-checks.mjs']) await run(`node-check-${file}`, process.execPath, ['--check', path.join(here, file)]);

const expected = { aliases: ['legacy-one'], equipment: { enhancement: [{ level: 1, materials: [{ itemId: 'ore', quantity: 3 }] }] } };
assert.equal(compareTrees(expected, structuredClone(expected)).length, 0);
const damaged = structuredClone(expected);
delete damaged.aliases;
damaged.equipment.enhancement[0].materials[0].quantity = '3';
damaged.draft = false;
const differences = compareTrees(expected, damaged);
assert.deepEqual(differences.map(entry => entry.pointer).sort(), ['/aliases', '/draft', '/equipment/enhancement/0/materials/0/quantity']);
assert.deepEqual(new Set(differences.map(entry => entry.issue)), new Set(['missing-key', 'unexpected-key', 'type']));
assert.equal(compareTrees([1, 2], [1]).at(0).issue, 'array-length');
checks.push({ name: 'full-key-comparator-adversarial-selfcheck', passed: true, differences });

const sourcePath = path.join(repository, 'Game/Assets/Prototype/Editor/SimCliRoundTrip/P1ItemExportCheck.cs');
const escapedSource = sourcePath.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
await writeFile(path.join(work, 'global.json'), '{"sdk":{"version":"8.0.428","rollForward":"disable"}}\n');
await writeFile(path.join(work, 'StaticSyntax.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework><LangVersion>9.0</LangVersion><ImplicitUsings>disable</ImplicitUsings><Nullable>disable</Nullable><EnableDefaultCompileItems>false</EnableDefaultCompileItems><TreatWarningsAsErrors>true</TreatWarningsAsErrors><NoWarn>CS0649</NoWarn></PropertyGroup><ItemGroup><Compile Include="${escapedSource}" Link="P1ItemExportCheck.cs"/><Compile Include="UnitySyntaxStubs.cs"/></ItemGroup></Project>\n`);
await writeFile(path.join(work, 'UnitySyntaxStubs.cs'), `using System;
namespace UnityEngine {
 public enum RuntimePlatform { WindowsEditor }
 public static class Application { public static bool isBatchMode => throw new NotSupportedException(); public static string unityVersion => throw new NotSupportedException(); public static RuntimePlatform platform => throw new NotSupportedException(); public static string dataPath => throw new NotSupportedException(); public static string streamingAssetsPath => throw new NotSupportedException(); }
 public static class SystemInfo { public static Rendering.GraphicsDeviceType graphicsDeviceType => throw new NotSupportedException(); }
 public static class JsonUtility { public static T FromJson<T>(string json) => throw new NotSupportedException(); public static string ToJson(object value, bool prettyPrint) => throw new NotSupportedException(); }
 public static class Debug { public static void Log(object message) => throw new NotSupportedException(); public static void LogException(Exception error) => throw new NotSupportedException(); }
}
namespace UnityEngine.Rendering { public enum GraphicsDeviceType { Null } }
namespace UnityEditor { public static class EditorApplication { public static void Exit(int code) => throw new NotSupportedException(); } }
`);
await run('pinned-sdk', args['--dotnet'], ['--version'], work);
await run('csharp-syntax-only-with-throwing-unity-stubs', args['--dotnet'], ['build', 'StaticSyntax.csproj', '-c', 'Release', '-warnaserror', '-m:1'], work);
const summary = { schemaVersion: 1, passed: checks.every(check => check.passed), scope: 'Static syntax and evidence/comparator support only. Unity stubs always throw; no Unity, product, or B8 acceptance was executed.', editorSource: { path: sourcePath, sha256: sha256(await readFile(sourcePath)) }, checks, commands: receipts };
await writeJson(path.join(output, 'STATIC_CHECKS.json'), summary);
process.stdout.write(`${JSON.stringify({ passed: summary.passed, checks: checks.length, scope: summary.scope, evidence: output })}\n`);
process.exitCode = summary.passed ? 0 : 1;
