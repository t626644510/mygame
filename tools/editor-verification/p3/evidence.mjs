import assert from 'node:assert/strict';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, runRecorded, verifySavedBytes, snapshotFiles, writeJson } from '../raw-evidence.mjs';

export { sha256, runRecorded, verifySavedBytes, snapshotFiles, writeJson };
export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const declaredBaseline = '37825dc90b2e8dacbd6f4fdf0d54534372ee9bce';
export const firstMealInput = 'Game/Assets/StreamingAssets/Prototype/BaseEconomy/default.json';
export const readJson = async file => JSON.parse(await readFile(file, 'utf8'));

export function options(args, required = []) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    assert.ok(args[index]?.startsWith('--') && args[index + 1] !== undefined, 'Use --name value pairs.');
    assert.ok(!Object.hasOwn(result, args[index]), 'Do not repeat options.');
    result[args[index]] = args[index + 1];
  }
  for (const name of required) assert.ok(result[name], `Missing ${name}`);
  return result;
}

export function isolatedPath(value, root) {
  const base = path.resolve(repository, root);
  const resolved = path.resolve(repository, value);
  const relative = path.relative(base, resolved);
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `Use a child of ${base}; got ${resolved}`);
  return resolved;
}

export async function freshDirectory(directory) {
  try { assert.equal((await readdir(directory)).length, 0, `Evidence already exists: ${directory}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(directory, { recursive: true });
}

export async function fileManifest(paths) {
  const rows = [];
  for (const relative of [...new Set(paths)].sort()) {
    const bytes = await readFile(path.join(repository, relative));
    rows.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
  }
  return rows;
}

export function compareBytes(expected, actual) {
  let offset = 0;
  while (offset < Math.min(expected.length, actual.length) && expected[offset] === actual[offset]) offset++;
  return { equal: expected.equals(actual), expected: { bytes: expected.length, sha256: sha256(expected) }, actual: { bytes: actual.length, sha256: sha256(actual) }, firstDifferenceByte: expected.equals(actual) ? null : offset };
}
