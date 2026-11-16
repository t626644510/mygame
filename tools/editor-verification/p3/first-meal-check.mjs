import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { repository, declaredBaseline, firstMealInput, options, isolatedPath, freshDirectory, fileManifest, runRecorded, verifySavedBytes, readJson, writeJson, sha256 } from './evidence.mjs';

const args = options(process.argv.slice(2), ['--dotnet', '--output', '--work']);
const output = isolatedPath(args['--output'], 'outputs/helper_editor_p3/verification');
const work = isolatedPath(args['--work'], 'work/p3_verification_20261117');
await freshDirectory(output);
await freshDirectory(work);
const sources = [firstMealInput, 'tools/editor-verification/raw-evidence.mjs',
  'tools/editor-verification/p3/evidence.mjs', 'tools/editor-verification/p3/first-meal-check.mjs',
  'tools/editor-verification/p3/base-oracle/P3.BaseOracle.csproj', 'tools/editor-verification/p3/base-oracle/Program.cs',
  'tools/sim-cli/src/MyGame.Sim.Cli/UnityJson.cs',
  ...['BaseScenario.cs', 'BaseSession.cs', 'BaseSnapshot.cs'].map(file => `Game/Assets/Prototype/BaseEconomy/Runtime/${file}`)];
const before = await fileManifest(sources);
const commands = [];
let failure = null;
let assembly = null;
let result = null;
const dotnet = path.resolve(args['--dotnet']);
const cwd = path.join(repository, 'tools/sim-cli');
const env = { DOTNET_CLI_HOME: path.join(work, 'dotnet-home'), DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' };
async function command(name, values, timeoutMs = 180000) {
  const receipt = await runRecorded({ executable: dotnet, args: values, cwd, prefix: path.join(output, name), timeoutMs, env });
  await verifySavedBytes(receipt);
  commands.push(receipt);
  assert.equal(receipt.exitCode, 0, `${name} failed; preserve its raw streams before classifying the cause.`);
  return receipt;
}
try {
  const version = await command('sdk-version', ['--version']);
  assert.equal(version.stdoutBytes.toString('utf8').trim(), '8.0.428');
  await command('oracle-build', ['build', path.join(repository, 'tools/editor-verification/p3/base-oracle/P3.BaseOracle.csproj'), '-c', 'Release', '--no-incremental', '-warnaserror', '-m:1', '-o', path.join(work, 'bin'),
    `-p:BaseIntermediateOutputPath=${path.join(work, 'obj')}${path.sep}`, `-p:MSBuildProjectExtensionsPath=${path.join(work, 'obj')}${path.sep}`, `-bl:${path.join(output, 'oracle.binlog')}`]);
  const dll = path.join(work, 'bin/P3.BaseOracle.dll');
  const bytes = await readFile(dll);
  assembly = { path: dll, bytes: bytes.length, sha256: sha256(bytes) };
  await command('direct-first-meal', [dll, '--input', path.join(repository, firstMealInput), '--out', path.join(output, 'direct')]);
  result = await readJson(path.join(output, 'direct/result.json'));
  assert.equal(result.newPathfindingInvoked, false);
  assert.equal(result.results.length, 2);
  for (const entry of result.results) {
    const expected = entry.name === 'near' ? { supplier: 2, customer: 3, tick: 7 } : { supplier: 7, customer: 8, tick: 17 };
    const source = entry.scenario;
    const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    assert.equal(distance(source.kitchenPosition, source.supplierStart), expected.supplier);
    assert.equal(distance(source.kitchenPosition, source.customerStart), expected.customer);
    const formulaTick = Math.max(2 * expected.supplier * source.movementTicksPerTile + source.productionTicks, expected.customer * source.movementTicksPerTile);
    assert.equal(formulaTick, expected.tick);
    assert.equal(entry.settled.FirstMealTick, expected.tick);
    assert.equal(entry.settled.IsComplete, true);
    const ledger = await readFile(entry.ledger.path);
    assert.equal(ledger.length, entry.ledger.bytes);
    assert.equal(sha256(ledger), entry.ledger.sha256);
  }
} catch (error) { failure = { category: result ? 'DirectKernelOrCriterion' : 'HarnessBuildOrEnvironment', message: error.message, stack: error.stack }; }
const after = await fileManifest(sources);
const sourceStable = JSON.stringify(before) === JSON.stringify(after);
if (!sourceStable) failure ??= { category: 'SourceChanged', message: 'This run is not frozen source evidence.' };
await writeJson(path.join(output, 'FIRST_MEAL_BASELINE.json'), { schemaVersion: 1, declaredBaseline,
  scope: 'D2 existing BaseSession oracle only; P3 import/distance/browser and Unity remain NotRun.',
  kernelOraclePassed: !failure, d2ProductStatus: 'NotRun', unityStatus: 'NotRun', sdk: '8.0.428', dotnet,
  sourceBefore: before, sourceAfter: after, sourceStable, assembly, failure,
  results: result?.results.map(entry => ({ name: entry.name, firstMealTick: entry.settled.FirstMealTick, ledger: entry.ledger })) ?? [],
  commands: commands.map(({ stdoutBytes, stderrBytes, ...receipt }) => receipt) });
console.log(JSON.stringify({ kernelOraclePassed: !failure, d2ProductStatus: 'NotRun', sourceStable, output, failure }));
process.exitCode = failure ? 1 : 0;
