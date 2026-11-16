import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { compareTrees, runtimeProjection } from './json-assertions.mjs';
import { requestRecorded, runRecorded, sha256, snapshotFiles, startRecorded, verifySavedBytes, writeJson } from './raw-evidence.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '../..');
const args = {};
for (let index = 2; index < process.argv.length; index += 2) {
  if (!['--dotnet', '--cli', '--output', '--work', '--pwsh', '--browser-exe', '--only', '--frontend-manifest'].includes(process.argv[index]) || !process.argv[index + 1]) throw new Error(`Invalid argument ${process.argv[index]}`);
  args[process.argv[index]] = process.argv[index + 1];
}
for (const key of ['--dotnet', '--cli', '--output', '--work', '--pwsh', '--browser-exe']) if (!args[key]) throw new Error(`Missing ${key}`);
const output = path.resolve(args['--output']); const work = path.resolve(args['--work']);
if (!output.startsWith(`${path.join(repository, 'outputs')}${path.sep}`) || !work.startsWith(`${path.join(repository, 'work')}${path.sep}`)) throw new Error('Use isolated workspace work and outputs roots.');
await mkdir(output, { recursive: false }); await mkdir(work, { recursive: false });
const content = path.join(work, 'content'); const runtime = path.join(work, 'runtime'); const temporary = path.join(work, 'temp');
await cp(path.join(repository, 'content'), content, { recursive: true, force: false, errorOnExist: true }); await mkdir(temporary);
const dotnet = path.resolve(args['--dotnet']); const cli = path.resolve(args['--cli']);
const frontendUrl = 'http://127.0.0.1:5176'; const backendUrl = 'http://127.0.0.1:5186';
const selected = args['--only'] ? new Set(args['--only'].split(',')) : null;
const minimalFocus = selected?.size === 1 && selected.has('B3-focus');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const itemPath = id => path.join(content, 'items', `${id}.json`);
const bareItem = (id, category = 'material') => ({ schemaVersion: 1, id, aliases: [], name: `隔离验收 ${id}`, category, description: '仅在隔离验收副本使用，不构成真实内容或需求。', icon: '', stackLimit: category === 'equipment' ? 1 : 99, baseValue: 0, tags: ['verification_fixture'], equipment: { slot: category === 'equipment' ? 'weapon' : '', combatBonus: [], enhancement: [] }, consumable: { effects: [] }, draft: false });
const categories = ['material', 'equipment', 'consumable', 'currency', 'key'];
const prefixes = ['mat_', 'eq_', 'con_', 'cur_', 'key_'];
for (let index = 1; index <= (minimalFocus ? 0 : 55); index++) {
  const group = (index - 1) % 5; const id = `${prefixes[group]}verify_${String(index).padStart(3, '0')}`;
  const item = bareItem(id, categories[group]); item.name = `隔离样本 ${String(index).padStart(3, '0')}`; item.baseValue = index;
  if (index === 1) item.aliases = ['mat_alias_reserved', 'legacy-ui-probe'];
  if (index === 3) { item.draft = true; item.consumable.effects = [{ kind: 'restore_hunger', note: '仅验证紫色虚线状态。' }]; }
  await writeJson(itemPath(id), item);
}
if (!minimalFocus) await writeJson(path.join(content, '_requests/REQ-8001.json'), { schemaVersion: 1, id: 'REQ-8001', kind: 'new_item_property', owner: 'engineering', target: 'item:con_verify_003', field: 'consumable.effects', title: '隔离数据的待实现标记', body: '仅供验收；不是实际需求，不授权实现能力。', expected: '', status: 'open', createdAt: '', resolvedBy: '' });
const sourceFiles = async () => [...(await snapshotFiles(path.join(repository, 'tools/editor-web/src'))).map(row => ({ ...row, path: `src/${row.path}` })), ...await Promise.all(['package.json', 'package-lock.json', 'vite.config.ts', 'tailwind.config.js'].map(async file => ({ path: file, sha256: sha256(await readFile(path.join(repository, 'tools/editor-web', file))) })))];
const identity = { baseline: '84ed464d12fec3291f0cdd237dd9c4b70f37062d', cli: { path: cli, sha256: sha256(await readFile(cli)) }, contractSha256: sha256(await readFile(path.join(repository, 'docs/editor/P1_API_CONTRACT.md'))), frontendSourceFiles: await sourceFiles(), authoritativeContent: await snapshotFiles(path.join(repository, 'content')), oldPrototype: await snapshotFiles(path.join(repository, 'Game/Assets/StreamingAssets/Prototype')) };
identity.frontendSourceHash = sha256(Buffer.from(JSON.stringify(identity.frontendSourceFiles)));
identity.frontendSourceHashAlgorithm = 'SHA256 of UTF-8 JSON.stringify(frontendSourceFiles) in recorded order; includes byte lengths on src entries, distinct from owner aggregation.';
if (args['--frontend-manifest']) {
  const manifest = await readJson(path.resolve(args['--frontend-manifest']));
  for (const file of manifest.files) assert.equal(sha256(await readFile(path.join(repository, file.path))), file.sha256, `Frozen frontend handoff differs: ${file.path}`);
  identity.frontendOwnerHandoff = { path: path.resolve(args['--frontend-manifest']), sourceHash: manifest.canonicalSourceHash ?? manifest.sourceHash, sourceHashAlgorithm: manifest.canonicalSourceHash ? 'Owner canonical unique product-file path + LF + sha256 + LF; verification stage files are also physically checked below' : 'Owner original-order path + LF + sha256 + LF, preserving original duplicate entries', canonicalProductFileCount: manifest.canonicalUniquePaths ?? null, entryCount: manifest.files.length, uniqueFileCount: new Set(manifest.files.map(file => file.path)).size, changedUniquePaths: manifest.changedUniquePaths ?? null, files: manifest.files };
}
const checks = []; const events = []; const network = []; const pendingNetwork = []; const consoleMessages = []; const serviceRecords = []; const screenshots = [];
let backend; let frontend; let browser; let context; let page; let failure = null; let apiNumber = 0; let networkNumber = 0; let backendNumber = 0; let navigations = 0; let documentRequests = 0;
const record = (action, details = {}) => events.push({ utc: new Date().toISOString(), action, ...details });
async function phase(id, action) {
  if (selected && !selected.has(id)) { checks.push({ id, status: 'NotRun' }); return; }
  record('phase-start', { id });
  try { const evidence = await action(); checks.push({ id, status: 'Passed', evidence: evidence ?? null }); record('phase-end', { id, status: 'Passed' }); }
  catch (error) { checks.push({ id, status: 'Failed', error: error.message, stack: error.stack }); record('phase-end', { id, status: 'Failed' }); throw error; }
}
async function api(route, method = 'GET', body, headers = {}) {
  const result = await requestRecorded({ baseUrl: backendUrl, route, method, body, headers, prefix: path.join(output, 'direct-http', `${String(++apiNumber).padStart(3, '0')}-${method}-${route.replaceAll(/[^a-z0-9_-]/gi, '_')}`) });
  return { ...result, status: result.response.status };
}
async function portFree(port) {
  await new Promise((resolve, reject) => { const socket = net.connect({ host: '127.0.0.1', port }); socket.once('connect', () => { socket.destroy(); reject(new Error(`Port ${port} is already owned; no process was stopped.`)); }); socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error)); });
}
async function metadata(service, name) {
  const receipt = await runRecorded({ executable: args['--pwsh'], args: ['-NoProfile', '-File', path.join(here, 'owned-process.ps1'), '-OwnedProcessId', String(service.child.pid)], cwd: repository, prefix: path.join(output, name), timeoutMs: 10000 });
  await verifySavedBytes(receipt); assert.equal(receipt.exitCode, 0);
  const value = JSON.parse(receipt.stdoutBytes.toString('utf8')); assert.equal(value.processId, service.child.pid); assert.equal(value.parentProcessId, process.pid); return value;
}
async function startBackend() {
  await portFree(5186); const number = ++backendNumber;
  const service = await startRecorded({ executable: dotnet, args: [cli, 'serve', '--port', '5186', '--content', content, '--export-out', runtime], cwd: repository, prefix: path.join(output, `backend-${number}`), env: { DOTNET_CLI_TELEMETRY_OPTOUT: '1' } });
  const value = await metadata(service, `backend-${number}-identity`); assert.equal(path.resolve(value.executablePath).toLowerCase(), dotnet.toLowerCase()); assert.ok(value.commandLine.includes(content));
  serviceRecords.push({ role: 'backend', number, ...value }); backend = service;
  for (let attempt = 0; attempt < 50; attempt++) { const health = await api('/api/health'); if (health.status === 200) { assert.equal(path.resolve(health.json.contentRoot), content); assert.equal(path.resolve(health.json.exportRoot), runtime); return; } await sleep(100); }
  throw new Error('Owned backend readiness timed out.');
}
async function stopBackend() {
  const before = await metadata(backend, `backend-${backendNumber}-identity-before-stop`);
  const first = serviceRecords.find(value => value.role === 'backend' && value.number === backendNumber); assert.equal(before.startedAtUtc, first.startedAtUtc); assert.equal(before.owner, first.owner);
  const receipt = await backend.stop(); const { stdoutBytes, stderrBytes, ...saved } = receipt; await writeJson(path.join(output, `backend-${backendNumber}-stopped.json`), saved); backend = null;
}
async function waitFile(id, predicate) {
  for (let attempt = 0; attempt < 100; attempt++) { try { const item = await readJson(itemPath(id)); if (predicate(item)) return item; } catch {} await sleep(100); }
  throw new Error(`Expected actual file state not reached: ${id}`);
}
async function preserveItem(id, name) {
  const bytes = await readFile(itemPath(id)); const destination = path.join(output, 'disk-evidence', `${name}.json`); await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, bytes); return { path: destination, sha256: sha256(bytes), value: JSON.parse(bytes.toString('utf8')) };
}
async function openItem(id) { await page.goto(`${frontendUrl}/#/items/${id}`); await page.getByTestId('item-detail').waitFor(); await page.locator('#field-id').waitFor(); await page.waitForFunction(expected => document.querySelector('#field-id')?.value === expected, id); }
async function discardAndClose() {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"]') || !document.querySelector('[data-testid="item-detail"]'));
  const dialog = page.getByRole('dialog', { name: '有未保存的修改' });
  if (await dialog.isVisible().catch(() => false)) await dialog.getByRole('button', { name: '放弃并离开' }).click();
}
async function saveWithKeyboard() { record('keyboard', { key: 'Control+s' }); await page.keyboard.press('Control+s'); }
async function screenshot(name) { const file = path.join(output, `${name}.png`); await page.screenshot({ path: file, fullPage: false }); const bytes = await readFile(file); screenshots.push({ name, path: file, sha256: sha256(bytes) }); return file; }
async function loadedNoto() {
  const state = await page.evaluate(async () => { await document.fonts.ready; return { faces: [...document.fonts].filter(face => face.family.includes('Noto Sans SC')).map(face => ({ family: face.family, status: face.status, style: face.style, weight: face.weight })), cjkCheck: document.fonts.check('400 13px "Noto Sans SC"', '出征矿料'), computedBodyFamily: getComputedStyle(document.body).fontFamily }; });
  assert.ok(state.faces.length > 0 && state.faces.every(face => face.status === 'loaded'), 'fonts.ready is not sufficient: every declared Noto face must actually be loaded.'); assert.equal(state.cjkCheck, true); return state;
}
async function waitNetwork(predicate, from = 0) {
  for (let attempt = 0; attempt < 100; attempt++) { const match = network.slice(from).find(predicate); if (match) return match; await sleep(50); }
  throw new Error('Expected actual browser HTTP response was not captured.');
}
async function waitValidationError(field, from) {
  for (let attempt = 0; attempt < 100; attempt++) {
    for (const row of network.slice(from).filter(row => row.status === 422 && new URL(row.url).pathname === '/api/validate-item')) {
      const body = await readJson(row.response.path); const error = body.errors?.find(error => error.field === field); if (error) return { row, error };
    }
    await sleep(50);
  }
  throw new Error(`Expected original server validation at ${field} was not captured.`);
}
const putFor = (id, status) => row => row.method === 'PUT' && row.status === status && new URL(row.url).pathname === `/api/content/item/${id}`;
function journalResponse(response) {
  if (!response.url().startsWith(`${frontendUrl}/api/`)) return;
  const task = (async () => {
    const request = response.request(); const requestBytes = request.postDataBuffer() ?? Buffer.alloc(0); const responseBytes = await response.body();
    const prefix = path.join(output, 'browser-http', `${String(++networkNumber).padStart(4, '0')}-${request.method()}-${new URL(response.url()).pathname.replaceAll(/[^a-z0-9_-]/gi, '_')}`);
    await mkdir(path.dirname(prefix), { recursive: true }); await writeFile(`${prefix}.request`, requestBytes); await writeFile(`${prefix}.response`, responseBytes);
    const row = { utc: new Date().toISOString(), url: response.url(), method: request.method(), requestHeaders: await request.allHeaders(), responseHeaders: await response.allHeaders(), status: response.status(), request: { path: `${prefix}.request`, bytes: requestBytes.length, sha256: sha256(requestBytes) }, response: { path: `${prefix}.response`, bytes: responseBytes.length, sha256: sha256(responseBytes) } };
    await writeJson(`${prefix}.http.json`, row); network.push(row);
  })().catch(error => record('network-journal-error', { url: response.url(), message: error.message })); pendingNetwork.push(task);
}

