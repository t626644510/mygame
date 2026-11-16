import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { repository, options, isolatedPath, freshDirectory, runRecorded, verifySavedBytes, sourceSnapshot, writeJson, sha256 } from './evidence.mjs';

const args = options(process.argv.slice(2), ['--dotnet', '--output', '--work']);
const output = isolatedPath(args['--output'], 'outputs/helper_editor_p2/verification');
const work = isolatedPath(args['--work'], 'work/p2_verification_20261116');
await freshDirectory(output);
await freshDirectory(work);
const dotnet = path.resolve(args['--dotnet']);
const project = path.join(repository, 'tools/editor-verification/p2/kernel-oracle/P2.KernelOracle.csproj');
const compiledSources = ['tools/editor-verification/p2/kernel-oracle/P2.KernelOracle.csproj', 'tools/editor-verification/p2/kernel-oracle/Program.cs', 'tools/sim-cli/src/MyGame.Sim.Cli/UnityJson.cs'];
const before = await sourceSnapshot(compiledSources);
const commands = [];
let failure;
try {
  const env = { DOTNET_CLI_HOME: path.join(work, 'dotnet-home'), DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' };
  const version = await runRecorded({ executable: dotnet, args: ['--version'], cwd: path.join(repository, 'tools/sim-cli'), prefix: path.join(output, 'sdk-version'), env });
  await verifySavedBytes(version); commands.push(version);
  assert.equal(version.exitCode, 0); assert.equal(version.stdoutBytes.toString('utf8').trim(), '8.0.428');
  const build = await runRecorded({ executable: dotnet,
    args: ['build', project, '-c', 'Release', '--no-incremental', '-warnaserror', '-m:1', '-o', path.join(work, 'bin'),
      `-p:BaseIntermediateOutputPath=${path.join(work, 'obj')}${path.sep}`, `-p:MSBuildProjectExtensionsPath=${path.join(work, 'obj')}${path.sep}`, `-bl:${path.join(output, 'oracle.binlog')}`],
    cwd: path.join(repository, 'tools/sim-cli'), prefix: path.join(output, 'oracle-build'), timeoutMs: 180000, env });
  await verifySavedBytes(build); commands.push(build);
  assert.equal(build.exitCode, 0, 'Independent oracle did not compile. This is a harness build failure, never a P2 product failure.');
} catch (error) { failure = { category: 'HarnessBuildOrEnvironment', message: error.message, stack: error.stack }; }
const after = await sourceSnapshot(compiledSources);
if (JSON.stringify(before) !== JSON.stringify(after)) failure ??= { category: 'SourceChangedDuringBuild', message: 'Protected inputs/kernel or oracle source changed; this build is not frozen evidence.' };
let assembly;
if (!failure) {
  const file = path.join(work, 'bin/P2.KernelOracle.dll');
  const bytes = await readFile(file);
  assembly = { path: file, bytes: bytes.length, sha256: sha256(bytes) };
}
await writeJson(path.join(output, 'ORACLE_BUILD.json'), { schemaVersion: 1, supportOnly: true, c1Status: 'NotRun', sdk: '8.0.428', dotnet, assembly, passed: !failure, failure,
  sourceBefore: before, sourceAfter: after, commands: commands.map(({ stdoutBytes, stderrBytes, ...receipt }) => receipt) });
console.log(JSON.stringify({ supportBuildPassed: !failure, c1Status: 'NotRun', assembly, failure, evidence: output }));
process.exitCode = failure ? 1 : 0;
