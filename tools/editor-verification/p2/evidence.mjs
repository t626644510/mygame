import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, runRecorded, verifySavedBytes, snapshotFiles, writeJson } from '../raw-evidence.mjs';
import { originalDirectory, singleInputs, linkedInputs, declaredBaseline } from './inputs.mjs';

export { sha256, runRecorded, verifySavedBytes, snapshotFiles, writeJson };
export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const readJson = async file => JSON.parse(await readFile(file, 'utf8'));

export function isolatedPath(value, root) {
  const base = path.resolve(repository, root);
  const resolved = path.resolve(repository, value);
  const relative = path.relative(base, resolved);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `Use a new child of ${base}; got ${resolved}`);
  return resolved;
}

export function options(args, required) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    assert.ok(args[index]?.startsWith('--') && args[index + 1] !== undefined, 'Use --name value pairs.');
    assert.ok(!Object.hasOwn(result, args[index]), 'Do not repeat options.');
    result[args[index]] = args[index + 1];
  }
  for (const name of required) assert.ok(result[name], `Missing ${name}`);
  return result;
}

export async function freshDirectory(directory) {
  try { assert.equal((await readdir(directory)).length, 0, `Evidence already exists: ${directory}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(directory, { recursive: true });
}

export async function sourceSnapshot(extra = []) {
  const files = new Map();
  for (const root of ['Game/Assets/Prototype', 'Game/Assets/StreamingAssets/Prototype']) {
    for (const file of await snapshotFiles(path.join(repository, root))) files.set(`${root}/${file.path}`, { ...file, path: `${root}/${file.path}` });
  }
  for (const relative of extra) {
    const bytes = await readFile(path.join(repository, relative));
    files.set(relative, { path: relative, bytes: bytes.length, sha256: sha256(bytes) });
  }
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

// This is a local physical-byte snapshot. Git blob provenance is supplied independently by the Git owner.
export async function captureInputs(destination) {
  await freshDirectory(destination);
  const inputs = [];
  for (const file of [...singleInputs, ...linkedInputs]) {
    const source = path.join(repository, originalDirectory, file);
    const bytes = await readFile(source);
    const value = JSON.parse(bytes.toString('utf8'));
    await writeFile(path.join(destination, file), bytes, { flag: 'wx' });
    const text = bytes.toString('utf8');
    inputs.push({
      source: `${originalDirectory}/${file}`, file, bytes: bytes.length, sha256: sha256(bytes),
      kind: linkedInputs.includes(file) ? 'expedition' : 'scenario', runtimeId: value.id,
      scenarioBudget: { maxEvents: Object.hasOwn(value, 'maxEvents') ? value.maxEvents : { missing: true }, maxWait: Object.hasOwn(value, 'maxWait') ? value.maxWait : { missing: true } },
      eol: { crlf: (text.match(/\r\n/g) ?? []).length, bareLf: (text.match(/(?<!\r)\n/g) ?? []).length },
      linkedStages: value.encounters?.map((stage, index) => ({ index: index + 1, encounterId: stage.id, scenarioId: stage.scenario.id, waitBefore: stage.waitBefore })),
      gitBlob: { status: 'PendingIndependentOwnerProvenance', sha256: null },
    });
  }
  await writeJson(path.join(destination, 'INPUT_MANIFEST.json'), { schemaVersion: 1, declaredBaseline, interpretation: 'Raw physical bytes on this platform, never asserted equal to a Git blob or old Windows raw on another OS.', inputs });
  return inputs;
}

export function compareLogBytes(expected, actual) {
  let offset = 0;
  while (offset < Math.min(expected.length, actual.length) && expected[offset] === actual[offset]) offset++;
  return { equal: expected.equals(actual), expected: { bytes: expected.length, sha256: sha256(expected) }, actual: { bytes: actual.length, sha256: sha256(actual) }, firstDifferenceByte: expected.equals(actual) ? null : offset };
}
