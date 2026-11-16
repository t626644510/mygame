import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { startRecorded, requestRecorded } from '../raw-evidence.mjs';
import { repository, options, isolatedPath, freshDirectory, runRecorded, verifySavedBytes, sourceSnapshot, captureInputs, snapshotFiles, writeJson, readJson, sha256 } from './evidence.mjs';

export const clone = value => structuredClone(value);

// A write-capable route is not proof that an individual rejected call wrote.
// Pure POST validation/assembly/simulation remains read-only by this contract.
export function isPersistingApiRequest(method, url) {
  const verb = method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(verb)) return false;
  if (['PUT', 'PATCH', 'DELETE'].includes(verb)) return true;
  if (verb !== 'POST') return false;
  const route = new URL(url, 'http://127.0.0.1').pathname.replace(/\/+$/, '');
  return ['/api/import-scenario', '/api/import-expedition', '/api/requests', '/api/export', '/api/export-scenario'].includes(route);
}

// A small P2 test context using the already executed P1 byte collector and exact
// owned-PID helper. It starts only its own loopback backend, never a browser.
export class P2HttpContext {
  constructor(argv) {
    this.args = options(argv, ['--dotnet', '--cli', '--expected-cli-sha', '--oracle-build', '--contract-sha', '--pwsh', '--output', '--work']);
    this.output = isolatedPath(this.args['--output'], 'outputs/helper_editor_p2/verification');
    this.work = isolatedPath(this.args['--work'], 'work/p2_verification_20261116');
    this.dotnet = path.resolve(this.args['--dotnet']);
    this.cli = path.resolve(repository, this.args['--cli']);
    this.port = Number(this.args['--port'] ?? 5186);
    assert.equal(this.port, 5186, 'This independent actor owns only backend port 5186.');
    this.baseUrl = `http://127.0.0.1:${this.port}`;
    this.commands = []; this.http = []; this.checks = []; this.services = [];
    this.commandNumber = 0; this.requestNumber = 0; this.activeCheck = 'Preflight';
  }
  async initialize() {
    await freshDirectory(this.output); await freshDirectory(this.work);
    assert.equal(sha256(await readFile(this.cli)), this.args['--expected-cli-sha']);
    const contract = path.join(repository, 'docs/editor/P2_API_CONTRACT.md');
    assert.equal(sha256(await readFile(contract)), this.args['--contract-sha']);
    this.oracleBuild = await readJson(path.resolve(repository, this.args['--oracle-build']));
    assert.equal(this.oracleBuild.passed, true);
    assert.equal(sha256(await readFile(this.oracleBuild.assembly.path)), this.oracleBuild.assembly.sha256);
    this.before = await sourceSnapshot();
    for (const row of this.oracleBuild.sourceAfter.filter(row => row.path.startsWith('Game/Assets/Prototype/Combat/Runtime/') && row.path.endsWith('.cs')))
      assert.deepEqual(this.before.find(current => current.path === row.path), row, 'Oracle Runtime source differs from current frozen source.');
    this.inputs = await captureInputs(path.join(this.output, 'original-inputs'));
    this.harnessBefore = await snapshotFiles(path.join(repository, 'tools/editor-verification/p2'));
    this.identity = { baseline: '2651a82322d675a077031b8bea2aec797a52cead', cli: { path: this.cli, sha256: this.args['--expected-cli-sha'] }, oracle: this.oracleBuild.assembly,
      contract: { path: contract, sha256: this.args['--contract-sha'] }, protectedPhysicalFiles: this.before.length, node: process.version };
    if (this.args['--build-receipt']) {
      const file = path.resolve(repository, this.args['--build-receipt']); const bytes = await readFile(file);
      await copyFile(file, path.join(this.output, 'PRODUCT_BUILD_RECEIPT.json'));
      this.identity.productBuildReceipt = { path: file, bytes: bytes.length, sha256: sha256(bytes) };
    }
  }
  async command(name, executable, argv, expected = 0) {
    const result = await runRecorded({ executable, args: argv, cwd: repository, prefix: path.join(this.output, 'commands', `${String(++this.commandNumber).padStart(3, '0')}-${name}`), timeoutMs: 120000 });
    await verifySavedBytes(result);
    const { stdoutBytes, stderrBytes, ...receipt } = result; this.commands.push(receipt);
    assert.equal(result.timedOut, false); assert.equal(result.spawnError, null); assert.equal(result.exitCode, expected, `${name}: actual exit ${result.exitCode}`);
    return result;
  }
  async api(route, method = 'GET', body, headers = {}) {
    const result = await requestRecorded({ baseUrl: this.baseUrl, route, method, body, headers,
      prefix: path.join(this.output, 'http', `${String(++this.requestNumber).padStart(3, '0')}-${method}-${route.replaceAll(/[^a-z0-9_-]/gi, '_')}`) });
    const { responseBytes, json, ...receipt } = result; this.http.push(receipt);
    for (const stream of [result.request, result.response]) {
      const saved = await readFile(stream.path);
      assert.equal(saved.length, stream.bytes); assert.equal(sha256(saved), stream.sha256);
    }
    return { ...result, status: result.response.status };
  }
  async portFree() {
    await new Promise((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port: this.port });
      socket.once('connect', () => { socket.destroy(); reject(new Error('Port 5186 already has a service; no process is stopped.')); });
      socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
    });
  }
  async serviceIdentity(name) {
    const result = await this.command(name, this.args['--pwsh'], ['-NoProfile', '-File', path.join(repository, 'tools/editor-verification/owned-process.ps1'), '-OwnedProcessId', String(this.service.child.pid)]);
    const actual = JSON.parse(result.stdoutBytes.toString('utf8'));
    assert.equal(actual.processId, this.service.child.pid); assert.equal(actual.parentProcessId, process.pid);
    assert.equal(path.resolve(actual.executablePath).toLowerCase(), this.dotnet.toLowerCase());
    assert.ok(actual.commandLine.includes(this.cli) && actual.commandLine.includes(this.content) && actual.commandLine.includes(String(this.port)));
    return actual;
  }
  async start(name, existingContent) {
    assert.equal(this.service, undefined, 'Stop the previous retained process before changing roots.');
    this.content = existingContent ? isolatedPath(existingContent, 'work/p2_verification_20261116') : path.join(this.work, name, 'content'); this.runtime = path.join(this.work, name, 'runtime');
    await freshDirectory(this.runtime);
    if (!existingContent) {
      await freshDirectory(this.content);
      for (const folder of ['items', '_requests', 'skills', 'characters', 'encounters', 'trials', 'rules', '_imports']) await mkdir(path.join(this.content, folder), { recursive: true });
      for (const id of ['expedition_ore', 'quenching_sand', 'mat_grain', 'con_simple_meal', 'eq_patrol_sword']) await copyFile(path.join(repository, 'content/items', `${id}.json`), path.join(this.content, 'items', `${id}.json`));
      for (const id of ['REQ-0001', 'REQ-0002', 'REQ-0003']) await copyFile(path.join(repository, 'content/_requests', `${id}.json`), path.join(this.content, '_requests', `${id}.json`));
      await copyFile(path.join(repository, 'content/rules/rules_combat.json'), path.join(this.content, 'rules/rules_combat.json'));
    }
    await this.portFree();
    this.serviceName = name;
    this.service = await startRecorded({ executable: this.dotnet, args: [this.cli, 'serve', '--port', String(this.port), '--content', this.content, '--export-out', this.runtime], cwd: repository,
      prefix: path.join(this.output, 'services', name), timeoutMs: 600000, env: { DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_CLI_UI_LANGUAGE: 'en' } });
    const record = { name, actual: null, content: this.content, runtime: this.runtime };
    this.services.push(record); record.actual = await this.serviceIdentity(`${name}-identity-start`);
    for (let attempt = 0; attempt < 50; attempt++) {
      const health = await this.api('/api/health');
      if (health.status === 200) { assert.equal(path.resolve(health.json.contentRoot), this.content); this.services.at(-1).health = health.json; return; }
      assert.equal(this.service.child.exitCode, null); await sleep(100);
    }
    throw new Error('Owned ready backend did not become healthy in 5 seconds.');
  }
  async stop() {
    if (!this.service) return;
    const owned = this.service; const record = this.services.at(-1);
    try {
      if (owned.child.exitCode === null) {
        record.beforeStop = await this.serviceIdentity(`${this.serviceName}-identity-before-stop`);
        if (record.actual) { assert.equal(record.beforeStop.startedAtUtc, record.actual.startedAtUtc); assert.equal(record.beforeStop.owner, record.actual.owner); }
      }
    } finally {
      const result = await owned.stop(); const { stdoutBytes, stderrBytes, ...receipt } = result;
      record.stopped = receipt; this.service = undefined;
    }
    await this.portFree(); record.portFreeAfterStop = true;
  }
  async import(file, linked = false) {
    const bytes = await readFile(path.join(this.output, 'original-inputs', file));
    const result = await this.api(linked ? '/api/import-expedition' : '/api/import-scenario', 'POST', { sourceName: file, jsonText: bytes.toString('utf8') });
    assert.equal(result.status, 200); assert.equal(result.json.ok, true);
    assert.equal(result.json.source.sha256, sha256(Buffer.from(bytes.toString('utf8'), 'utf8')));
    return result.json;
  }
  entityFile(type, id) { return path.join(this.content, { skill: 'skills', character: 'characters', encounter: 'encounters', trial: 'trials', rule: 'rules', item: 'items' }[type], `${id}.json`); }
  async get(type, id) {
    const result = await this.api(`/api/content/${type}/${id}`); assert.equal(result.status, 200);
    assert.equal(result.response.headers.etag, `"${sha256(await readFile(this.entityFile(type, id)))}"`);
    return result;
  }
  async save(type, entity, editIntent = []) {
    const disk = await this.get(type, entity.id);
    const result = await this.api(`/api/content/${type}/${entity.id}`, 'PUT', { entity, requests: [], editIntent }, { 'If-Match': disk.response.headers.etag });
    assert.equal(result.status, 200, `Valid ${type} update rejected; inspect exact HTTP raw.`);
    const reread = await this.get(type, entity.id); assert.deepEqual(reread.json, entity);
    return reread;
  }
  async assemble(trialId, extras = {}) {
    const result = await this.api('/api/assemble', 'POST', { trialId, ...extras }); assert.equal(result.status, 200); assert.equal(result.json.ok, true); return result.json;
  }
  async run(trialId, extras = {}) {
    const result = await this.api('/api/trial/run', 'POST', { trialId, ...extras }); assert.equal(result.status, 200); assert.equal(result.json.ok, true); return result.json;
  }
  async metadata(trialId) { return readJson(path.join(this.content, '_imports', `${trialId}.json`)); }
  async unchanged(action, root = this.content) {
    const before = await snapshotFiles(root); const result = await action();
    assert.deepEqual(await snapshotFiles(root), before, 'Pure validation or rejected operation changed directory paths/bytes.'); return result;
  }
  require422(result, needle) {
    assert.equal(result.status, 422); assert.equal(result.json.ok, false); assert.ok(Array.isArray(result.json.errors) && result.json.errors.length);
    if (needle) assert.ok(JSON.stringify(result.json.errors).includes(needle), `422 did not identify ${needle}`);
  }
  async oracle(name, mode, value) {
    const input = path.join(this.output, 'oracle-inputs', `${name}.json`); await writeJson(input, value);
    const output = path.join(this.output, 'oracle', name);
    await this.command(`${name}-oracle`, this.dotnet, [this.oracleBuild.assembly.path, mode, input, '--out', output]); return output;
  }
  async phase(id, action) {
    this.activeCheck = id; const result = await action();
    this.checks.push({ id, passed: true, evidence: result }); return result;
  }
  async finish(failure) {
    try { await this.stop(); } catch (error) { failure ??= { check: 'OwnedProcessCleanup', category: 'EnvironmentOrHarnessCleanup', message: error.message, stack: error.stack }; }
    const after = this.before ? await sourceSnapshot() : undefined;
    const harnessAfter = this.harnessBefore ? await snapshotFiles(path.join(repository, 'tools/editor-verification/p2')) : undefined;
    if (this.before && JSON.stringify(this.before) !== JSON.stringify(after)) failure ??= { check: 'SourceProtection', message: 'Protected Game/input bytes changed.' };
    if (this.harnessBefore && JSON.stringify(this.harnessBefore) !== JSON.stringify(harnessAfter)) failure ??= { check: 'HarnessVersion', message: 'Harness changed while tests ran.' };
    const summary = { schemaVersion: 1, passed: !failure, scope: this.scope ?? 'Only listed P2 HTTP/kernel checks, not UI or whole-phase acceptance.', identity: this.identity, activeCheck: this.activeCheck,
      checks: this.checks, failure, services: this.services, commands: this.commands, http: this.http, originalInputs: this.inputs, sourceBefore: this.before, sourceAfter: after, harnessBefore: this.harnessBefore, harnessAfter,
      isolation: { work: this.work, port: this.port, noBrowserOrUnityStarted: !(this.browserStarted || this.browserLaunchAttempted), browserLaunchAttempted: !!this.browserLaunchAttempted, browserContextCreated: !!this.browserStarted, noUnityStarted: true } };
    await writeJson(path.join(this.output, 'HTTP_ACCEPTANCE.json'), summary);
    console.log(JSON.stringify({ passed: summary.passed, checks: summary.checks.map(row => row.id), failure, httpRequests: this.http.length, commands: this.commands.length, output: this.output }));
    return summary.passed;
  }
}
