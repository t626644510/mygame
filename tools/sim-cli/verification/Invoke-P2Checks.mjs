import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRecorded, sha256, verifySavedBytes, writeJson } from '../../editor-verification/raw-evidence.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const required = ['--output', '--work', '--dotnet', '--cli', '--formal-evidence'];
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  assert(required.includes(name) && process.argv[index + 1] && !args.has(name), `Invalid argument ${name}`);
  args.set(name, process.argv[index + 1]);
}
for (const name of required) assert(args.has(name), `Missing ${name}`);
const output = path.resolve(args.get('--output'));
const work = path.resolve(args.get('--work'));
for (const [directory, parent] of [[output, 'outputs/helper_editor_p2/verification'], [work, 'work/p2_verification_20261116']]) {
  const relative = path.relative(path.join(repository, parent), directory);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `Use a new directory below ${parent}.`);
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory, { recursive: false });
}
const dotnet = await realpath(args.get('--dotnet'));
const cli = await realpath(args.get('--cli'));
const formalEvidence = await realpath(args.get('--formal-evidence'));
const commands = [];
let sequence = 0;
async function capture(name, executable, argv, cwd = repository, timeoutMs = 120000) {
  const result = await runRecorded({ executable, args: argv, cwd,
    prefix: path.join(output, 'commands', `${String(++sequence).padStart(2, '0')}-${name}`), timeoutMs,
    env: { DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_CLI_UI_LANGUAGE: 'en', DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false' } });
  await verifySavedBytes(result);
  const { stdoutBytes, stderrBytes, ...receipt } = result;
  commands.push(receipt);
  process.stdout.write(stdoutBytes); process.stderr.write(stderrBytes);
  assert.equal(result.timedOut, false, `${name} timed out; raw evidence retained.`);
  assert.equal(result.exitCode, 0, `${name} failed; raw evidence retained at ${receipt.stdout.path}`);
  return stdoutBytes.toString('utf8').trim();
}
async function sourceFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && !['bin', 'obj'].includes(entry.name)) result.push(...await sourceFiles(file));
    else if (entry.isFile() && /\.(cs|csproj)$/.test(entry.name)) {
      const bytes = await readFile(file);
      result.push({ path: path.relative(repository, file).replaceAll('\\', '/'), bytes: bytes.length, sha256: sha256(bytes) });
    }
  }
  return result.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}
let identity, acceptance, failure;
try {
  const actualHead = await capture('source-head', 'git', ['-c', `safe.directory=${repository.replaceAll('\\', '/')}`, 'rev-parse', 'HEAD']);
  const expectedHead = process.env.P0_EXPECTED_COMMIT || process.env.GITHUB_SHA || actualHead;
  assert.equal(actualHead, expectedHead, 'Actual checkout must equal the reviewed PR head, not a synthetic merge commit.');
  const sdk = await capture('sdk-version', dotnet, ['--version'], path.join(repository, 'tools/sim-cli'));
  assert.equal(sdk, '8.0.428');
  const node = await capture('node-version', process.execPath, ['--version']);
  assert.equal(node, 'v24.12.0');
  const contract = path.join(repository, 'docs/editor/P2_API_CONTRACT.md');
  const observer = path.join(repository, 'Game/Assets/Prototype/Combat/Runtime/CombatExpedition.cs');
  const observerSha256 = sha256(await readFile(observer));
  assert.equal(observerSha256, '71a6959abadc7aff53e4c66d6e5c8375ad170f70dfdb046d4602effb279d5314');
  const formalCommandFile = path.join(formalEvidence, 'formal-build.command.json');
  const formalCommand = JSON.parse(await readFile(formalCommandFile, 'utf8'));
  assert.equal(formalCommand.exitCode, 0); assert.equal(formalCommand.timedOut, false);
  const formalStreams = {};
  for (const stream of ['stdout', 'stderr']) {
    const file = path.join(formalEvidence, `formal-build.${stream}`);
    const bytes = await readFile(file);
    await copyFile(file, path.join(output, `formal-build.${stream}`));
    formalStreams[stream] = { file: `formal-build.${stream}`, bytes: bytes.length, sha256: sha256(bytes) };
  }
  const sourceDirectories = ['tools/sim-cli/src', 'Game/Assets/Prototype/Combat/Runtime', 'Game/Assets/Prototype/BaseEconomy/Runtime', 'Game/Assets/Prototype/Tactics/Runtime', 'Game/Assets/Prototype/Expedition/Runtime'];
  const sources = (await Promise.all(sourceDirectories.map(relative => sourceFiles(path.join(repository, relative))))).flat().sort((left, right) => left.path.localeCompare(right.path, 'en'));
  identity = { actualHead, expectedHead, sdk, node, platform: process.platform, architecture: process.arch,
    githubRunId: process.env.GITHUB_RUN_ID ?? '', dotnet, cli, cliSha256: sha256(await readFile(cli)),
    contract: { path: 'docs/editor/P2_API_CONTRACT.md', sha256: sha256(await readFile(contract)) }, observerSha256, sources };
  await writeJson(path.join(output, 'CI_IDENTITY.json'), identity);
  const productReceipt = path.join(output, 'PRODUCT_BUILD_RECEIPT.json');
  await writeJson(productReceipt, { identity, formalCommand, streams: formalStreams,
    formalEvidenceArtifact: 'sim-cli-p0 platform artifact from the preceding formal build step; includes its original binlog and project metadata.' });
  const oracleOutput = path.join(output, 'oracle');
  const oracleWork = path.join(work, 'oracle');
  await capture('oracle-build', process.execPath, [path.join(repository, 'tools/editor-verification/p2/build-oracle.mjs'),
    '--dotnet', dotnet, '--output', oracleOutput, '--work', oracleWork], repository, 180000);
  const cliOutput = path.join(output, 'cli');
  await capture('cli-contracts', process.execPath, [path.join(repository, 'tools/editor-verification/p2/cli-checks.mjs'),
    '--dotnet', dotnet, '--cli', cli, '--expected-cli-sha', identity.cliSha256,
    '--oracle-build', path.join(oracleOutput, 'ORACLE_BUILD.json'), '--contract-sha', identity.contract.sha256,
    '--output', cliOutput, '--work', path.join(work, 'cli'), '--only', 'C1,C2,C3',
    '--observer-source-sha', observerSha256, '--build-receipt', productReceipt], repository, 300000);
  acceptance = JSON.parse(await readFile(path.join(cliOutput, 'P2_CLI_ACCEPTANCE.json'), 'utf8'));
  assert.equal(acceptance.passed, true);
  for (const [prefix, count] of [['C1:', 17], ['C2:', 2], ['C3:', 4]]) {
    assert.equal(acceptance.checks.filter(check => check.id.startsWith(prefix) && check.status === 'Passed').length, count, `${prefix} exact selected check count differs.`);
  }
  assert.equal(sha256(await readFile(cli)), identity.cliSha256, 'Product assembly changed during CI.');
} catch (error) {
  failure = { message: error.message, stack: error.stack };
  process.stderr.write(`${error.stack}\n`);
} finally {
  await writeJson(path.join(output, 'P2_CI_RESULT.json'), { passed: !failure,
    scope: 'Only same-platform pure .NET/Node C1/C2/C3. The preceding P0 step builds formal projects; P1 retains frontend build/lint and backend regression. Local HTTP/UI/Unity evidence is separate, never implied by this result.',
    identity: identity ?? null, checks: acceptance?.checks ?? [], commands, failure });
  process.exitCode = failure ? 1 : 0;
}
