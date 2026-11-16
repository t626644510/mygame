import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRecorded, sha256, snapshotFiles, verifySavedBytes, writeJson } from './raw-evidence.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)); const repository = path.resolve(here, '../..'); const frontend = path.join(repository, 'tools/editor-web');
const options = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, index) => process.argv.slice(2 + index * 2, 4 + index * 2)));
for (const key of ['--output', '--work', '--frontend-manifest']) if (!options[key]) throw new Error(`Missing ${key}`);
const output = path.resolve(options['--output']); const work = path.resolve(options['--work']);
if (!output.startsWith(`${path.join(repository, 'outputs')}${path.sep}`) || !work.startsWith(`${path.join(repository, 'work')}${path.sep}`)) throw new Error('Use isolated workspace work/outputs paths.');
await mkdir(output, { recursive: false }); await mkdir(work, { recursive: false });
const manifestPath = path.resolve(options['--frontend-manifest']); const manifestBytes = await readFile(manifestPath); const manifest = JSON.parse(manifestBytes.toString('utf8'));
async function sourceSnapshot() { return Promise.all(manifest.files.map(async file => ({ path: file.path, sha256: sha256(await readFile(path.join(repository, file.path))) }))); }
const before = await sourceSnapshot(); for (let index = 0; index < before.length; index++) assert.equal(before[index].sha256, manifest.files[index].sha256, `Frozen frontend mismatch ${before[index].path}`);
const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'); const commands = [];
async function recorded(name, executable, args, cwd = frontend) {
  const result = await runRecorded({ executable, args, cwd, prefix: path.join(output, name), timeoutMs: 180000, env: { NPM_CONFIG_CACHE: path.join(work, 'npm-cache'), NPM_CONFIG_UPDATE_NOTIFIER: 'false', NPM_CONFIG_AUDIT: 'false', NPM_CONFIG_FUND: 'false' } });
  await verifySavedBytes(result); const { stdoutBytes, stderrBytes, ...receipt } = result; commands.push({ name, ...receipt }); return result;
}
await recorded('node-version', process.execPath, ['--version']); await recorded('npm-version', process.execPath, [npmCli, '--version']);
const git = await recorded('actual-checkout-head', 'git', ['-c', `safe.directory=${repository.replaceAll('\\', '/')}`, 'rev-parse', 'HEAD'], repository);
const results = await Promise.allSettled([recorded('frontend-build', process.execPath, [npmCli, 'run', 'build']), recorded('frontend-lint', process.execPath, [npmCli, 'run', 'lint'])]);
const after = await sourceSnapshot(); const differences = before.filter((file, index) => file.sha256 !== after[index].sha256).map(file => file.path);
const summary = { schemaVersion: 1, passed: results.every(result => result.status === 'fulfilled' && result.value.exitCode === 0 && !result.value.timedOut) && differences.length === 0, scope: 'Independent final B13 build/lint on frozen product source; no browser, Unity, backend suite, install, Git write, or publication.', actualHead: git.stdoutBytes.toString('utf8').trim(), verifierSourceSha256: sha256(await readFile(fileURLToPath(import.meta.url))), frontendManifest: { path: manifestPath, sha256: sha256(manifestBytes), canonicalSourceHash: manifest.canonicalSourceHash ?? manifest.sourceHash, canonicalProductFileCount: manifest.canonicalUniquePaths ?? null, entryCount: manifest.files.length, uniqueFileCount: new Set(manifest.files.map(file => file.path)).size }, packageLockSha256: sha256(await readFile(path.join(frontend, 'package-lock.json'))), sourceBefore: before, sourceAfter: after, sourceDifferences: differences, commands, unexpectedErrors: results.filter(result => result.status === 'rejected').map(result => String(result.reason)), buildOutputs: await snapshotFiles(path.join(frontend, 'dist')) };
await writeJson(path.join(output, 'B13_BUILD_LINT.json'), summary);
process.stdout.write(`${JSON.stringify({ passed: summary.passed, actualHead: summary.actualHead, canonicalSourceHash: summary.frontendManifest.canonicalSourceHash, sourceDifferences: differences, evidence: output })}\n`); process.exitCode = summary.passed ? 0 : 1;
