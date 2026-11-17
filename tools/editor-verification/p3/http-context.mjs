import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { startRecorded, requestRecorded } from '../raw-evidence.mjs';
import { isPersistingApiRequest as p2PersistingRequest } from '../p2/http-context.mjs';
import { repository, declaredBaseline, options, isolatedPath, freshDirectory, runRecorded, verifySavedBytes, snapshotFiles, writeJson, readJson, sha256 } from './evidence.mjs';

const directories = { item: 'items', building: 'buildings', recipe: 'recipes', layout: 'layouts', rule: 'rules', skill: 'skills', character: 'characters', encounter: 'encounters', trial: 'trials' };

export function isPersistingApiRequest(method, url) {
  const route = new URL(url, 'http://127.0.0.1').pathname.replace(/\/+$/, '');
  return (method.toUpperCase() === 'POST' && route === '/api/import-first-meal') || p2PersistingRequest(method, url);
}

async function protectedSnapshot() {
  const rows = [];
  for (const folder of ['Game/Assets/Prototype', 'Game/Assets/StreamingAssets/Prototype'])
    for (const row of await snapshotFiles(path.join(repository, folder))) rows.push({ ...row, path: `${folder}/${row.path}` });
  return rows.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

// The executed P1/P2 collector and exact-owned-PID metadata paths are reused.
// This context is never invoked until an actual frozen product DLL is ready.
export class P3HttpContext {
  constructor(argv) {
    this.args = options(argv, ['--dotnet', '--cli', '--expected-cli-sha', '--contract-sha', '--output', '--work']);
    if (process.platform === 'win32') assert.ok(this.args['--pwsh'], 'Windows metadata requires the existing PowerShell 7 executable.');
    this.output = isolatedPath(this.args['--output'], 'outputs/helper_editor_p3/verification');
    this.work = isolatedPath(this.args['--work'], 'work/p3_verification_20261117');
    this.dotnet = path.resolve(this.args['--dotnet']);
    this.cli = path.resolve(repository, this.args['--cli']);
    this.port = Number(this.args['--port'] ?? 5186);
    assert.equal(this.port, 5186, 'This independent actor owns only backend port 5186.');
    this.baseUrl = `http://127.0.0.1:${this.port}`;
    this.commands = []; this.http = []; this.checks = []; this.services = []; this.noWriteGuards = [];
    this.commandNumber = 0; this.requestNumber = 0; this.guardNumber = 0; this.activeCheck = 'Preflight';
  }
  async initialize() {
    await freshDirectory(this.output); await freshDirectory(this.work);
    assert.equal(sha256(await readFile(this.cli)), this.args['--expected-cli-sha']);
    const contract = path.join(repository, 'docs/editor/P3_API_CONTRACT.md');
    assert.equal(sha256(await readFile(contract)), this.args['--contract-sha']);
    this.before = await protectedSnapshot();
    this.harnessBefore = await snapshotFiles(path.join(repository, 'tools/editor-verification/p3'));
    for (const row of this.harnessBefore) {
      const source = path.join(repository, 'tools/editor-verification/p3', row.path);
      const target = path.join(this.output, 'harness-source', row.path);
      await mkdir(path.dirname(target), { recursive: true }); await copyFile(source, target);
      assert.equal(sha256(await readFile(target)), row.sha256, 'Harness changed while its actual source bytes were copied.');
    }
    this.identity = { declaredBaseline, platform: process.platform, node: process.version,
      cli: { path: this.cli, sha256: this.args['--expected-cli-sha'] },
      contract: { path: contract, sha256: this.args['--contract-sha'] },
      sourceMeaning: 'Current physical Game/input snapshot. Candidate compilation provenance is the separately pinned owner build receipt, not an assertion that live backend source equals the DLL.' };
    if (this.args['--build-receipt']) {
      const file = path.resolve(repository, this.args['--build-receipt']); const bytes = await readFile(file);
      await copyFile(file, path.join(this.output, 'PRODUCT_BUILD_RECEIPT.json'));
      this.identity.productBuildReceipt = { path: file, bytes: bytes.length, sha256: sha256(bytes) };
    }
  }
  async command(name, executable, args, expected = 0) {
    const result = await runRecorded({ executable, args, cwd: repository,
      prefix: path.join(this.output, 'commands', `${String(++this.commandNumber).padStart(3, '0')}-${name}`), timeoutMs: 120000 });
    await verifySavedBytes(result);
    const { stdoutBytes, stderrBytes, ...receipt } = result; this.commands.push(receipt);
    assert.equal(result.timedOut, false); assert.equal(result.spawnError, null); assert.equal(result.exitCode, expected, `${name}: inspect original stdout/stderr.`);
    return result;
  }
  async cliCommand(name, args, expected = 0) { return this.command(name, this.dotnet, [this.cli, ...args], expected); }
  async api(route, method = 'GET', body, headers = {}) {
    const result = await requestRecorded({ baseUrl: this.baseUrl, route, method, body, headers,
      prefix: path.join(this.output, 'http', `${String(++this.requestNumber).padStart(3, '0')}-${method}-${route.replaceAll(/[^a-z0-9_-]/gi, '_')}`) });
    const { responseBytes, json, ...receipt } = result; this.http.push(receipt);
    for (const stream of [result.request, result.response]) {
      const bytes = await readFile(stream.path);
      assert.equal(bytes.length, stream.bytes); assert.equal(sha256(bytes), stream.sha256);
    }
    return { ...result, status: result.response.status };
  }
  async portFree() {
    await new Promise((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port: this.port });
      socket.once('connect', () => { socket.destroy(); reject(new Error('Owned port 5186 is occupied; no process is stopped.')); });
      socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
    });
  }
  async serviceIdentity(name) {
    if (process.platform !== 'win32') {
      const values = {};
      for (const [key, fields] of [['identity', 'pid=,ppid=,uid=,lstart='], ['image', 'comm='], ['command', 'args=']]) {
        const result = await this.command(`${name}-${key}`, '/bin/ps', ['-p', String(this.service.child.pid), '-o', fields]);
        values[key] = result.stdoutBytes.toString('utf8').trim();
      }
      const match = /^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(values.identity);
      assert.ok(match, 'Exact-owned-PID POSIX identity is unparseable.');
      const actual = { processId: Number(match[1]), parentProcessId: Number(match[2]), owner: `uid:${match[3]}`,
        startedAtUtc: match[4], imageReportedByPs: values.image, commandLine: values.command,
        spawnExecutable: this.dotnet, method: 'Retained ChildProcess plus exact PID/parent/UID/start/image/args from ps' };
      assert.equal(actual.processId, this.service.child.pid); assert.equal(actual.parentProcessId, process.pid); assert.equal(Number(match[3]), process.getuid());
      assert.equal(path.basename(values.image), path.basename(this.dotnet));
      assert.ok(values.command.startsWith(this.dotnet) && values.command.includes(this.cli) && values.command.includes(this.content) && values.command.includes(String(this.port)));
      return actual;
    }
    const result = await this.command(name, this.args['--pwsh'], ['-NoProfile', '-File', path.join(repository, 'tools/editor-verification/owned-process.ps1'), '-OwnedProcessId', String(this.service.child.pid)]);
    const actual = JSON.parse(result.stdoutBytes.toString('utf8'));
    assert.equal(actual.processId, this.service.child.pid); assert.equal(actual.parentProcessId, process.pid);
    assert.equal(path.resolve(actual.executablePath).toLowerCase(), this.dotnet.toLowerCase());
    assert.ok(actual.commandLine.includes(this.cli) && actual.commandLine.includes(this.content) && actual.commandLine.includes(String(this.port)));
    return actual;
  }
  async start(name, existingContent) {
    assert.equal(this.service, undefined, 'Stop the retained previous service before changing data roots.');
    this.content = existingContent ? isolatedPath(existingContent, 'work/p3_verification_20261117') : path.join(this.work, name, 'content');
    this.runtime = path.join(this.work, name, 'runtime');
    await freshDirectory(this.runtime);
    if (!existingContent) {
      await freshDirectory(this.content);
      for (const folder of [...Object.values(directories), '_requests', '_imports']) await mkdir(path.join(this.content, folder), { recursive: true });
      for (const id of ['expedition_ore', 'quenching_sand', 'mat_grain', 'con_simple_meal', 'eq_patrol_sword']) await copyFile(path.join(repository, 'content/items', `${id}.json`), path.join(this.content, 'items', `${id}.json`));
      for (const id of ['REQ-0001', 'REQ-0002', 'REQ-0003']) await copyFile(path.join(repository, 'content/_requests', `${id}.json`), path.join(this.content, '_requests', `${id}.json`));
    }
    await this.portFree();
    this.serviceName = name;
    this.service = await startRecorded({ executable: this.dotnet,
      args: [this.cli, 'serve', '--port', String(this.port), '--content', this.content, '--export-out', this.runtime], cwd: repository,
      prefix: path.join(this.output, 'services', name), timeoutMs: 600000, env: { DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_CLI_UI_LANGUAGE: 'en' } });
    const record = { name, content: this.content, runtime: this.runtime, actual: null };
    this.services.push(record); record.actual = await this.serviceIdentity(`${name}-identity-start`);
    for (let attempt = 0; attempt < 50; attempt++) {
      const health = await this.api('/api/health');
      if (health.status === 200) {
        assert.equal(path.resolve(health.json.contentRoot), this.content); assert.equal(path.resolve(health.json.exportRoot), this.runtime);
        record.health = health.json; return;
      }
      assert.equal(this.service.child.exitCode, null); await sleep(100);
    }
    throw new Error('Owned frozen backend did not become healthy in five seconds.');
  }
  async stop() {
    if (!this.service) return;
    const owned = this.service; const record = this.services.at(-1);
    if (owned.child.exitCode === null && owned.child.signalCode === null) {
      record.beforeStop = await this.serviceIdentity(`${this.serviceName}-identity-before-stop`);
      if (record.actual) { assert.equal(record.beforeStop.startedAtUtc, record.actual.startedAtUtc); assert.equal(record.beforeStop.owner, record.actual.owner); }
    }
    const result = await owned.stop(); const { stdoutBytes, stderrBytes, ...receipt } = result;
    record.stopped = receipt; this.service = undefined;
    await this.portFree(); record.portFreeAfterStop = true;
  }
  entityFile(type, id) { assert.ok(directories[type]); return path.join(this.content, directories[type], `${id}.json`); }
  async get(type, id) {
    const result = await this.api(`/api/content/${type}/${id}`); assert.equal(result.status, 200);
    assert.equal(result.response.headers.etag, `"${sha256(await readFile(this.entityFile(type, id)))}"`);
    return result;
  }
  async create(type, entity, requests) {
    const result = await this.api(`/api/content/${type}/${entity.id}`, 'PUT', requests ? { entity, requests } : entity, { 'If-None-Match': '*' });
    assert.equal(result.status, 201, `Valid ${type} fixture create rejected; inspect original HTTP.`);
    const disk = await this.get(type, entity.id); assert.deepEqual(disk.json, entity); return disk;
  }
  async save(type, entity) {
    const before = await this.get(type, entity.id);
    const result = await this.api(`/api/content/${type}/${entity.id}`, 'PUT', entity, { 'If-Match': before.response.headers.etag });
    assert.equal(result.status, 200);
    const disk = await this.get(type, entity.id); assert.deepEqual(disk.json, entity); return disk;
  }
  async remove(type, id) {
    const before = await this.get(type, id);
    const result = await this.api(`/api/content/${type}/${id}`, 'DELETE', undefined, { 'If-Match': before.response.headers.etag });
    assert.equal(result.status, 200); return result;
  }
  async unchanged(action, root = this.content) {
    const id = String(++this.guardNumber).padStart(3, '0');
    const before = await snapshotFiles(root); const requestStart = this.requestNumber;
    const beforePath = path.join(this.output, 'no-write-guards', `${id}-before.json`);
    const afterPath = path.join(this.output, 'no-write-guards', `${id}-after.json`);
    await writeJson(beforePath, before);
    let result; let actionError;
    try { result = await action(); } catch (error) { actionError = error; }
    const after = await snapshotFiles(root); await writeJson(afterPath, after);
    this.noWriteGuards.push({ id, root, beforePath, afterPath, matched: JSON.stringify(before) === JSON.stringify(after),
      firstRequest: requestStart + 1, lastRequest: this.requestNumber, actionError: actionError?.message ?? null });
    assert.deepEqual(after, before, 'Pure or rejected operation changed whole-directory paths/bytes.');
    if (actionError) throw actionError;
    return result;
  }
  require422(result, needle) {
    assert.equal(result.status, 422); assert.equal(result.json.ok, false); assert.ok(Array.isArray(result.json.errors) && result.json.errors.length);
    if (needle) assert.ok(JSON.stringify(result.json.errors).includes(needle), `422 did not locate ${needle}`);
  }
  async phase(id, action) { this.activeCheck = id; const evidence = await action(); this.checks.push({ id, passed: true, evidence }); return evidence; }
  async finish(failure) {
    try { await this.stop(); } catch (error) { failure ??= { check: 'OwnedProcessCleanup', category: 'EnvironmentOrHarnessCleanup', message: error.message, stack: error.stack }; }
    const after = this.before ? await protectedSnapshot() : undefined;
    const harnessAfter = this.harnessBefore ? await snapshotFiles(path.join(repository, 'tools/editor-verification/p3')) : undefined;
    if (this.before && JSON.stringify(this.before) !== JSON.stringify(after)) failure ??= { check: 'ProtectedSources', category: 'VersionOrSourceMismatch', message: 'Physical Game/input paths/bytes changed during this run.' };
    if (this.harnessBefore && JSON.stringify(this.harnessBefore) !== JSON.stringify(harnessAfter)) failure ??= { check: 'HarnessVersion', category: 'VersionOrSourceMismatch', message: 'Harness changed while checks ran.' };
    if (sha256(await readFile(this.cli)) !== this.args['--expected-cli-sha']) failure ??= { check: 'CandidateDll', category: 'VersionOrSourceMismatch', message: 'Pinned DLL changed during this run.' };
    const summary = { schemaVersion: 1, passed: !failure, scope: this.scope ?? 'Only listed P3 HTTP/CLI checks; no browser, Unity or whole-phase claim.',
      identity: this.identity, activeCheck: this.activeCheck, checks: this.checks, failure, services: this.services, commands: this.commands, http: this.http, noWriteGuards: this.noWriteGuards,
      sourceBefore: this.before, sourceAfter: after, harnessBefore: this.harnessBefore, harnessAfter,
      isolation: { work: this.work, port: this.port, browserLaunchAttempted: !!this.browserLaunchAttempted, browserContextCreated: !!this.browserContextCreated, unityLaunchAttempted: false } };
    await writeJson(path.join(this.output, 'HTTP_ACCEPTANCE.json'), summary);
    console.log(JSON.stringify({ passed: summary.passed, checks: this.checks.map(row => row.id), failure, httpRequests: this.http.length, commands: this.commands.length, output: this.output }));
    return summary.passed;
  }
}
