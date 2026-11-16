import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { compareTrees, findMetadataKeys, runtimeProjection } from './json-assertions.mjs';
import { sha256, snapshotFiles, writeJson } from './raw-evidence.mjs';

function options(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--items', '--source', '--unity-result', '--output'].includes(args[index]) || !args[index + 1] || Object.hasOwn(result, args[index])) throw new Error('Expected --items FILE --source CONTENT_ROOT --unity-result DIR --output NEW_DIR');
    result[args[index]] = path.resolve(args[index + 1]);
  }
  for (const key of ['--items', '--source', '--unity-result', '--output']) if (!result[key]) throw new Error(`Missing ${key}`);
  return result;
}

const args = options(process.argv.slice(2));
const inputBytes = await readFile(args['--items']);
const reportBytes = await readFile(path.join(args['--unity-result'], 'P1_UNITY_READBACK.json'));
const unityReport = JSON.parse(reportBytes.toString('utf8'));
const readbackBytes = await readFile(path.join(args['--unity-result'], 'items.unity-readback.json'));
const original = JSON.parse(inputBytes.toString('utf8'));
const readback = JSON.parse(readbackBytes.toString('utf8'));
const itemsPath = path.join(args['--source'], 'items');
const source = [];
for (const file of (await readdir(itemsPath)).filter(file => file.endsWith('.json')).sort()) source.push(JSON.parse(await readFile(path.join(itemsPath, file), 'utf8')));
const expected = runtimeProjection(source);
const differences = [
  ...compareTrees(expected, original).map(issue => ({ comparison: 'source-projection-to-export', ...issue })),
  ...compareTrees(original, readback).map(issue => ({ comparison: 'export-to-real-JsonUtility-readback', ...issue })),
];
for (const [field, expectedValue] of Object.entries({ readCompleted: true, unityVersion: '6000.3.28f1', platform: 'WindowsEditor', batchMode: true, graphicsDevice: 'Null', inputSha256: sha256(inputBytes), readbackSha256: sha256(readbackBytes), itemCount: original.items.length })) {
  if (unityReport[field] !== expectedValue) differences.push({ comparison: 'Unity-report-provenance', pointer: `/${field}`, expected: expectedValue, actual: unityReport[field] });
}
for (const pointer of findMetadataKeys(original)) differences.push({ comparison: 'runtime-metadata-exclusion', pointer });
const summary = {
  schemaVersion: 1,
  passed: differences.length === 0,
  scope: 'Actual Windows Unity JsonUtility readback, every exported key/value/array entry and independent source projection',
  itemsInput: { path: args['--items'], sha256: sha256(inputBytes) },
  sourceRoot: args['--source'],
  sourceSnapshot: await snapshotFiles(args['--source']),
  unityReport: { path: path.join(args['--unity-result'], 'P1_UNITY_READBACK.json'), sha256: sha256(reportBytes), ...unityReport },
  readback: { path: path.join(args['--unity-result'], 'items.unity-readback.json'), sha256: sha256(readbackBytes) },
  differences,
};
await mkdir(args['--output'], { recursive: false });
await writeJson(path.join(args['--output'], 'EXPECTED_SOURCE_PROJECTION.json'), expected);
await writeJson(path.join(args['--output'], 'B8_FULL_FIELD_COMPARISON.json'), summary);
process.stdout.write(`${JSON.stringify({ passed: summary.passed, itemCount: original.items.length, differences: differences.length, evidence: args['--output'] })}\n`);
process.exitCode = summary.passed ? 0 : 1;
