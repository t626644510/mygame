import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareTrees, findMetadataKeys, runtimeProjection } from './json-assertions.mjs';
import { requestRecorded, runRecorded, sha256, snapshotFiles, startRecorded, verifySavedBytes, writeJson } from './raw-evidence.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '../..');
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  if (!['--dotnet', '--cli', '--output', '--work', '--port', '--pwsh', '--ready-contract-sha'].includes(key) || !process.argv[index + 1] || options[key]) throw new Error(`Invalid argument ${key}`);
  options[key] = process.argv[index + 1];
}
for (const name of ['--dotnet', '--cli', '--output', '--work', '--port', '--ready-contract-sha', ...(process.platform === 'win32' ? ['--pwsh'] : [])]) if (!options[name]) throw new Error(`Missing ${name}; run only after the backend owner declares ready.`);
const output = path.resolve(options['--output']);
const work = path.resolve(options['--work']);
if (!output.startsWith(`${path.join(repository, 'outputs')}${path.sep}`) || !work.startsWith(`${path.join(repository, 'work')}${path.sep}`)) throw new Error('Use isolated workspace work and outputs directories.');
const port = Number(options['--port']);
if (port !== 5186) throw new Error('Independent acceptance reserves backend port 5186.');
const cli = path.resolve(options['--cli']);
const dotnet = path.resolve(options['--dotnet']);
const contractPath = path.join(repository, 'docs/editor/P1_API_CONTRACT.md');
const contractBytes = await readFile(contractPath);
assert.equal(sha256(contractBytes), options['--ready-contract-sha'], 'Explicit ready contract hash differs from disk.');
await mkdir(output, { recursive: false });
await mkdir(work, { recursive: false });
const content = path.join(work, 'content');
const runtime = path.join(work, 'runtime');
await cp(path.join(repository, 'content'), content, { recursive: true, errorOnExist: true, force: false });
await mkdir(runtime);
const baseline = JSON.parse(await readFile(path.join(here, 'fixtures/baseline.json'), 'utf8'));
const checks = [];
const commands = [];
const http = [];
const services = [];
let commandNumber = 0;
let requestNumber = 0;
let service;
let stoppedReceipt;
const backendSourceRoot = path.join(repository, 'tools/sim-cli/src/MyGame.Sim.Cli');
const identity = { baseline: baseline.p0MergedCommit, contract: { path: contractPath, sha256: sha256(contractBytes) }, cli: { path: cli, sha256: sha256(await readFile(cli)) },
  backendSourceFiles: await Promise.all((await readdir(backendSourceRoot)).filter(file => file.endsWith('.cs')).sort().map(async file => ({ path: `tools/sim-cli/src/MyGame.Sim.Cli/${file}`, sha256: sha256(await readFile(path.join(backendSourceRoot, file))) }))),
  verifierScripts: await Promise.all(['backend-checks.mjs', 'raw-evidence.mjs', 'json-assertions.mjs', 'owned-process.ps1', 'fixtures/baseline.json'].map(async file => ({ path: `tools/editor-verification/${file}`, sha256: sha256(await readFile(path.join(here, file))) }))),
  sourceContent: await snapshotFiles(path.join(repository, 'content')), oldPrototype: await snapshotFiles(path.join(repository, 'Game/Assets/StreamingAssets/Prototype')), legacySourceValidation: [] };
