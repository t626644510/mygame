import assert from 'node:assert/strict';
import { access, mkdir, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRecorded, sha256, writeJson } from '../../editor-verification/raw-evidence.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  if (!['--output', '--work', '--dotnet', '--cli', '--pwsh'].includes(key) || !process.argv[index + 1] || options.has(key)) throw new Error(`Invalid argument ${key}`);
  options.set(key, process.argv[index + 1]);
}
for (const key of ['--output', '--work', '--dotnet', '--cli', '--pwsh']) if (!options.has(key)) throw new Error(`Missing ${key}`);
const output = path.resolve(options.get('--output'));
const work = path.resolve(options.get('--work'));
for (const [directory, parent] of [[output, 'outputs'], [work, 'work']]) {
  const relative = path.relative(path.join(repository, parent), directory);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Use a new directory below repository ${parent}.`);
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory, { recursive: false });
}
const dotnet = await realpath(options.get('--dotnet'));
const cli = await realpath(options.get('--cli'));
const pwsh = await realpath(options.get('--pwsh'));
const commands = [];
let sequence = 0;
async function capture(name, executable, args, cwd = repository, timeoutMs = 120000) {
  const result = await runRecorded({ executable, args, cwd, prefix: path.join(output, `${String(++sequence).padStart(2, '0')}-${name}`), timeoutMs, env: { DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_CLI_UI_LANGUAGE: 'en', DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false' } });
  const { stdoutBytes, stderrBytes, ...receipt } = result;
  commands.push(receipt);
  process.stdout.write(stdoutBytes);
  process.stderr.write(stderrBytes);
  assert.equal(result.exitCode, 0, `${name} failed; retained raw output: ${receipt.stdout.path}`);
  return stdoutBytes.toString('utf8').trim();
}
async function npmCli() {
  const executableDirectory = path.dirname(process.execPath);
  const candidates = [path.join(executableDirectory, 'node_modules/npm/bin/npm-cli.js'), path.resolve(executableDirectory, '../lib/node_modules/npm/bin/npm-cli.js')];
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    candidates.push(path.join(directory, 'node_modules/npm/bin/npm-cli.js'));
    if (process.platform !== 'win32') {
      try { candidates.push(await realpath(path.join(directory, 'npm'))); } catch { /* A PATH entry need not contain npm. */ }
    }
  }
  for (const candidate of candidates) {
    if (path.basename(candidate) !== 'npm-cli.js') continue;
    try { await access(candidate); return candidate; } catch { /* Keep looking at the selected Node installation. */ }
  }
  throw new Error('Cannot find npm-cli.js for the selected Node installation.');
}
let failure = null;
let identity;
try {
  const actualHead = await capture('source-head', 'git', ['-c', `safe.directory=${repository.replaceAll('\\', '/')}`, 'rev-parse', 'HEAD']);
  const expectedHead = process.env.P0_EXPECTED_COMMIT || process.env.GITHUB_SHA || actualHead;
  assert.equal(actualHead, expectedHead, 'Actual checkout must equal the PR head, rather than a synthetic merge commit.');
  const sdk = await capture('sdk-version', dotnet, ['--version'], path.join(repository, 'tools/sim-cli'));
  assert.equal(sdk, '8.0.428');
  const npm = await npmCli();
  const npmVersion = await capture('npm-version', process.execPath, [npm, '--version']);
  const contract = path.join(repository, 'docs/editor/P1_API_CONTRACT.md');
  const sourceDirectory = path.join(repository, 'tools/sim-cli/src/MyGame.Sim.Cli');
  const sources = await Promise.all((await readdir(sourceDirectory)).filter(name => name.endsWith('.cs')).sort().map(async name => ({ path: `tools/sim-cli/src/MyGame.Sim.Cli/${name}`, sha256: sha256(await readFile(path.join(sourceDirectory, name))) })));
  identity = { actualHead, expectedHead, sdk, node: process.version, nodeExecutable: process.execPath, npmVersion, npmCli: npm, dotnet, cli, cliSha256: sha256(await readFile(cli)), platform: process.platform, architecture: process.arch, githubRunId: process.env.GITHUB_RUN_ID ?? '', contractSha256: sha256(await readFile(contract)), packageLockSha256: sha256(await readFile(path.join(repository, 'tools/editor-web/package-lock.json'))), sources };
  await writeJson(path.join(output, 'CI_IDENTITY.json'), identity);
  const frontend = path.join(repository, 'tools/editor-web');
  await capture('npm-ci', process.execPath, [npm, 'ci', '--cache', path.join(work, 'npm-cache')], frontend, 300000);
  await capture('frontend-build', process.execPath, [npm, 'run', 'build'], frontend);
  await capture('frontend-lint', process.execPath, [npm, 'run', 'lint'], frontend);
  await capture('backend-acceptance', process.execPath, [path.join(repository, 'tools/editor-verification/backend-checks.mjs'), '--dotnet', dotnet, '--cli', cli, '--pwsh', pwsh, '--output', path.join(output, 'backend'), '--work', path.join(work, 'backend'), '--port', '5186', '--ready-contract-sha', identity.contractSha256], repository, 300000);
} catch (error) {
  failure = { message: error.message, stack: error.stack };
  process.stderr.write(`${error.stack}\n`);
} finally {
  await writeJson(path.join(output, 'P1_CI_RESULT.json'), { passed: !failure, scope: 'Formal CLI build is retained by the preceding P0 regression step; P1 runs real CLI/HTTP backend checks and frontend build/lint. Browser and Unity acceptance remain separately scheduled local evidence.', identity: identity ?? null, commands, failure });
  process.exitCode = failure ? 1 : 0;
}
