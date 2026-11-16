import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRecorded, sha256, verifySavedBytes, writeJson } from './raw-evidence.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const options = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, index) => process.argv.slice(2 + index * 2, 4 + index * 2)));
if (!options['--output']) throw new Error('Expected --output NEW_DIRECTORY');
const output = path.resolve(options['--output']);
if (!output.startsWith(`${path.join(repository, 'outputs')}${path.sep}`)) throw new Error('Static evidence must remain below repository outputs.');
await mkdir(output, { recursive: false });
const unityData = 'E:/Unity/Editors/6000.3.28f1/Editor/Data';
const host = path.join(unityData, 'NetCoreRuntime/dotnet.exe');
const compiler = path.join(unityData, 'DotNetSdkRoslyn/csc.dll');
const originalRsp = path.join(repository, 'outputs/p0_20261116/unity_static/compile02.rsp');
const inventoryBytes = await readFile(originalRsp);
const moduleNames = new Set(['UnityEditor.CoreModule.dll', 'UnityEngine.CoreModule.dll', 'UnityEngine.JSONSerializeModule.dll']);
const references = [...new Set(inventoryBytes.toString('utf8').split(/\r?\n/).map(line => /^-r:"(.+)"$/.exec(line)?.[1]).filter(Boolean).filter(file => file.replaceAll('\\', '/').includes('/UnityReferenceAssemblies/') || moduleNames.has(path.basename(file))))];
for (const module of moduleNames) if (!references.some(file => path.basename(file) === module)) throw new Error(`Missing installed Unity reference: ${module}`);
const source = path.join(repository, 'Game/Assets/Prototype/Editor/SimCliRoundTrip/P1ItemExportCheck.cs');
const dll = path.join(output, 'P1ItemExportCheck.StaticSignature.dll');
const rsp = path.join(output, 'p1-signature.rsp');
await writeFile(rsp, ['-target:library', '-nostdlib+', '-langversion:9.0', '-warn:4', '-warnaserror+', '-nowarn:0649', `-out:"${dll}"`, ...references.map(file => `-r:"${file}"`), `"${source}"`, ''].join('\n'));
const receipt = await runRecorded({ executable: host, args: [compiler, '-noconfig', `@${rsp}`], cwd: path.join(repository, 'Game'), prefix: path.join(output, 'real-unity-api-csc'), timeoutMs: 60000 });
await verifySavedBytes(receipt);
const { stdoutBytes, stderrBytes, ...command } = receipt;
const summary = {
  schemaVersion: 1,
  passed: receipt.exitCode === 0 && !receipt.timedOut,
  scope: 'Pure Roslyn signature compilation against installed Unity 6000.3.28f1 Engine/Editor/reference assemblies. No Unity Editor process or B8 execution.',
  host: { path: host, sha256: sha256(await readFile(host)) },
  compiler: { path: compiler, sha256: sha256(await readFile(compiler)) },
  source: { path: source, sha256: sha256(await readFile(source)) },
  reusedReferenceInventory: { path: originalRsp, sha256: sha256(inventoryBytes), onlyReferenceLinesRead: true },
  references: await Promise.all(references.map(async file => ({ path: file, sha256: sha256(await readFile(file)) }))),
  command,
};
await writeJson(path.join(output, 'UNITY_REAL_API_STATIC.json'), summary);
process.stdout.write(`${JSON.stringify({ passed: summary.passed, references: references.length, scope: summary.scope, evidence: output })}\n`);
process.exitCode = summary.passed ? 0 : 1;
