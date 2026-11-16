import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { P2HttpContext } from './http-context.mjs';
import { startRecorded } from '../raw-evidence.mjs';
import { repository, runRecorded, verifySavedBytes, readJson, sha256, snapshotFiles, writeJson } from './evidence.mjs';

const test = new P2HttpContext(process.argv.slice(2));
let frontend, frontendIdentity, failure, manifest;
const url = 'http://127.0.0.1:5176';
async function portFree() {
  await new Promise((resolve, reject) => { const socket = net.connect({ host: '127.0.0.1', port: 5176 }); socket.once('connect', () => { socket.destroy(); reject(new Error('Port 5176 already occupied; no process was stopped.')); }); socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error)); });
}
async function frontendMetadata(name) {
  const receipt = await test.command(name, test.args['--pwsh'], ['-NoProfile', '-File', path.join(repository, 'tools/editor-verification/owned-process.ps1'), '-OwnedProcessId', String(frontend.child.pid)]);
  const value = JSON.parse(receipt.stdoutBytes.toString('utf8')); assert.equal(value.parentProcessId, process.pid); assert.equal(value.processId, frontend.child.pid);
  assert.equal(path.resolve(value.executablePath).toLowerCase(), process.execPath.toLowerCase()); assert.ok(value.commandLine.includes(test.work)); return value;
}
try {
  await test.initialize();
  manifest = await readJson(path.resolve(repository, test.args['--frontend-manifest']));
  for (const file of manifest.files) assert.equal(sha256(await readFile(path.join(repository, file.path))), file.sha256);
  const ffmpegRoot = path.resolve(repository, test.args['--video-runtime']);
  const ffmpeg = path.join(ffmpegRoot, 'ffmpeg-1011/ffmpeg-win64.exe');
  assert.equal(sha256(await readFile(ffmpeg)), '5b8f3f59ba61685828939ff3c833109748adbdea2fff4b4ae570c9fc0fc1ff4d');
  test.identity.frontend = manifest; test.identity.reusedVideoRuntime = { path: ffmpeg, sha256: sha256(await readFile(ffmpeg)), readOnlyReuse: true, downloadOrInstall: false };
  await test.start('c13-pristine'); await test.import('round4_mage_library.json');
  const fixtureBefore = await snapshotFiles(test.content);
  await portFree();
  frontend = await startRecorded({ executable: process.execPath, args: [path.join(repository, 'tools/editor-verification/frontend-dev.mjs'), path.join(test.work, 'vite-cache')], cwd: path.join(repository, 'tools/editor-web'), prefix: path.join(test.output, 'frontend'), timeoutMs: 300000 });
  frontendIdentity = await frontendMetadata('frontend-identity-start');
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) { try { ready = (await fetch(url)).status === 200; } catch {} if (ready) break; await sleep(100); }
  assert.equal(ready, true);
  await test.phase('C13.FinalSourceOneActualLibraryClickToResultPaint', async () => {
    const temporary = path.join(test.work, 'performance-temp'); await mkdir(temporary);
    const script = path.join(repository, 'tools/editor-web/verification/measure-combat-run.mjs');
    const scriptSha256 = sha256(await readFile(script));
    test.browserLaunchAttempted = true;
    const receipt = await runRecorded({ executable: process.execPath, args: [script, url, test.content, path.join(test.output, 'performance')], cwd: path.join(repository, 'tools/editor-web'), prefix: path.join(test.output, 'measurement'), timeoutMs: 120000,
      env: { PLAYWRIGHT_BROWSERS_PATH: ffmpegRoot, EDITOR_BROWSER_PATH: test.args['--browser-exe'], TEMP: temporary, TMP: temporary } });
    await verifySavedBytes(receipt); const { stdoutBytes, stderrBytes, ...saved } = receipt; test.commands.push(saved);
    assert.equal(receipt.exitCode, 0); assert.equal(receipt.timedOut, false);
    const result = await readJson(path.join(test.output, 'performance/performance.json')); test.browserStarted = true;
    assert.equal(result.ok, true); assert.ok(result.measure.handlerToPaintMs < 1000); assert.equal(result.actualStatus, 200);
    assert.equal(result.provenance.sourceSha256, sha256(await readFile(path.join(repository, 'Game/Assets/StreamingAssets/Prototype/Combat/round4_mage_library.json'))));
    const request = await readFile(path.join(test.output, 'performance/run.request.bin')), response = await readFile(path.join(test.output, 'performance/run.response.bin'));
    assert.equal(sha256(request), result.request.sha256); assert.equal(sha256(response), result.response.sha256);
    assert.deepEqual(await snapshotFiles(test.content), fixtureBefore);
    await writeJson(path.join(test.output, 'C13_SCOPE_RECEIPT.json'), { schemaVersion: 1, sourceHash: manifest.sourceHash, cliSha256: test.args['--expected-cli-sha'], unchangedExistingMeasurementScript: { path: script, sha256: scriptSha256 }, result,
      actualContext: 'Fresh isolated R4 library content and fresh browser profile; normal import/assembly/page/font readiness before the only trial/run click. Import validates and setup assembles; no full trial simulation was prewarmed. This is not a fully cold backend/JIT claim.', metric: 'Product run handler to committed result plus two animation frames. automationUpperBoundMs is separately labeled, not the acceptance metric.', raw: 'measurement stdout/stderr/command, performance trace/video/actual request and response bins, assembled response and two actual frames.', fixtureBytesUnchanged: true });
    return { handlerToPaintMs: result.measure.handlerToPaintMs, automationUpperBoundMs: result.measure.automationUpperBoundMs, oneActualClick: true, sourceHash: manifest.sourceHash, sourceKind: result.provenance.sourceKind, sourceSha256: result.provenance.sourceSha256, actualStatus: result.actualStatus };
  });
  assert.equal(sha256(await readFile(ffmpeg)), test.identity.reusedVideoRuntime.sha256);
} catch (error) {
  failure = { check: test.activeCheck, category: test.activeCheck === 'Preflight' ? 'HarnessOrEnvironmentPrecondition' : 'C13Failure_RequiresProductHarnessEnvironmentTriage', message: error.message, stack: error.stack };
} finally {
  if (frontend) {
    try { const current = await frontendMetadata('frontend-identity-before-stop'); assert.equal(current.startedAtUtc, frontendIdentity.startedAtUtc); }
    catch (error) { failure ??= { check: 'FrontendCleanupIdentity', message: error.message }; }
    const stopped = await frontend.stop(); const { stdoutBytes, stderrBytes, ...receipt } = stopped; test.identity.frontendService = { identity: frontendIdentity, stopped: receipt }; await portFree();
  }
  if (manifest) for (const file of manifest.files) if (sha256(await readFile(path.join(repository, file.path))) !== file.sha256) failure ??= { check: 'FrontendSourceChanged', message: file.path };
}
process.exitCode = await test.finish(failure) ? 0 : 1;