// Product/browser phases are intentionally below setup, not mocks or store calls.
try {
  const validation = await runRecorded({ executable: dotnet, args: [cli, 'validate', '--content', content], cwd: repository, prefix: path.join(output, 'fixture-validate'), timeoutMs: 30000 }); assert.equal(validation.exitCode, 0); await verifySavedBytes(validation);
  const requestSummary = await runRecorded({ executable: dotnet, args: [cli, 'requests', '--content', content], cwd: repository, prefix: path.join(output, 'fixture-requests'), timeoutMs: 30000 }); assert.equal(requestSummary.exitCode, 0); await verifySavedBytes(requestSummary);
  assert.equal((await readdir(path.join(content, 'items'))).filter(file => file.endsWith('.json')).length, minimalFocus ? 5 : 60);
  await startBackend(); await portFree(5176);
  frontend = await startRecorded({ executable: process.execPath, args: [path.join(here, 'frontend-dev.mjs'), path.join(work, 'vite-cache')], cwd: path.join(repository, 'tools/editor-web'), prefix: path.join(output, 'frontend') }); serviceRecords.push({ role: 'frontend', ...await metadata(frontend, 'frontend-identity') });
  for (let attempt = 0; attempt < 100; attempt++) { try { if ((await fetch(frontendUrl)).status === 200) break; } catch {} if (attempt === 99) throw new Error('Owned Vite readiness timed out.'); await sleep(100); }
  const require = createRequire(import.meta.url); const { chromium } = require(path.join(repository, 'tools/editor-web/node_modules/playwright'));
  browser = await chromium.launch({ executablePath: args['--browser-exe'], headless: true, env: { ...process.env, TEMP: temporary, TMP: temporary }, args: ['--no-first-run', '--no-default-browser-check'] });
  context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'zh-CN', colorScheme: 'light', permissions: ['clipboard-read', 'clipboard-write'] });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  page = await context.newPage(); page.setDefaultTimeout(10000); page.on('response', journalResponse); page.on('console', message => consoleMessages.push({ type: message.type(), text: message.text() })); page.on('pageerror', error => consoleMessages.push({ type: 'pageerror', text: error.message })); page.on('framenavigated', frame => { if (frame === page.mainFrame()) { navigations++; record('frame-navigation-including-same-document', { url: frame.url() }); } }); page.on('request', request => { if (request.isNavigationRequest() && request.resourceType() === 'document') { documentRequests++; record('document-request', { url: request.url() }); } }); page.on('dialog', dialog => { record('unexpected-native-dialog', { type: dialog.type(), message: dialog.message() }); void dialog.dismiss(); });

  await phase('B11', async () => {
    await openItem('expedition_ore'); const fontState = await loadedNoto();
    await page.getByTestId('item-row-expedition_ore').waitFor({ state: 'visible' });
    assert.equal((await api('/api/content/item')).json.length, 60);
    const metrics = [];
    for (const [width, height] of [[1280, 800], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      for (const theme of ['light', 'dark']) {
        if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'dark' ? '切换暗色主题' : '切换亮色主题' }).click();
        await page.evaluate(async () => { await document.fonts.ready; }); await sleep(200);
        const measurement = await page.evaluate(() => {
          const main = document.querySelector('.items-main'); const detail = document.querySelector('.detail-panel'); const scroll = document.querySelector('.table-scroll');
          const rect = element => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom }; };
          return { viewport: { width: innerWidth, height: innerHeight }, page: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth }, main: rect(main), detail: rect(detail), selectedRow: rect(document.querySelector('[data-testid="item-row-expedition_ore"]')), tableHeaderBottom: document.querySelector('.item-table thead').getBoundingClientRect().bottom, scroll: { ...rect(scroll), clientWidth: scroll.clientWidth, scrollWidth: scroll.scrollWidth, clientHeight: scroll.clientHeight, scrollHeight: scroll.scrollHeight, overflowX: getComputedStyle(scroll).overflowX, overflowY: getComputedStyle(scroll).overflowY }, theme: document.documentElement.dataset.theme, count: document.querySelector('.page-heading .count')?.textContent };
        });
        assert.equal(measurement.count, '60'); assert.ok(measurement.page.scrollWidth <= width && measurement.page.bodyScrollWidth <= width); assert.ok(measurement.main.right <= measurement.detail.x + 1); assert.equal(Math.round(measurement.detail.width), 360); assert.ok(measurement.scroll.scrollHeight > measurement.scroll.clientHeight); assert.match(measurement.scroll.overflowY, /auto|scroll/); assert.ok(measurement.selectedRow.y >= measurement.tableHeaderBottom - 1 && measurement.selectedRow.bottom <= measurement.scroll.bottom + 1, 'Selected ore row must be within its own table viewport.');
        await screenshot(`B11-${width}x${height}-${theme}`); metrics.push(measurement);
      }
    }
    const scrollBefore = await page.locator('.table-scroll').evaluate(element => ({ top: element.scrollTop, pageY: scrollY })); await page.locator('.table-scroll').hover(); await page.mouse.wheel(0, 400); await sleep(200); const scrollAfter = await page.locator('.table-scroll').evaluate(element => ({ top: element.scrollTop, pageY: scrollY })); assert.ok(scrollAfter.top > scrollBefore.top); assert.equal(scrollAfter.pageY, scrollBefore.pageY);
    await openItem('con_verify_003'); assert.equal(await page.locator('.detail-panel .badge.pending').first().evaluate(element => getComputedStyle(element).borderTopStyle), 'dashed');
    await page.setViewportSize({ width: 1024, height: 800 }); await sleep(200);
    const narrow = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, detailPosition: getComputedStyle(document.querySelector('.detail-panel')).position }));
    assert.ok(narrow.scrollWidth <= 1024 && narrow.bodyScrollWidth <= 1024); assert.equal(narrow.detailPosition, 'absolute');
    await page.keyboard.press('Escape'); await page.getByTestId('item-detail').waitFor({ state: 'hidden' });
    await page.setViewportSize({ width: 1280, height: 800 });
    if (await page.locator('html').getAttribute('data-theme') !== 'light') await page.getByRole('button', { name: '切换亮色主题' }).click();
    await writeJson(path.join(output, 'B11_LAYOUT_METRICS.json'), { fixtureRows: 60, fixtureOnly: true, metrics, narrow, scrollBefore, scrollAfter, pendingBadgeDashed: true, fontState });
    return { requiredImages: screenshots.filter(row => row.name.startsWith('B11-')), metricsFile: path.join(output, 'B11_LAYOUT_METRICS.json') };
  });
  await phase('B3', async () => {
    await page.goto(`${frontendUrl}/#/items`); await page.getByTestId('new-item').waitFor(); const before = await snapshotFiles(content);
    await page.getByTestId('new-item').click(); await page.locator('#field-id').fill('expedition_ore'); await page.locator('#field-name').fill('Duplicate rejection fixture');
    await page.locator('.id-state').filter({ hasText: /ID 已被 expedition_ore 使用/ }).waitFor(); assert.equal(await page.getByTestId('save-item').isDisabled(), true);
    await page.locator('#field-id').fill('mat_alias_reserved'); await page.locator('.id-state').filter({ hasText: /别名重复/ }).waitFor(); assert.equal(await page.getByTestId('save-item').isDisabled(), true);
    await page.locator('#field-id').fill('Bad-ID'); await page.locator('.id-state').filter({ hasText: /must match/ }).waitFor(); assert.equal(await page.getByTestId('save-item').isDisabled(), true);
    await screenshot('B3-id-rejected'); await discardAndClose(); await openItem('expedition_ore'); assert.equal(await page.locator('#field-id').getAttribute('readonly') !== null, true);
    let lockedAttempt = 'blocked'; try { await page.locator('#field-id').fill('mat_changed_id', { timeout: 300 }); lockedAttempt = 'unexpectedly editable'; } catch {}
    assert.equal(lockedAttempt, 'blocked'); assert.equal(await page.locator('#field-id').inputValue(), 'expedition_ore');
    const marker = network.length; await page.locator('#field-baseValue').fill('-1');
    const validation = await waitValidationError('/baseValue', marker); const message = validation.error.message; assert.ok(message);
    await page.locator('[data-field="baseValue"] [role="alert"]').filter({ hasText: message }).waitFor();
    if (!await page.locator('.problems-panel').isVisible()) await page.locator('.bottom-status > button').first().click();
    await page.locator('.problems-panel button').filter({ hasText: message }).first().click(); await page.waitForFunction(() => document.activeElement.id === 'field-baseValue'); assert.equal(await page.evaluate(() => document.activeElement.id), 'field-baseValue');
    await page.locator('#field-baseValue').fill('4'); await sleep(500); await discardAndClose(); assert.deepEqual(await snapshotFiles(content), before);
    return { duplicateRejected: true, aliasRejected: true, formatRejected: true, existingIdLocked: true, serverMessageExact: message, errorNavigationFocused: 'field-baseValue', directoryUnchanged: true };
  });
  if (selected?.has('B3-focus')) await phase('B3-focus', async () => {
    await openItem('expedition_ore'); const before = await snapshotFiles(content); const marker = network.length;
    await page.locator('#field-baseValue').fill('-1'); const validation = await waitValidationError('/baseValue', marker); const message = validation.error.message;
    await page.locator('[data-field="baseValue"] [role="alert"]').filter({ hasText: message }).waitFor();
    if (!await page.locator('.problems-panel').isVisible()) await page.locator('.bottom-status > button').first().click();
    const valueBeforeClick = await page.locator('#field-baseValue').inputValue(); const activeBefore = await page.evaluate(() => ({ id: document.activeElement.id, tag: document.activeElement.tagName }));
    await page.locator('.problems-panel button').filter({ hasText: message }).first().click(); await page.waitForFunction(() => document.activeElement.id === 'field-baseValue');
    const activeAfter = await page.evaluate(() => ({ id: document.activeElement.id, tag: document.activeElement.tagName })); const valueAfterClick = await page.locator('#field-baseValue').inputValue();
    assert.equal(activeAfter.id, 'field-baseValue'); assert.equal(valueAfterClick, valueBeforeClick); assert.equal(valueAfterClick, '-1'); assert.equal(await page.getByRole('dialog').count(), 0); assert.deepEqual(await snapshotFiles(content), before);
    await screenshot('B3-focus-fixed-no-value-change'); return { serverMessage: message, activeBefore, activeAfter, valueBeforeClick, valueAfterClick, noNoteDialog: true, allContentBytesUnchanged: true };
  });
  await phase('B4', async () => {
    await openItem('expedition_ore'); const refs = await api('/api/refs/expedition_ore'); assert.equal(refs.json.length, 9);
    assert.equal(await page.getByRole('button', { name: '删除物品', exact: true }).isDisabled(), true); assert.equal(await page.getByRole('button', { name: '删除物品', exact: true }).locator('..').getAttribute('title'), '被 9 处引用');
    assert.equal(await page.locator('.refs-list code').count(), 9); assert.ok((await page.locator('.refs-list').innerText()).includes('旧配置 · 只读'));
    await screenshot('B4-reference-delete-disabled'); return { refs: 9, deleteDisabled: true, legacyReadOnlyVisible: true };
  });
  await phase('B5', async () => {
    await discardAndClose(); const oreBefore = sha256(await readFile(itemPath('expedition_ore'))); const rows = [['ID', '名称', '类型', '堆叠', '参考价', '标签']];
    for (let index = 1; index <= 8; index++) rows.push([`mat_paste_${String(index).padStart(2, '0')}`, index === 3 ? 'CSV, quote "inside"' : `导入样本 ${index}`, 'material', '99', String(index), 'isolated;paste']);
    rows.push(['expedition_ore', '重复ID不可覆盖', 'material', '99', '4', '']); rows.push(['mat_paste_bad_type', '非法类型不可创建', 'bad_kind', '99', '0', '']);
    const escape = value => /[,\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value; const input = rows.map(row => row.map(escape).join(',')).join('\n');
    await writeFile(path.join(output, 'B5_INPUT.csv'), input); await page.getByRole('button', { name: '从表格粘贴', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '从表格粘贴物品' }); const textarea = dialog.getByRole('textbox', { name: '粘贴表格内容' }); await textarea.fill(input);
    await page.getByTestId('import-valid').filter({ hasText: '(8)' }).waitFor(); await page.waitForFunction(() => !document.querySelector('[data-testid="import-valid"]')?.disabled);
    let release; const released = new Promise(resolve => { release = resolve; }); let held; const heldPromise = new Promise(resolve => { held = resolve; });
    const pattern = '**/api/content/item/mat_paste_01';
    await page.route(pattern, async route => { if (route.request().method() === 'PUT') { held(); await released; } await route.continue(); });
    const attempts = [];
    try {
      await page.getByTestId('import-valid').click(); await heldPromise;
      assert.equal(await textarea.isDisabled(), true); const mapping = dialog.locator('.column-mapping select'); for (let index = 0; index < await mapping.count(); index++) assert.equal(await mapping.nth(index).isDisabled(), true);
      try { await textarea.fill('ID,名称\nmat_wrong,wrong', { timeout: 300 }); attempts.push('textarea unexpectedly changed'); } catch { attempts.push('textarea change blocked while busy'); }
      try { await mapping.first().selectOption('-1', { timeout: 300 }); attempts.push('mapping unexpectedly changed'); } catch { attempts.push('mapping change blocked while busy'); }
      assert.equal(await textarea.inputValue(), input); assert.ok(attempts.every(text => text.includes('blocked')));
    } finally { release(); }
    await dialog.getByText('已导入 8 条，跳过 2 条', { exact: true }).waitFor(); await page.unroute(pattern);
    for (let index = 1; index <= 8; index++) { const item = await readJson(itemPath(`mat_paste_${String(index).padStart(2, '0')}`)); assert.equal(item.name, rows[index][1]); }
    assert.equal(sha256(await readFile(itemPath('expedition_ore'))), oreBefore); assert.equal((await readdir(path.join(content, 'items'))).includes('mat_paste_bad_type.json'), false);
    const preview = await dialog.locator('.batch-preview tbody').innerText(); assert.match(preview, /expedition_ore/); assert.match(preview, /bad_kind/);
    await dialog.getByRole('button', { name: '复制错误行' }).click(); const copied = await page.evaluate(() => navigator.clipboard.readText()); await writeFile(path.join(output, 'B5_COPIED_FAILED_ROWS.tsv'), copied);
    assert.ok(copied.startsWith('ID\t名称\t类型')); assert.ok(copied.includes('expedition_ore') && copied.includes('mat_paste_bad_type')); for (let index = 1; index <= 8; index++) assert.equal(copied.includes(`mat_paste_${String(index).padStart(2, '0')}`), false);
    await screenshot('B5-import-results'); await dialog.getByRole('button', { name: '关闭', exact: true }).click(); return { imported: 8, skipped: 2, csvQuotedNamePreserved: true, busyMutations: attempts, copiedFailedRows: path.join(output, 'B5_COPIED_FAILED_ROWS.tsv') };
  });
  await phase('B6', async () => {
    await openItem('con_simple_meal'); const before = await snapshotFiles(content);
    await page.getByTestId('add-effect').click(); const dialog = page.getByRole('dialog', { name: '登记待实现能力' }); await dialog.waitFor(); await saveWithKeyboard(); assert.deepEqual(await snapshotFiles(content), before);
    await dialog.getByRole('button', { name: '取消', exact: true }).click(); assert.deepEqual(await snapshotFiles(content), before); assert.equal(await page.locator('.effect-entry').count(), 0);
    await page.getByTestId('add-effect').click(); assert.equal(await dialog.getByRole('combobox', { name: '需求归属' }).inputValue(), 'engineering');
    await dialog.getByRole('textbox', { name: '能力标识' }).fill('restore_hunger'); await dialog.getByRole('textbox', { name: '需求标题' }).fill('恢复饥饿'); await dialog.getByRole('textbox', { name: '需求说明' }).fill('仅隔离验收：P1登记需求，不实现效果。'); await dialog.getByRole('textbox', { name: '预期结果' }).fill('等待专项另行设计');
    await dialog.getByRole('button', { name: '附需求并添加能力' }).click(); assert.equal(await page.getByRole('checkbox', { name: '保存为草稿' }).isChecked(), true); assert.deepEqual(await snapshotFiles(content), before);
    await saveWithKeyboard(); const saved = await waitFile('con_simple_meal', item => item.draft && item.consumable.effects.some(effect => effect.kind === 'restore_hunger'));
    const requests = await Promise.all((await readdir(path.join(content, '_requests'))).filter(file => file.endsWith('.json')).map(file => readJson(path.join(content, '_requests', file)))); const created = requests.find(request => request.target === 'item:con_simple_meal' && request.title === '恢复饥饿'); assert.ok(created); assert.equal(created.status, 'open'); assert.equal(created.owner, 'engineering');
    const engineering = (await readFile(path.join(content, 'REQUESTS.md'), 'utf8')).split('## engineering\n')[1]?.split('\n## ')[0] ?? ''; assert.ok(engineering.includes(`${created.id} — 恢复饥饿`));
    const marker = network.length; await page.getByRole('button', { name: '导出可用内容', exact: true }).click(); await waitNetwork(row => row.method === 'POST' && row.status === 200 && new URL(row.url).pathname === '/api/export', marker);
    const all = await Promise.all((await readdir(path.join(content, 'items'))).filter(file => file.endsWith('.json')).map(file => readJson(path.join(content, 'items', file)))); const exported = await readJson(path.join(runtime, 'items.json')); assert.deepEqual(compareTrees(runtimeProjection(all), exported), []); assert.equal(exported.items.some(item => item.id === 'con_simple_meal'), false); assert.ok(exported.items.some(item => item.id === 'eq_patrol_sword'));
    await screenshot('B6-draft-request-saved'); return { canceledComposerUnchanged: true, item: saved, createdRequest: created, legalDraftDidNotDisableGlobalExport: true, actualExportFiles: await snapshotFiles(runtime) };
  });
  await phase('B9', async () => {
    const branches = [];
    for (const [id, choice] of [['mat_grain', 'mine'], ['quenching_sand', 'disk']]) {
      await openItem(id); const initial = await preserveItem(id, `B9-${choice}-initial`); const opened = await api(`/api/content/item/${id}`); assert.equal(opened.response.headers.etag, `"${initial.sha256}"`);
      const mineName = `我的修改 ${choice}`; const diskName = `磁盘版本 ${choice}`; await page.locator('#field-name').fill(mineName);
      const disk = structuredClone(initial.value); disk.name = diskName; disk.baseValue += 17; await writeJson(itemPath(id), disk); const diskEvidence = await preserveItem(id, `B9-${choice}-external-disk`);
      const marker = network.length; await saveWithKeyboard(); const conflictResponse = await waitNetwork(putFor(id, 409), marker); const conflictBody = await readJson(conflictResponse.response.path); assert.equal(conflictBody.etag, `"${diskEvidence.sha256}"`); assert.equal(conflictBody.current.name, diskName);
      const dialog = page.getByRole('dialog', { name: '检测到磁盘版本冲突' }); await dialog.waitFor(); assert.ok((await dialog.innerText()).includes(mineName) && (await dialog.innerText()).includes(diskName)); assert.equal(sha256(await readFile(itemPath(id))), diskEvidence.sha256); await screenshot(`B9-${choice}-conflict`);
      let resolvedEtag;
      if (choice === 'mine') {
        const retryMarker = network.length; await page.getByTestId('keep-mine').click(); const retry = await waitNetwork(putFor(id, 200), retryMarker); assert.equal(retry.requestHeaders['if-match'], conflictBody.etag); const saved = await waitFile(id, item => item.name === mineName); assert.equal(saved.baseValue, initial.value.baseValue); resolvedEtag = retry.responseHeaders.etag;
      } else {
        const putsBefore = network.filter(row => putFor(id, 200)(row)).length; await page.getByTestId('use-disk').click(); await dialog.waitFor({ state: 'hidden' }); assert.equal(await page.locator('#field-name').inputValue(), diskName); assert.equal(sha256(await readFile(itemPath(id))), diskEvidence.sha256); await sleep(200); assert.equal(network.filter(row => putFor(id, 200)(row)).length, putsBefore); resolvedEtag = conflictBody.etag;
      }
      const afterChoice = await preserveItem(id, `B9-${choice}-resolved`); assert.equal(resolvedEtag, `"${afterChoice.sha256}"`);
      const following = `随后保存 ${choice}`; await page.locator('#field-description').fill(following); const followMarker = network.length; await saveWithKeyboard(); const follow = await waitNetwork(putFor(id, 200), followMarker); assert.equal(follow.requestHeaders['if-match'], resolvedEtag); await waitFile(id, item => item.description === following && item.name === (choice === 'mine' ? mineName : diskName));
      const final = await preserveItem(id, `B9-${choice}-following-save`); assert.equal(follow.responseHeaders.etag, `"${final.sha256}"`); branches.push({ id, choice, initial, diskEvidence, afterChoice, final, followingSaveIfMatch: follow.requestHeaders['if-match'] });
    }
    return branches;
  });
  await phase('B10', async () => {
    await openItem('mat_grain'); const retained = 'Unsent offline edit kept through reconnect'; await page.locator('#field-description').fill(retained); const navBefore = navigations; const documentBefore = { timeOrigin: await page.evaluate(() => performance.timeOrigin), requests: documentRequests };
    const beforeStop = performance.now(); await stopBackend(); await page.locator('.offline-banner').waitFor({ state: 'visible', timeout: 5000 }); const offlineMilliseconds = performance.now() - beforeStop; assert.ok(offlineMilliseconds <= 5000); assert.equal(await page.locator('#field-description').inputValue(), retained); assert.equal(await page.getByTestId('save-item').isDisabled(), true); await screenshot('B10-offline-draft-retained');
    await startBackend(); await page.locator('.offline-banner').waitFor({ state: 'hidden' }); assert.equal(await page.locator('#field-description').inputValue(), retained); assert.equal(await page.getByTestId('save-item').isDisabled(), false); assert.equal(await page.evaluate(() => performance.timeOrigin), documentBefore.timeOrigin); assert.equal(documentRequests, documentBefore.requests);
    const marker = network.length; await saveWithKeyboard(); await waitNetwork(putFor('mat_grain', 200), marker); const saved = await waitFile('mat_grain', item => item.description === retained); const disk = await preserveItem('mat_grain', 'B10-after-reconnect-actual-save'); assert.equal(await page.evaluate(() => performance.timeOrigin), documentBefore.timeOrigin); assert.equal(documentRequests, documentBefore.requests);
    return { offlineMilliseconds, draftPreserved: true, noRefresh: true, documentBefore, documentAfter: { timeOrigin: await page.evaluate(() => performance.timeOrigin), requests: documentRequests }, sameDocumentHistoryEvents: navigations - navBefore, actualSavedItem: saved, disk };
  });
  await phase('B12', async () => {
    await page.goto(`${frontendUrl}/#/items`); await page.reload(); record('B12-independent-document-setup'); await page.getByTestId('new-item').waitFor(); await page.waitForFunction(() => document.querySelector('.page-heading .count')?.textContent === '60');
    const focusTrace = [];
    async function tabTo(target) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const active = await page.evaluate(() => { const element = document.activeElement; const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return { id: element.id, testId: element.getAttribute('data-testid'), tag: element.tagName, text: (element.getAttribute('aria-label') || element.textContent || '').slice(0, 80), x: rect.x, y: rect.y, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, boxShadow: style.boxShadow, focusVisible: element.matches(':focus-visible') }; });
        focusTrace.push(active); record('keyboard-focus', active); if (active.id === target || active.testId === target) return active;
        record('keyboard', { key: 'Tab' }); await page.keyboard.press('Tab');
      }
      await writeJson(path.join(output, 'B12_FOCUS_TRACE.partial.json'), focusTrace); throw new Error(`Could not reach ${target} using only Tab.`);
    }
    await tabTo('new-item'); record('keyboard', { key: 'Enter', purpose: 'new item' }); await page.keyboard.press('Enter'); await page.getByTestId('item-detail').waitFor(); await page.waitForFunction(() => document.querySelector('#field-category') && !document.querySelector('#field-category').matches(':disabled'));
    const idFocus = await tabTo('field-id'); assert.equal(idFocus.focusVisible, true); assert.ok(idFocus.outlineStyle !== 'none' || idFocus.boxShadow !== 'none'); record('keyboard', { key: 'Control+a then type', value: 'mat_keyboard_verify' }); await page.keyboard.press('Control+a'); await page.keyboard.type('mat_keyboard_verify', { delay: 10 });
    await tabTo('field-name'); record('keyboard', { key: 'type', value: 'Keyboard-only fixture' }); await page.keyboard.type('Keyboard-only fixture', { delay: 10 }); await saveWithKeyboard(); const saved = await waitFile('mat_keyboard_verify', item => item.name === 'Keyboard-only fixture'); await page.waitForFunction(() => document.querySelector('#field-id')?.readOnly === true); assert.equal(await page.locator('#field-id').getAttribute('readonly') !== null, true); await screenshot('B12-keyboard-saved');
    record('keyboard', { key: 'Control+k' }); await page.keyboard.press('Control+k'); await page.getByRole('dialog', { name: '全局实体搜索' }).waitFor(); await page.keyboard.type('expedition-ore', { delay: 10 }); record('keyboard', { key: 'Enter', purpose: 'alias search' }); await page.keyboard.press('Enter'); await page.waitForFunction(() => document.querySelector('#field-id')?.value === 'expedition_ore');
    await page.keyboard.press('Control+k'); await page.getByRole('dialog', { name: '全局实体搜索' }).waitFor(); await page.keyboard.press('Escape'); await page.getByRole('dialog', { name: '全局实体搜索' }).waitFor({ state: 'hidden' }); await page.keyboard.press('Escape'); await page.getByTestId('item-detail').waitFor({ state: 'hidden' });
    assert.equal(events.some(event => event.action === 'unexpected-native-dialog'), false); await writeJson(path.join(output, 'B12_FOCUS_AND_KEYBOARD_TRACE.json'), { focusTrace, events: events.filter(event => event.action === 'keyboard'), actualSavedItem: saved });
    return { keyboardOnlyNewAndSave: true, controlS: true, controlKAliasEnter: true, escapeModalAndDetails: true, focusTraceFile: path.join(output, 'B12_FOCUS_AND_KEYBOARD_TRACE.json') };
  });
} catch (error) {
  failure = { message: error.message, stack: error.stack };
  if (page) { try { await screenshot('FAILURE'); await writeFile(path.join(output, 'FAILURE.html'), await page.content()); await writeJson(path.join(output, 'FAILURE_STATE.json'), await page.evaluate(() => ({ url: location.href, activeElement: { tag: document.activeElement?.tagName, id: document.activeElement?.id, ariaLabel: document.activeElement?.getAttribute('aria-label'), className: document.activeElement?.className }, openDialogs: [...document.querySelectorAll('[role="dialog"]')].map(element => element.textContent) }))); } catch {} }
} finally {
  if (context) { try { await context.tracing.stop({ path: path.join(output, 'browser-trace.zip') }); } catch {} }
  if (browser) await browser.close().catch(error => record('browser-close-error', { message: error.message }));
  await Promise.all(pendingNetwork);
  if (backend) await stopBackend().catch(error => { failure ??= { message: `Backend cleanup identity: ${error.message}` }; return backend?.stop(); });
  if (frontend) { const receipt = await frontend.stop(); const { stdoutBytes, stderrBytes, ...saved } = receipt; await writeJson(path.join(output, 'frontend-stopped.json'), saved); }
  const sourceAfter = await sourceFiles();
  if (compareTrees(identity.frontendSourceFiles, sourceAfter).length) failure ??= { message: 'Frontend source changed during this browser run; results require version review.', sourceAfter };
  if (compareTrees(identity.authoritativeContent, await snapshotFiles(path.join(repository, 'content'))).length || compareTrees(identity.oldPrototype, await snapshotFiles(path.join(repository, 'Game/Assets/StreamingAssets/Prototype'))).length) failure ??= { message: 'Authoritative source/config changed during isolated browser run.' };
  await writeJson(path.join(output, 'BROWSER_ACCEPTANCE.json'), { schemaVersion: 1, passed: !failure && checks.every(check => check.status !== 'Failed'), scope: 'Only the listed selected browser phases; NotRun items and backend/Unity/build are separate, never a P1 completion claim.', selection: selected ? [...selected] : 'all-browser-phases', identity, isolated: { work, content, runtime, frontendUrl, backendUrl, browserExecutable: args['--browser-exe'], profileParent: temporary }, checks, failure, serviceRecords, screenshots, events, consoleMessages, network });
  process.stdout.write(`${JSON.stringify({ passed: !failure, passedPhases: checks.filter(check => check.status === 'Passed').map(check => check.id), notRun: checks.filter(check => check.status === 'NotRun').map(check => check.id), failure: failure?.message ?? null, sourceHash: identity.frontendSourceHash, evidence: output })}\n`);
  process.exitCode = failure ? 1 : 0;
}
