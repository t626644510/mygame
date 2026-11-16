import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareTrees } from './json-assertions.mjs';
import { runRecorded, sha256, verifySavedBytes, writeJson } from './raw-evidence.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const options = {};
for (let index = 2; index < process.argv.length; index += 2) { const key = process.argv[index]; if (!['--formal-items', '--formal-source', '--probe-items', '--probe-source', '--unity-result', '--output'].includes(key) || !process.argv[index + 1]) throw new Error(`Invalid argument ${key}`); options[key] = path.resolve(process.argv[index + 1]); }
for (const key of ['--formal-items', '--formal-source', '--probe-items', '--probe-source', '--unity-result', '--output']) if (!options[key]) throw new Error(`Missing ${key}`);
await mkdir(options['--output'], { recursive: false });
const dual = JSON.parse(await readFile(path.join(options['--unity-result'], 'P1_UNITY_DUAL_READBACK.json'), 'utf8'));
const pathIdentity = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
assert.equal(dual.readCompleted, true); assert.equal(dual.cases.length, 2); assert.equal(pathIdentity(path.resolve(dual.streamingAssetsPath, 'Content/items.json')), pathIdentity(options['--formal-items']));
const commands = [];
for (const name of ['formal', 'probe']) {
  const info = dual.cases.find(value => value.caseName === name); assert.ok(info); assert.equal(info.processId, dual.processId); assert.equal(info.inputSha256, sha256(await readFile(options[`--${name}-items`])));
  const receipt = await runRecorded({ executable: process.execPath, args: [path.join(here, 'compare-unity-readback.mjs'), '--items', options[`--${name}-items`], '--source', options[`--${name}-source`], '--unity-result', path.join(options['--unity-result'], name), '--output', path.join(options['--output'], name)], cwd: path.resolve(here, '../..'), prefix: path.join(options['--output'], 'commands', name), timeoutMs: 30000 });
  await verifySavedBytes(receipt); const { stdoutBytes, stderrBytes, ...saved } = receipt; commands.push(saved);
}
const formal = JSON.parse(await readFile(options['--formal-items'], 'utf8')); const probe = JSON.parse(await readFile(options['--probe-items'], 'utf8'));
const sourceBridge = [];
for (const item of formal.items) {
  assert.match(item.id, /^[a-z][a-z0-9_]*$/); const formalPath = path.join(options['--formal-source'], 'items', `${item.id}.json`); const probePath = path.join(options['--probe-source'], 'items', `${item.id}.json`);
  const formalSourceSha256 = sha256(await readFile(formalPath)); const probeSourceSha256 = sha256(await readFile(probePath));
  sourceBridge.push({ id: item.id, formalPath, probePath, formalSourceSha256, probeSourceSha256, sourceBytesEqual: formalSourceSha256 === probeSourceSha256 });
}
const formalIds = new Set(formal.items.map(item => item.id)); const subset = { schemaVersion: probe.schemaVersion, items: probe.items.filter(item => formalIds.has(item.id)) };
const bridgeDifferences = compareTrees(formal, subset);
const summary = { schemaVersion: 1, passed: commands.every(command => command.exitCode === 0 && !command.timedOut) && sourceBridge.every(row => row.sourceBytesEqual) && bridgeDifferences.length === 0, scope: 'One actual Unity process read formal Game export and independent probes; two full-key/source-projection comparisons plus exact formal-source/probe-source bridge.', processId: dual.processId, formalItems: { path: options['--formal-items'], sha256: sha256(await readFile(options['--formal-items'])), count: formal.items.length }, probeItems: { path: options['--probe-items'], sha256: sha256(await readFile(options['--probe-items'])), count: probe.items.length }, commands, sourceBridge, bridgeDifferences };
await writeJson(path.join(options['--output'], 'B8_FORMAL_AND_PROBE_COMPARISON.json'), summary);
process.stdout.write(`${JSON.stringify({ passed: summary.passed, formalCount: formal.items.length, probeCount: probe.items.length, sameUnityPid: dual.processId, evidence: options['--output'] })}\n`);
process.exitCode = summary.passed ? 0 : 1;