const baseUrl = `http://127.0.0.1:${port}`;
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const itemPath = id => path.join(content, 'items', `${id}.json`);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const bareItem = (id, category = 'material') => ({ schemaVersion: 1, id, aliases: [], name: `隔离验收 ${id}`, category, description: '仅在隔离测试数据中使用。', icon: '', stackLimit: category === 'equipment' ? 1 : 99, baseValue: 0, tags: [], equipment: { slot: category === 'equipment' ? 'weapon' : '', combatBonus: [], enhancement: [] }, consumable: { effects: [] }, draft: false });
const independentDraftId = 'con_p1_draft_probe';
async function saveFixtureItem(root, item) { await writeJson(path.join(root, 'items', `${item.id}.json`), item); }
async function allItems(root = content) { return Promise.all((await readdir(path.join(root, 'items'))).filter(file => file.endsWith('.json')).sort().map(file => readJson(path.join(root, 'items', file)))); }
async function phase(id, action) {
  try { const evidence = await action(); checks.push({ id, passed: true, evidence: evidence ?? null }); }
  catch (error) { checks.push({ id, passed: false, error: error.message, stack: error.stack }); throw error; }
}
async function call(...argumentsList) {
  const result = await runRecorded({ executable: dotnet, args: [cli, ...argumentsList], cwd: repository, prefix: path.join(output, 'commands', `${String(++commandNumber).padStart(3, '0')}-${argumentsList[0]}`), timeoutMs: 30000, env: { DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_CLI_UI_LANGUAGE: 'en' } });
  await verifySavedBytes(result);
  const { stdoutBytes, stderrBytes, ...receipt } = result;
  commands.push(receipt);
  let json = null;
  try { json = JSON.parse(stdoutBytes.toString('utf8')); } catch { /* Non-JSON commands keep raw bytes. */ }
  return { ...result, json };
}
async function api(route, method = 'GET', body, headers = {}) {
  const result = await requestRecorded({ baseUrl, route, method, body, headers, prefix: path.join(output, 'http', `${String(++requestNumber).padStart(3, '0')}-${method}-${route.replaceAll(/[^a-z0-9_-]/gi, '_')}`) });
  const { responseBytes, json, ...receipt } = result;
  http.push(receipt);
  return { ...result, status: result.response.status };
}
async function unchanged(root, action) {
  const before = await snapshotFiles(root);
  const result = await action();
  assert.deepEqual(await snapshotFiles(root), before, 'Rejected/validation operation changed paths or file bytes.');
  return result;
}
function require422(result, field) {
  assert.equal(result.status, 422);
  assert.equal(result.json.ok, false);
  assert.ok(Array.isArray(result.json.errors) && result.json.errors.length > 0);
  if (field) assert.ok(result.json.errors.some(error => error.field === field), `Expected error at ${field}`);
  for (const error of result.json.errors) { assert.equal(typeof error.message, 'string'); assert.ok(error.message.length); assert.equal(typeof error.field, 'string'); }
}
const positions = rows => rows.map(row => ({ path: row.path.replaceAll('\\', '/'), jsonPointer: row.jsonPointer, quantity: row.quantity, legacy: row.legacy, direction: row.direction })).sort((a, b) => `${a.path}#${a.jsonPointer}`.localeCompare(`${b.path}#${b.jsonPointer}`, 'en'));
async function getAndVerifyEtag(id) {
  const result = await api(`/api/content/item/${id}`);
  assert.equal(result.status, 200);
  assert.equal(result.response.headers.etag, `"${sha256(await readFile(itemPath(id)))}"`);
  return result;
}
async function newItem(item) {
  const result = await api(`/api/content/item/${item.id}`, 'PUT', item, { 'If-None-Match': '*' });
  assert.equal(result.status, 201);
  assert.equal(result.response.headers.etag, `"${sha256(await readFile(itemPath(item.id)))}"`);
  return result;
}
async function assertPortFree() {
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); reject(new Error(`Port ${port} belongs to an existing service; no process is stopped.`)); });
    socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
  });
}
async function serviceIdentity(name) {
  if (process.platform !== 'win32') {
    const values = {};
    for (const [key, fields] of [['identity', 'pid=,ppid=,uid=,lstart='], ['image', 'comm='], ['command', 'args=']]) {
      const receipt = await runRecorded({ executable: '/bin/ps', args: ['-p', String(service.child.pid), '-o', fields], cwd: repository, prefix: path.join(output, `${name}-${key}`), timeoutMs: 10000, env: { LC_ALL: 'C' } });
      await verifySavedBytes(receipt); assert.equal(receipt.exitCode, 0); values[key] = receipt.stdoutBytes.toString('utf8').trim();
    }
    const match = /^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(values.identity);
    assert.ok(match, 'Could not parse exact owned POSIX process identity.');
    const actual = { processId: Number(match[1]), parentProcessId: Number(match[2]), owner: `uid:${match[3]}`, startedAtUtc: match[4], imageReportedByPs: values.image, commandLine: values.command, spawnExecutable: dotnet, method: 'Exact-owned-PID POSIX ps parent/UID/start/image/args, retained ChildProcess handle, and actual HTTP root/port' };
    assert.equal(actual.processId, service.child.pid); assert.equal(actual.parentProcessId, process.pid); assert.equal(Number(match[3]), process.getuid());
    assert.equal(path.basename(values.image), path.basename(dotnet)); assert.ok(values.command.startsWith(dotnet) && values.command.includes(content) && values.command.includes(String(port)));
    return actual;
  }
  const receipt = await runRecorded({ executable: options['--pwsh'], args: ['-NoProfile', '-File', path.join(here, 'owned-process.ps1'), '-OwnedProcessId', String(service.child.pid)], cwd: repository, prefix: path.join(output, name), timeoutMs: 10000 });
  await verifySavedBytes(receipt);
  assert.equal(receipt.exitCode, 0);
  const actual = JSON.parse(receipt.stdoutBytes.toString('utf8'));
  assert.equal(actual.processId, service.child.pid);
  assert.equal(actual.parentProcessId, process.pid);
  assert.equal(path.resolve(actual.executablePath).toLowerCase(), dotnet.toLowerCase());
  assert.ok(actual.commandLine.includes(content) && actual.commandLine.includes(String(port)));
  return actual;
}
async function startService() {
  await assertPortFree();
  service = await startRecorded({ executable: dotnet, args: [cli, 'serve', '--port', String(port), '--content', content, '--export-out', runtime], cwd: repository, prefix: path.join(output, 'service'), timeoutMs: 600000, env: { DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_CLI_UI_LANGUAGE: 'en' } });
  const actual = await serviceIdentity('service-identity-start');
  services.push(actual);
  for (let attempt = 0; attempt < 50; attempt++) {
    const health = await api('/api/health');
    if (health.status === 200) { assert.equal(path.resolve(health.json.contentRoot), content); identity.health = health.json; return; }
    if (service.child.exitCode !== null) throw new Error('Owned ready backend exited before health became available.');
    await sleep(100);
  }
  throw new Error('Owned backend did not become healthy in 5 seconds.');
}
async function checkExport(root, target) {
  const result = await call('export', '--content', root, '--out', target);
  assert.equal(result.exitCode, 0);
  const itemsBytes = await readFile(path.join(target, 'items.json'));
  const manifestBytes = await readFile(path.join(target, 'manifest.json'));
  for (const bytes of [itemsBytes, manifestBytes]) { assert.notEqual(bytes.subarray(0, 3).toString('hex'), 'efbbbf'); assert.equal(bytes.includes(13), false); }
  const exported = JSON.parse(itemsBytes.toString('utf8'));
  assert.deepEqual(findMetadataKeys(exported), []);
  assert.deepEqual(compareTrees(runtimeProjection(await allItems(root)), exported), []);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(Object.keys(manifest).sort(), ['schemaVersion', 'contentHash', 'files'].sort());
  for (const entry of manifest.files) {
    assert.equal(entry.sha256, sha256(await readFile(path.join(target, entry.path))));
    if (entry.path === 'items.json') assert.equal(entry.count, exported.items.length);
  }
  const sequence = [...manifest.files].sort((a, b) => a.path < b.path ? -1 : 1).map(entry => `${entry.path}\n${entry.sha256}\n`).join('');
  assert.equal(manifest.contentHash, sha256(Buffer.from(sequence, 'utf8')));
  return { exported, manifest };
}

let failure = null;
try {
  await phase('B1.data-and-live-cli-validation', async () => {
    for (const original of baseline.legacySourceFiles) {
      const actualSha256 = sha256(await readFile(path.join(repository, original.path)));
      assert.ok(actualSha256 === original.sha256 || (original.sha256Lf && actualSha256 === original.sha256Lf), `Original configuration drift: ${original.path}`);
      identity.legacySourceValidation.push({ path: original.path, actualRawSha256: actualSha256, matched: actualSha256 === original.sha256 ? 'frozen-Windows-raw-bytes' : 'frozen-derived-LF-checkout-bytes', evidenceBytesWereNotRewritten: true });
    }
    for (const expected of baseline.items) {
      const actual = await readJson(itemPath(expected.id));
      for (const field of ['id', 'name', 'category', 'baseValue', 'aliases']) assert.deepEqual(actual[field], expected[field]);
      assert.equal(actual.schemaVersion, 1); assert.equal(actual.draft, false); assert.ok(actual.equipment && actual.consumable);
      if (expected.provisionalValue) assert.match(actual.description, /参考价待定/);
    }
    const sword = await readJson(itemPath('eq_patrol_sword'));
    assert.equal(sword.stackLimit, 1); assert.equal(sword.equipment.slot, 'weapon'); assert.deepEqual(sword.equipment.enhancement[0], baseline.enhancement);
    const validated = await call('validate', '--content', content);
    assert.equal(validated.exitCode, 0); assert.equal(validated.json.ok, true);
    const catalog = await call('catalog'); assert.equal(catalog.exitCode, 0);
    assert.deepEqual(catalog.json.combatBonusFields.map(field => field.id), ['equipmentDamageBonus']);
    return { itemCount: baseline.items.length, validation: validated.json };
  });
  await phase('B2.real-cli-legacy-scan', async () => {
    const result = await call('legacy-scan', '--content', content); assert.equal(result.exitCode, 0);
    const entries = result.json.entries; assert.equal(result.json.schemaVersion, 1);
    assert.deepEqual(entries.map(entry => entry.id).sort(), ['expedition_ore', 'expedition-ore', 'quenching-sand', ...baseline.unregisteredEquipmentLabels].sort());
    assert.deepEqual(result.json.summary, { registered: 1, alias: 2, unregistered: 3 });
    for (const [id, status, canonicalId] of [['expedition_ore', 'registered', 'expedition_ore'], ['expedition-ore', 'alias', 'expedition_ore'], ['quenching-sand', 'alias', 'quenching_sand'], ...baseline.unregisteredEquipmentLabels.map(id => [id, 'unregistered', ''])]) {
      const entry = entries.find(entry => entry.id === id); assert.equal(entry.status, status); assert.equal(entry.canonicalId, canonicalId);
      assert.ok(entry.occurrences.length > 0); assert.equal(entry.type, status === 'unregistered' ? '' : 'item');
    }
    assert.equal(JSON.stringify(result.json).includes('guard-linen-sword-001'), false);
    return result.json.summary;
  });
  await startService();
  await phase('B4.real-refs-alias-and-delete-guard', async () => {
    const canonical = await api('/api/refs/expedition_ore'); const alias = await api('/api/refs/expedition-ore');
    assert.equal(canonical.status, 200); assert.equal(alias.status, 200); assert.deepEqual(alias.json, canonical.json);
    const expected = baseline.oreLegacyReferences.map(row => ({ path: row.path, jsonPointer: row.jsonPointer, quantity: row.quantity, legacy: true, direction: row.jsonPointer.includes('publicDrops') || row.jsonPointer.includes('presetExpeditionDrop') ? 'source' : row.jsonPointer.includes('itemMappings') ? 'mapping' : 'usage' }));
    expected.push({ path: 'items/eq_patrol_sword.json', jsonPointer: '/equipment/enhancement/0/materials/0/itemId', quantity: 3, legacy: false, direction: 'usage' });
    assert.deepEqual(positions(canonical.json), positions(expected));
    const refused = await unchanged(content, () => api('/api/content/item/expedition_ore', 'DELETE'));
    assert.equal(refused.status, 409); assert.equal(refused.json.code, 'referenced'); assert.deepEqual(refused.json.refs, canonical.json);
    const refsCli = await call('refs', 'expedition-ore', '--content', content); assert.equal(refsCli.exitCode, 0); assert.deepEqual(refsCli.json, canonical.json);
    return { refs: canonical.json.length, source: canonical.json.filter(row => row.direction === 'source').length, usage: canonical.json.filter(row => row.direction === 'usage').length };
  });
  await phase('B3.api-pure-validation-and-fresh-preconditions', async () => {
    const initial = await getAndVerifyEtag('expedition_ore');
    const duplicate = await unchanged(content, () => api('/api/validate-item', 'POST', { entity: initial.json, mode: 'create' })); require422(duplicate);
    const holder = bareItem('mat_alias_owner'); holder.aliases = ['mat_alias_reserved']; await newItem(holder);
    const aliasCollision = await unchanged(content, () => api('/api/validate-item', 'POST', { entity: bareItem('mat_alias_reserved'), mode: 'create' })); require422(aliasCollision);
    const invalid = bareItem('Bad-ID'); require422(await unchanged(content, () => api('/api/validate-item', 'POST', { entity: invalid, mode: 'create' })));
    require422(await unchanged(content, () => api('/api/content/item/Bad-ID', 'PUT', invalid, { 'If-None-Match': '*' })));
    const wrongId = structuredClone(initial.json); wrongId.id = 'mat_changed_id';
    require422(await unchanged(content, () => api('/api/content/item/expedition_ore', 'PUT', wrongId, { 'If-Match': initial.response.headers.etag })), '/id');
    const negative = structuredClone(initial.json); negative.baseValue = -1;
    require422(await unchanged(content, () => api('/api/content/item/expedition_ore', 'PUT', negative, { 'If-Match': initial.response.headers.etag })), '/baseValue');
    const fraction = structuredClone(initial.json); fraction.stackLimit = 1.5;
    require422(await unchanged(content, () => api('/api/validate-item', 'POST', { entity: fraction, mode: 'update' })), '/stackLimit');
    const nestedCases = [];
    for (const location of ['equipment', 'bonus', 'enhancement', 'material', 'consumable', 'effect']) {
      const entity = bareItem(`eq_unknown_${location}`, location === 'effect' || location === 'consumable' ? 'consumable' : 'equipment');
      entity.equipment.combatBonus = entity.category === 'equipment' ? [{ id: 'equipmentDamageBonus', value: 1 }] : [];
      entity.equipment.enhancement = entity.category === 'equipment' ? [{ level: 1, cash: 0, attackBonusDelta: 1, materials: [{ itemId: 'expedition_ore', quantity: 1 }] }] : [];
      let field; let requests = [];
      if (location === 'equipment') { entity.equipment.unexpectedProbe = true; field = '/equipment/unexpectedProbe'; }
      if (location === 'bonus') { entity.equipment.combatBonus[0].unexpectedProbe = true; field = '/equipment/combatBonus/0/unexpectedProbe'; }
      if (location === 'enhancement') { entity.equipment.enhancement[0].unexpectedProbe = true; field = '/equipment/enhancement/0/unexpectedProbe'; }
      if (location === 'material') { entity.equipment.enhancement[0].materials[0].unexpectedProbe = true; field = '/equipment/enhancement/0/materials/0/unexpectedProbe'; }
      if (location === 'consumable') { entity.consumable.unexpectedProbe = true; field = '/consumable/unexpectedProbe'; }
      if (location === 'effect') { entity.draft = true; entity.consumable.effects = [{ kind: 'restore_hunger', note: 'isolated schema probe', unexpectedProbe: true }]; field = '/consumable/effects/0/unexpectedProbe'; requests = [{ kind: 'new_item_property', owner: 'engineering', title: 'isolated nested-schema probe', body: 'Only an isolated acceptance fixture.' }]; }
      require422(await unchanged(content, () => api('/api/validate-item', 'POST', { entity, mode: 'create', requests })), field);
      require422(await unchanged(content, () => api(`/api/content/item/${entity.id}`, 'PUT', { entity, requests }, { 'If-None-Match': '*' })), field);
      nestedCases.push(field);
    }
    require422(await unchanged(content, () => api('/api/content/skill/skill_bad_version', 'PUT', { schemaVersion: 2, id: 'skill_bad_version', aliases: [] }, { 'If-None-Match': '*' })), '/schemaVersion');
    require422(await unchanged(content, () => api('/api/content/skill/skill_missing_version', 'PUT', { id: 'skill_missing_version', aliases: [] }, { 'If-None-Match': '*' })));
    const validScenario = await readJson(path.join(repository, 'Game/Assets/StreamingAssets/Prototype/Combat/default.json'));
    validScenario.schemaVersion = 1; // Required content-envelope metadata, absent from the original Runtime-only sample.
    validScenario.id = 'scenario_runtime_probe';
    const savedScenario = await api('/api/content/scenario/scenario_runtime_probe', 'PUT', validScenario, { 'If-None-Match': '*' }); assert.equal(savedScenario.status, 201);
    const scenarioEtag = savedScenario.response.headers.etag;
    assert.equal(scenarioEtag, `"${sha256(await readFile(path.join(content, 'scenarios/scenario_runtime_probe.json')))}"`);
    const invalidScenario = structuredClone(validScenario); invalidScenario.units = [];
    require422(await unchanged(content, () => api('/api/content/scenario/scenario_runtime_probe', 'PUT', invalidScenario, { 'If-Match': scenarioEtag })));
    invalidScenario.id = 'scenario_invalid_runtime';
    require422(await unchanged(content, () => api('/api/content/scenario/scenario_invalid_runtime', 'PUT', invalidScenario, { 'If-None-Match': '*' })));
    const validAgain = await api('/api/content/scenario/scenario_runtime_probe', 'PUT', validScenario, { 'If-Match': scenarioEtag }); assert.equal(validAgain.status, 200);
    await writeJson(path.join(content, 'skills/skill_pool_owner.json'), { schemaVersion: 1, id: 'skill_pool_owner', aliases: ['mat_cross_reserved'], effectKind: 'damage', magnitude: 1, mpCost: 0, baseWait: 1, draft: false });
    require422(await unchanged(content, () => api('/api/validate-item', 'POST', { entity: bareItem('mat_cross_reserved'), mode: 'create' })));
    const crossAlias = bareItem('mat_cross_alias'); crossAlias.aliases = ['skill_pool_owner'];
    require422(await unchanged(content, () => api('/api/validate-item', 'POST', { entity: crossAlias, mode: 'create' })));
    const updateSelf = await unchanged(content, () => api('/api/validate-item', 'POST', { entity: initial.json, mode: 'update' })); assert.equal(updateSelf.status, 200);
    const exists = await unchanged(content, () => api('/api/content/item/expedition_ore', 'PUT', initial.json, { 'If-None-Match': '*' }));
    assert.equal(exists.status, 409); assert.equal(exists.json.code, 'already_exists'); assert.deepEqual(exists.json.current, initial.json); assert.equal(exists.json.etag, initial.response.headers.etag);
    const stale = await unchanged(content, () => api('/api/content/item/expedition_ore', 'PUT', initial.json, { 'If-Match': '"0000000000000000000000000000000000000000000000000000000000000000"' }));
    assert.equal(stale.status, 409); assert.equal(stale.json.code, 'etag_conflict'); assert.equal(stale.response.headers.etag, initial.response.headers.etag);
    const cors = await api('/api/content/item/expedition_ore', 'GET', undefined, { Origin: 'http://127.0.0.1:5176' }); assert.match(cors.response.headers['access-control-expose-headers'] ?? '', /etag/i);
    const preflight = await api('/api/content/item/expedition_ore', 'OPTIONS', undefined, { Origin: 'http://127.0.0.1:5176', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'if-match,if-none-match,content-type' });
    assert.equal(preflight.status, 204); assert.match(preflight.response.headers['access-control-allow-headers'] ?? '', /if-match/i); assert.match(preflight.response.headers['access-control-allow-headers'] ?? '', /if-none-match/i);
    return { pureValidation422: true, putPrecondition409: true, selfUpdateExclusion: true, crossTypePool: true, etagIsPhysicalFileSha256: true, nestedUnknownFieldsRefusedWithoutWrites: nestedCases };
  });
  await phase('B6.api-atomic-draft-request-and-alias-target', async () => {
    await newItem(bareItem(independentDraftId, 'consumable'));
    const draftBase = await getAndVerifyEtag(independentDraftId);
    const entity = structuredClone(draftBase.json); entity.draft = true; entity.consumable.effects = [{ kind: 'restore_hunger', note: '仅隔离验收，尚未实现。' }];
    require422(await unchanged(content, () => api(`/api/content/item/${independentDraftId}`, 'PUT', { entity, requests: [] }, { 'If-Match': draftBase.response.headers.etag })));
    const invalidRequest = { kind: 'new_item_property', owner: 'engineering', title: '', body: 'P1只登记，不实现效果。' };
    require422(await unchanged(content, () => api(`/api/content/item/${independentDraftId}`, 'PUT', { entity, requests: [invalidRequest] }, { 'If-Match': draftBase.response.headers.etag })));
    const request = { kind: 'new_item_property', owner: 'engineering', title: '恢复饥饿', body: 'P1只登记，不实现效果。', expected: '待专项另行确认', field: 'consumable.effects' };
    const saved = await api(`/api/content/item/${independentDraftId}`, 'PUT', { entity, requests: [request] }, { 'If-Match': draftBase.response.headers.etag });
    assert.equal(saved.status, 200); assert.equal(saved.json.entity.draft, true); assert.equal(saved.json.createdRequests.length, 1);
    const created = saved.json.createdRequests[0]; assert.equal(created.target, `item:${independentDraftId}`); assert.equal(created.owner, 'engineering'); assert.equal(created.status, 'open');
    assert.deepEqual(await readJson(itemPath(independentDraftId)), saved.json.entity); assert.deepEqual(await readJson(path.join(content, '_requests', `${created.id}.json`)), created);
    const markdown = await readFile(path.join(content, 'REQUESTS.md'), 'utf8');
    const engineering = markdown.split('## engineering\n')[1]?.split('\n## ')[0] ?? '';
    assert.ok(engineering.includes(`${created.id} — 恢复饥饿`), 'Created request must appear in the engineering group.');
    const aliasRequest = await api('/api/requests', 'POST', { kind: 'note', owner: 'engineering', target: 'item:expedition-ore', title: 'alias target isolated acceptance' }); assert.equal(aliasRequest.status, 201);
    const validate = await api('/api/validate-content', 'POST', {}); assert.equal(validate.status, 200); assert.equal(validate.json.ok, true);
    const scenario = await readJson(path.join(repository, 'Game/Assets/StreamingAssets/Prototype/Combat/round2_equipment.json'));
    scenario.units[0].equipmentSourceId = independentDraftId;
    const trial = await unchanged(content, () => api('/api/run-combat', 'POST', scenario)); assert.equal(trial.status, 422);
    const draftMaterial = bareItem('mat_draft_dependency'); draftMaterial.draft = true; await newItem(draftMaterial);
    const indirect = bareItem('eq_active_dependency', 'equipment'); indirect.equipment.enhancement = [{ level: 1, cash: 0, attackBonusDelta: 1, materials: [{ itemId: draftMaterial.id, quantity: 1 }] }]; await newItem(indirect);
    scenario.units[0].equipmentSourceId = indirect.id;
    const indirectTrial = await unchanged(content, () => api('/api/run-combat', 'POST', scenario)); assert.equal(indirectTrial.status, 422);
    const deleteActive = await api(`/api/content/item/${indirect.id}`, 'DELETE'); assert.equal(deleteActive.status, 200);
    const deleteDraft = await api(`/api/content/item/${draftMaterial.id}`, 'DELETE'); assert.equal(deleteDraft.status, 200);
    const originalScenario = await readJson(path.join(repository, 'Game/Assets/StreamingAssets/Prototype/Combat/round2_equipment.json'));
    const legacyLabels = await unchanged(content, () => api('/api/run-combat', 'POST', originalScenario)); assert.equal(legacyLabels.status, 200);
    return { requestId: created.id, target: created.target, atomicInvalidBundleUnchanged: true, aliasTargetAccepted: true, registeredDraftTrialRefused: true, indirectDraftDependencyTrialRefused: true, legacyUnregisteredTrainingTagsStillAccepted: true };
  });
  await phase('B7.real-export-determinism-metadata-and-whole-directory-atomicity', async () => {
    const annotatedOre = await readJson(itemPath('expedition_ore'));
    annotatedOre.notes = { text: '仅编辑源的说明，不得进入运行时。', nested: ['private editor metadata'] };
    await saveFixtureItem(content, annotatedOre);
    const sentinel = Buffer.from([0x53, 0x0d, 0x0a, 0xff, 0x00]);
    await writeFile(path.join(runtime, 'unrelated.bin'), sentinel);
    await writeFile(path.join(runtime, 'items.json.meta'), 'fileFormatVersion: 2\nguid: 11111111111111111111111111111111\n');
    await checkExport(content, runtime);
    const firstItems = await readJson(path.join(runtime, 'items.json'));
    assert.equal(firstItems.items.some(item => item.id === independentDraftId), false);
    assert.ok(firstItems.items.some(item => item.id === 'con_simple_meal'));
    assert.deepEqual(firstItems.items.map(item => item.id).sort(), [...baseline.items.map(item => item.id), 'mat_alias_owner'].sort());
    assert.ok(firstItems.items.some(item => item.id === 'eq_patrol_sword'));
    const manifestPath = path.join(runtime, 'manifest.json'); const oldManifest = await readJson(manifestPath);
    const retired = Buffer.from('{"schemaVersion":1,"retired":true}\n');
    await writeFile(path.join(runtime, 'retired-p1.json'), retired); await writeFile(path.join(runtime, 'retired-p1.json.meta'), 'do not remove this meta\n');
    oldManifest.files.push({ path: 'retired-p1.json', sha256: sha256(retired), count: 0 });
    oldManifest.contentHash = sha256(Buffer.from([...oldManifest.files].sort((a, b) => a.path < b.path ? -1 : 1).map(file => `${file.path}\n${file.sha256}\n`).join('')));
    await writeJson(manifestPath, oldManifest);
    await checkExport(content, runtime);
    assert.equal((await readdir(runtime)).includes('retired-p1.json'), false); assert.equal((await readdir(runtime)).includes('retired-p1.json.meta'), true); assert.deepEqual(await readFile(path.join(runtime, 'unrelated.bin')), sentinel);
    const beforeRepeat = await snapshotFiles(runtime); await checkExport(content, runtime); assert.deepEqual(await snapshotFiles(runtime), beforeRepeat);
    const invalid = bareItem('con_invalid_draft', 'consumable'); invalid.draft = true; invalid.consumable.effects = [{ kind: 'unsupported', note: 'missing required request' }];
    await saveFixtureItem(content, invalid);
    const badExport = await unchanged(runtime, () => call('export', '--content', content, '--out', runtime)); assert.equal(badExport.exitCode, 1);
    const badHttp = await unchanged(runtime, () => api('/api/export', 'POST', {})); require422(badHttp);
    await unlink(itemPath(invalid.id));
    const active = bareItem('eq_active_ref_draft', 'equipment'); active.equipment.enhancement = [{ level: 1, cash: 0, attackBonusDelta: 1, materials: [{ itemId: independentDraftId, quantity: 1 }] }];
    await saveFixtureItem(content, active);
    const dangling = await unchanged(runtime, () => call('export', '--content', content, '--out', runtime)); assert.equal(dangling.exitCode, 1);
    await unlink(itemPath(active.id));
    await checkExport(content, runtime);
    assert.deepEqual(await snapshotFiles(runtime), beforeRepeat);
    const exportedHttp = await api('/api/export', 'POST', {}); assert.equal(exportedHttp.status, 200); assert.equal(exportedHttp.json.ok, true); assert.equal(path.resolve(exportedHttp.json.exportRoot), runtime);
    assert.deepEqual(await snapshotFiles(runtime), beforeRepeat);
    return { repeatedExportSnapshot: beforeRepeat, validDraftExcludedWithoutGlobalBlock: true, invalidDraftAndActiveDraftReferenceRefused: true, staleManagedRemovedAndMetaPreserved: true };
  });
  await phase('B8.input-preparation-only-not-Unity-execution', async () => {
    const root = path.join(work, 'b8-content'); const target = path.join(work, 'b8-runtime');
    await cp(path.join(repository, 'content'), root, { recursive: true, errorOnExist: true, force: false });
    const probe = bareItem('eq_verify_all_fields', 'equipment');
    Object.assign(probe, { aliases: ['verify-sword-v1', 'verify-sword-v2'], name: '全字段校验：剑 Ω', description: '只在隔离数据：中文、引号"、换行\n第二行。', icon: 'isolated/icons/p1-probe.png', baseValue: 2147483647, tags: ['verify', '中文标签', 'quote"'] });
    probe.equipment.combatBonus = [{ id: 'equipmentDamageBonus', value: 7 }];
    probe.equipment.enhancement = [{ level: 1, cash: 11, attackBonusDelta: 3, materials: [{ itemId: 'expedition_ore', quantity: 5 }, { itemId: 'quenching-sand', quantity: 7 }] }, { level: 2, cash: 13, attackBonusDelta: 5, materials: [{ itemId: 'expedition-ore', quantity: 11 }] }];
    await saveFixtureItem(root, probe);
    for (const [id, category] of [['cur_verify', 'currency'], ['key_verify', 'key'], ['con_verify_plain', 'consumable']]) await saveFixtureItem(root, bareItem(id, category));
    const validation = await call('validate', '--content', root); assert.equal(validation.exitCode, 0);
    await checkExport(root, target);
    const plan = { status: 'PreparedOnly', sourceContentRoot: root, itemsInput: path.join(target, 'items.json'), inputSha256: sha256(await readFile(path.join(target, 'items.json'))), sourceSnapshot: await snapshotFiles(root), note: 'Root must separately review/schedule the controlled P1 Unity launcher. This is not B8 acceptance.' };
    await writeJson(path.join(output, 'B8_INPUT_PLAN.json'), plan); return plan;
  });
} catch (error) {
  failure = { message: error.message, stack: error.stack };
} finally {
  if (service) {
    try {
      if (service.child.exitCode === null && services.length) { const endIdentity = await serviceIdentity('service-identity-before-stop'); assert.equal(endIdentity.startedAtUtc, services[0].startedAtUtc); assert.equal(endIdentity.owner, services[0].owner); }
    } catch (error) { failure ??= { message: `Owned service identity before cleanup: ${error.message}`, stack: error.stack }; }
    finally {
      try { const receipt = await service.stop(); const { stdoutBytes, stderrBytes, ...saved } = receipt; stoppedReceipt = saved; }
      catch (error) { failure ??= { message: `Retained owned service cleanup: ${error.message}`, stack: error.stack }; }
    }
  }
  const unchangedOriginals = compareTrees(identity.oldPrototype, await snapshotFiles(path.join(repository, 'Game/Assets/StreamingAssets/Prototype')));
  const unchangedSourceContent = compareTrees(identity.sourceContent, await snapshotFiles(path.join(repository, 'content')));
  if (unchangedOriginals.length || unchangedSourceContent.length) failure ??= { message: 'Authoritative original source/config changed during isolated acceptance.', unchangedOriginals, unchangedSourceContent };
  const summary = { schemaVersion: 1, passed: !failure && checks.every(check => check.passed), scope: 'Independent real CLI/HTTP backend subset of B1-B7. UI and actual Unity remain separate; B8 entry here only prepares frozen inputs.', identity, isolated: { work, content, runtime, port }, checks, failure, services, stoppedService: stoppedReceipt, commands, http };
  await writeJson(path.join(output, 'BACKEND_ACCEPTANCE.json'), summary);
  process.stdout.write(`${JSON.stringify({ passed: summary.passed, checks: checks.length, failure: failure?.message ?? null, evidence: output })}\n`);
  process.exitCode = summary.passed ? 0 : 1;
}
