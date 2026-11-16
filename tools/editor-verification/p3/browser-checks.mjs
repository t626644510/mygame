import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { P3HttpContext } from './http-context.mjs';
import { startRecorded } from '../raw-evidence.mjs';
import { repository, readJson, snapshotFiles, writeJson, sha256 } from './evidence.mjs';
import { building, recipe, layout, flows, rotationProbe } from './fixtures.mjs';

const test = new P3HttpContext(process.argv.slice(2));
assert.ok(test.args['--browser-exe'] && test.args['--frontend-manifest']);
const selected = new Set((test.args['--only'] ?? 'D6,D5,F03,D3,D4-ui').split(','));
assert.ok([...selected].every(id => ['D6', 'D5', 'F03', 'D3', 'D4-ui'].includes(id)));
test.scope = `Real P3 browser ${[...selected].join(',')}; no D7 performance, D9 eight-image rerun or Unity.`;
const url = 'http://127.0.0.1:5176';
const events = [], network = [], pending = [], screenshots = [], pageErrors = [], consoleMessages = [], moduleResponses = [];
let page, context, frontend, frontendIdentity, manifest, failure, activeModuleUrl, requestNumber = 0;
const record = (action, value = {}) => events.push({ utc: new Date().toISOString(), action, ...value });
const fixtureIds = { ten: 'layout_ui_history_ten', fifty: 'layout_ui_history_fifty', alias: 'layout_ui_alias', rotation: 'layout_ui_rotation' };
const aliasRecipe = recipe('rcp_ui_alias', { name: 'UI alias recipe', aliases: ['rcp_ui_alias_old'] });
const aliasBuilding = building('bld_ui_alias', { name: 'UI alias workshop', aliases: ['bld_ui_alias_old'], recipeIds: ['rcp_ui_alias_old'], buildCost: { cash: 0, workTicks: 0, materials: [{ itemId: 'quenching-sand', quantity: 2 }] } });
const invalidCodes = ['out_of_bounds', 'overlap', 'entrance_blocked', 'unreachable', 'ownership_not_allowed'];
const layoutIdFor = code => `layout_ui_${code}`;
const tileSize = Number((await readFile(path.join(repository, 'tools/editor-web/src/features/base/canvasRenderer.ts'), 'utf8')).match(/tileSize\s*=\s*(\d+)/)?.[1]);
assert.ok(tileSize > 0);

async function poll(read, predicate, message, attempts = 120) {
  for (let i = 0; i < attempts; i++) { const value = await read(); if (predicate(value)) return value; await sleep(100); }
  throw new Error(message);
}
async function phase(id, action) { if (selected.has(id)) { record('phase-start', { id }); await test.phase(id, action); record('phase-pass', { id }); } }
async function image(name) {
  const file = path.join(test.output, 'screenshots', name + '.png'); await mkdir(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file }); const b = await readFile(file); screenshots.push({ path: file, bytes: b.length, sha256: sha256(b), injectedStyle: false });
}
async function currentSession() {
  activeModuleUrl = moduleResponses.at(-1)?.url;
  if (!activeModuleUrl) return null; // wait for the actual module response, never import a bare second singleton
  return page.evaluate(async moduleUrl => {
    const module = await import(moduleUrl); const state = module.useBaseStore.getState(), session = state.sessions[state.current];
    return session ? { key: state.current, entity: structuredClone(session.entity), past: session.past.length, future: session.future.length } : null;
  }, activeModuleUrl);
}
async function entity() { const value = await currentSession(); assert.ok(value); return value.entity; }
async function waitEntity(expected) {
  return poll(entity, value => { try { assert.deepEqual(value, expected); return true; } catch { return false; } }, 'Actual production state did not reach the expected complete layout.');
}
async function go(type, id) {
  const module = type === 'building' || type === 'layout' ? '地图' : '生产';
  if (!await page.locator('.base-subnav').isVisible()) await page.getByRole('button', { name: module, exact: true }).click();
  else if (!(await page.locator('.base-subnav').innerText()).includes(type === 'building' || type === 'layout' ? '布局' : '配方')) await page.getByRole('button', { name: module, exact: true }).click();
  const label = { building: '建筑定义', layout: '布局画布', recipe: '配方' }[type];
  if (type === 'layout' && await page.getByLabel('选择基地布局', { exact: true }).isVisible()) await page.getByLabel('选择基地布局', { exact: true }).selectOption(id);
  else {
    await page.locator('.base-subnav').getByRole('button', { name: label, exact: true }).click();
    await page.locator('.base-entity-list button').filter({ has: page.locator('code', { hasText: new RegExp(`^${id}$`) }) }).click();
  }
  await page.waitForFunction(id => document.querySelector('#base-field-id')?.value === id, id);
  const session = await poll(currentSession, value => value?.entity?.id === id, 'Readonly store module is not the actual active UI singleton.');
  assert.equal(session.key, `${type}:${id}`);
  if (type === 'layout') await page.getByTestId('layout-canvas').waitFor();
}
async function canvasPoint(point) {
  const canvas = page.getByTestId('layout-canvas');
  await poll(() => canvas.getAttribute('data-camera-x'), value => value !== null, 'Production Canvas has not actually rendered.');
  const box = await canvas.boundingBox(); const camera = await canvas.evaluate(el => ({ x: Number(el.dataset.cameraX), y: Number(el.dataset.cameraY), zoom: Number(el.dataset.zoom) }));
  const x = box.x + camera.x + (point.x + 0.5) * tileSize * camera.zoom;
  const y = box.y + camera.y + (point.y + 0.5) * tileSize * camera.zoom;
  assert.ok(x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.height, `Requested tile ${point.x},${point.y} is outside the visible Canvas; no forced click.`);
  return { x, y };
}
async function pointer(point) {
  const screen = await canvasPoint(point); await page.mouse.move(screen.x, screen.y);
  await poll(() => page.locator('.canvas-position').innerText(), text => text.includes(`${point.x}, ${point.y}`), 'Production pointer coordinates did not match the intended grid cell.');
  return screen;
}
async function focusCanvas() { await page.locator('.palette-tools').getByRole('button', { name: '选择', exact: true }).click(); await page.getByTestId('layout-canvas').click(); }
async function chooseBuilding(id) { await page.locator('.palette-building-list button').filter({ has: page.locator('code', { hasText: new RegExp(`^${id}$`) }) }).click(); }
async function place(point, continuous = false) {
  const before = await entity(); const screen = await pointer(point);
  await page.mouse.click(screen.x, screen.y); // continuous placement uses the real Shift key held by the caller
  const after = await poll(entity, value => value.buildings.length === before.buildings.length + 1, 'Real placement did not commit one building.');
  const added = after.buildings.find(row => !before.buildings.some(old => old.instanceId === row.instanceId)); assert.ok(added); assert.equal(added.x, point.x); assert.equal(added.y, point.y); return added.instanceId;
}
async function moveInstance(id, destination) {
  const before = await entity(), item = before.buildings.find(row => row.instanceId === id); assert.ok(item);
  await focusCanvas(); const from = await pointer({ x: item.x, y: item.y }), to = await canvasPoint(destination);
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 4 }); await page.mouse.up();
  await poll(entity, value => { const row = value.buildings.find(row => row.instanceId === id); return row?.x === destination.x && row?.y === destination.y; }, 'Real pointer drag did not commit its destination.');
}
async function deleteInstance(id) {
  const item = (await entity()).buildings.find(row => row.instanceId === id); assert.ok(item); await focusCanvas();
  const point = await pointer(item); await page.mouse.click(point.x, point.y); await page.keyboard.press('Delete');
  await poll(entity, value => !value.buildings.some(row => row.instanceId === id), 'Real Delete key did not remove the selected building.');
}
async function save(type, id) {
  const response = page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/content/${type}/${id}`);
  await page.getByTestId('save-base-entity').click(); const result = await response; assert.equal(result.status(), 200);
  const bytes = await result.body(); record('real-save', { type, id, status: 200, responseSha256: sha256(bytes) });
  await poll(() => page.getByTestId('save-base-entity').isEnabled(), Boolean, 'Actual save handler has not completed.');
  return readJson(test.entityFile(type, id));
}
async function checkReady(id, code) {
  return poll(async () => {
    const value = await entity();
    return [...network].reverse().find(row => row.path === '/api/layout/check' && row.status === 200 && row.json && row.requestJson?.layout?.id === id && JSON.stringify(row.requestJson.layout) === JSON.stringify(value) && (!code || row.json.errors.some(error => error.code === code)));
  }, Boolean, 'No settled real backend check for the current complete layout.');
}
async function exportButton(status) {
  const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/export');
  await page.getByRole('button', { name: '导出已保存数据', exact: true }).click(); const result = await response;
  assert.equal(result.status(), status); const bytes = await result.body(); return { status, sha256: sha256(bytes), json: JSON.parse(bytes.toString('utf8')) };
}
async function frontendMetadata(name) {
  const result = await test.command(name, test.args['--pwsh'], ['-NoProfile', '-File', path.join(repository, 'tools/editor-verification/owned-process.ps1'), '-OwnedProcessId', String(frontend.child.pid)]);
  const actual = JSON.parse(result.stdoutBytes.toString('utf8')); assert.equal(actual.parentProcessId, process.pid); assert.ok(actual.commandLine.includes('frontend-dev.mjs') && actual.commandLine.includes(test.work)); return actual;
}
async function frontendPortFree() {
  await new Promise((resolve, reject) => { const socket = net.connect({ host: '127.0.0.1', port: 5176 }); socket.once('connect', () => { socket.destroy(); reject(new Error('Frontend port belongs to another process; no process is stopped.')); }); socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error)); });
}

try {
  await test.initialize();
  manifest = await readJson(path.resolve(repository, test.args['--frontend-manifest']));
  assert.equal(new Set(manifest.files.map(row => row.path)).size, manifest.files.length);
  for (const row of manifest.files) assert.equal(sha256(await readFile(path.join(repository, row.path))), row.sha256);
  test.identity.frontend = { manifest: test.args['--frontend-manifest'], sourceHash: manifest.sourceHash, aggregateRule: manifest.aggregateRule, files: manifest.files };
  await test.start('browser');
  await test.create('rule', flows()); const imported = await test.api('/api/import-first-meal', 'POST', {}); assert.equal(imported.status, 200);
  await test.create('layout', layout(fixtureIds.ten, { width: 18, height: 10 }));
  await test.create('layout', layout(fixtureIds.fifty, { width: 24, height: 12 }));
  const rotation = rotationProbe(); rotation.layout.id = fixtureIds.rotation; rotation.layout.name = 'UI rotation'; rotation.layout.buildings[0].rotation = 0;
  await test.create('building', rotation.definition); await test.create('layout', rotation.layout);
  await test.create('recipe', aliasRecipe); await test.create('building', aliasBuilding);
  await test.create('layout', layout(fixtureIds.alias, { buildings: [{ instanceId: 'alias_01', buildingId: 'bld_ui_alias_old', x: 3, y: 2, rotation: 0, ownership: 'private' }] }));
  await test.create('building', building('bld_ui_private'));
  for (const code of invalidCodes) await test.create('layout', layout(layoutIdFor(code), code === 'ownership_not_allowed' ? { buildings: [{ instanceId: 'private_01', buildingId: 'bld_ui_private', x: 3, y: 2, rotation: 0, ownership: 'private' }] } : {}));
  await frontendPortFree();
  frontend = await startRecorded({ executable: process.execPath, args: [path.join(repository, 'tools/editor-verification/frontend-dev.mjs'), path.join(test.work, 'p3-browser-cache')], cwd: path.join(repository, 'tools/editor-web'), prefix: path.join(test.output, 'frontend'), timeoutMs: 900000 });
  frontendIdentity = await frontendMetadata('frontend-identity-start');
  await poll(async () => { try { return (await fetch(url)).status; } catch { return 0; } }, status => status === 200, 'Actual Vite did not become ready.');
  const require = createRequire(import.meta.url), { chromium } = require(path.join(repository, 'tools/editor-web/node_modules/playwright'));
  const profile = path.join(test.work, 'browser-profile'), temporary = path.join(test.work, 'browser-temp'); await mkdir(profile); await mkdir(temporary);
  test.browserLaunchAttempted = true;
  context = await chromium.launchPersistentContext(profile, { executablePath: test.args['--browser-exe'], headless: true, viewport: { width: 1920, height: 1080 }, env: { ...process.env, TEMP: temporary, TMP: temporary }, args: ['--no-first-run', '--no-default-browser-check'] });
  test.browserContextCreated = true; await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await context.addInitScript(() => localStorage.setItem('helper-theme', 'light'));
  const cdp = await context.browser().newBrowserCDPSession(), processes = await cdp.send('SystemInfo.getProcessInfo');
  const browser = processes.processInfo.find(row => row.type === 'browser'); assert.ok(browser);
  const identity = await test.command('browser-identity-start', test.args['--pwsh'], ['-NoProfile', '-File', path.join(repository, 'tools/editor-verification/owned-process.ps1'), '-OwnedProcessId', String(browser.id)]);
  test.identity.browser = JSON.parse(identity.stdoutBytes.toString('utf8')); assert.equal(test.identity.browser.parentProcessId, process.pid); assert.ok(test.identity.browser.commandLine.includes(profile));
  assert.equal(path.resolve(test.identity.browser.executablePath).toLowerCase(), path.resolve(test.args['--browser-exe']).toLowerCase());
  page = context.pages()[0]; page.setDefaultTimeout(15000);
  page.on('pageerror', error => pageErrors.push({ message: error.message, stack: error.stack })); page.on('console', message => consoleMessages.push({ type: message.type(), text: message.text() }));
  page.on('response', response => {
    const parsed = new URL(response.url()), isModule = parsed.pathname === '/src/features/base/store.ts'; if (!parsed.pathname.startsWith('/api/') && !isModule) return;
    const number = ++requestNumber, request = response.request();
    pending.push((async () => {
      const prefix = path.join(test.output, 'browser-network', String(number).padStart(4, '0')); await mkdir(path.dirname(prefix), { recursive: true });
      const requestBytes = request.postDataBuffer() ?? Buffer.alloc(0); await writeFile(prefix + '.request', requestBytes);
      let bytes, unavailable; try { bytes = await response.body(); await writeFile(prefix + '.response', bytes); } catch (error) { unavailable = error.message; }
      let json, requestJson; try { json = bytes && JSON.parse(bytes.toString('utf8')); } catch {} try { requestJson = JSON.parse(requestBytes.toString('utf8')); } catch {}
      const record = { number, url: response.url(), path: parsed.pathname, method: request.method(), status: response.status(), request: { path: prefix + '.request', bytes: requestBytes.length, sha256: sha256(requestBytes) }, response: bytes ? { path: prefix + '.response', bytes: bytes.length, sha256: sha256(bytes) } : { unavailable }, json, requestJson };
      await writeJson(prefix + '.json', record); if (isModule) moduleResponses.push(record); else network.push(record);
    })());
  });
  await page.goto(`${url}/#/map/layout/${fixtureIds.ten}`); await page.waitForFunction(id => document.querySelector('#base-field-id')?.value === id, fixtureIds.ten);
  await poll(currentSession, value => value?.entity.id === fixtureIds.ten, 'Current production module/DOM not ready.');
  await page.evaluate(() => document.fonts.ready); assert.deepEqual(pageErrors, []);

  await phase('D6', async () => {
    const snapshots = [await entity()]; let a, b, c, d;
    await chooseBuilding('bld_legacy_kitchen'); a = await place({ x: 6, y: 2 }); snapshots.push(await entity());
    await chooseBuilding('bld_legacy_kitchen'); b = await place({ x: 8, y: 2 }); snapshots.push(await entity());
    await moveInstance(a, { x: 6, y: 4 }); snapshots.push(await entity());
    await chooseBuilding('bld_legacy_kitchen'); c = await place({ x: 10, y: 2 }); snapshots.push(await entity());
    await deleteInstance(b); snapshots.push(await entity());
    await moveInstance(c, { x: 10, y: 4 }); snapshots.push(await entity());
    await chooseBuilding('bld_legacy_kitchen'); d = await place({ x: 12, y: 2 }); snapshots.push(await entity());
    await deleteInstance(a); snapshots.push(await entity()); await moveInstance(d, { x: 12, y: 4 }); snapshots.push(await entity());
    await deleteInstance(c); snapshots.push(await entity()); assert.equal((await currentSession()).past, 10);
    await focusCanvas(); for (let i = 9; i >= 0; i--) { await page.keyboard.press('Control+z'); await waitEntity(snapshots[i]); record('undo-real-key', { step: i }); }
    for (let i = 1; i <= 10; i++) { await page.keyboard.press('Control+Shift+z'); await waitEntity(snapshots[i]); record('redo-real-key', { step: i }); }
    assert.deepEqual(await save('layout', fixtureIds.ten), snapshots[10]); await image('D6-ten-real-operations');
    await go('layout', fixtureIds.fifty); const initial = await entity(), diskBefore = await snapshotFiles(test.content);
    await chooseBuilding('bld_legacy_kitchen'); await page.keyboard.down('Shift');
    for (let i = 0; i < 50; i++) await place({ x: 5 + i % 10, y: 3 + Math.floor(i / 10) }, true);
    await page.keyboard.up('Shift'); const fifty = await entity(); assert.ok((await currentSession()).past >= 50);
    await focusCanvas(); for (let i = 0; i < 50; i++) await page.keyboard.press('Control+z'); await waitEntity(initial);
    for (let i = 0; i < 50; i++) await page.keyboard.press('Control+Shift+z'); await waitEntity(fifty);
    assert.deepEqual(await snapshotFiles(test.content), diskBefore); await writeJson(path.join(test.output, 'D6-SNAPSHOTS.json'), { snapshots, capacity: { realPlacements: 50, undos: 50, redos: 50, initial, final: fifty, unsavedDiskUnchanged: true } });
    return { tenSnapshots: 11, tenRealKeyboardUndosAndRedos: true, realCapacity: 50, source: 'Actual loaded production module readonly snapshots plus real UI, never direct store mutation' };
  });
  await phase('D5', async () => {
    await go('layout', fixtureIds.rotation); await focusCanvas(); const point = await pointer({ x: 4, y: 1 }); await page.mouse.click(point.x, point.y); await page.keyboard.press('r');
    await poll(() => page.getByTestId('instance-geometry').getAttribute('data-width'), width => width === '2', 'Rotation preview did not become 2x3.');
    const g = await page.getByTestId('instance-geometry').evaluate(el => ({ width: +el.dataset.width, height: +el.dataset.height, x: +el.dataset.entranceX, y: +el.dataset.entranceY }));
    assert.deepEqual(g, { width: 2, height: 3, x: 2, y: 2 }); const check = await checkReady(fixtureIds.rotation);
    assert.deepEqual(check.json.geometry[0].entrance, { x: 2, y: 2 }); const saved = await save('layout', fixtureIds.rotation); assert.equal(saved.buildings[0].rotation, 90);
    const definition = await readJson(test.entityFile('building', rotation.definition.id)); assert.deepEqual(definition.footprint, { w: 3, h: 2 }); assert.deepEqual(definition.entrance, { x: 1, y: 2 });
    await image('D5-real-R-key-left-entrance'); return { anchor: { x: 3, y: 1 }, localEntrance: { x: -1, y: 1 }, worldEntrance: { x: 2, y: 2 }, savedRotation: 90, definitionUnchanged: true };
  });
  await phase('F03', async () => {
    await go('layout', fixtureIds.alias); await focusCanvas(); const point = await pointer({ x: 3, y: 2 }); await page.mouse.click(point.x, point.y);
    await poll(() => page.getByLabel('实例建筑定义', { exact: true }).inputValue(), value => value === 'bld_ui_alias_old', 'Alias building was not hittable/selectable.');
    await page.getByTestId('instance-geometry').waitFor(); const pixel = await page.getByTestId('layout-canvas').locator('canvas').nth(1).evaluate((canvas, screen) => { const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio; return [...canvas.getContext('2d').getImageData(Math.floor((screen.x - rect.x) * dpr), Math.floor((screen.y - rect.y) * dpr), 1, 1).data]; }, point);
    assert.ok(pixel[3] > 0, 'Alias building has no production overlay pixel.'); await image('F03-alias-visible-selected');
    const details = page.locator('.layout-inspector details').first(); if (!await details.evaluate(el => el.open)) await details.locator('summary').click();
    await page.getByLabel('布局名称', { exact: true }).fill('Alias layout saved through UI'); const saved = await save('layout', fixtureIds.alias); assert.equal(saved.buildings[0].buildingId, 'bld_ui_alias_old'); await checkReady(fixtureIds.alias);
    await go('building', aliasBuilding.id);
    const checkbox = page.locator('.base-checkbox-list label').filter({ has: page.locator('code', { hasText: new RegExp(`^${aliasRecipe.id}$`) }) }).locator('input'); assert.equal(await checkbox.isChecked(), true);
    assert.equal(await page.getByText('缺少配方 rcp_ui_alias_old', { exact: false }).count(), 0);
    await page.getByLabel('名称', { exact: true }).fill('UI alias workshop saved'); const buildingSaved = await save('building', aliasBuilding.id); assert.deepEqual(buildingSaved.recipeIds, ['rcp_ui_alias_old']);
    await go('recipe', aliasRecipe.id);
    const usage = page.locator('.recipe-analysis button.base-link').filter({ has: page.locator('code', { hasText: new RegExp(`^${aliasBuilding.id}$`) }) });
    await usage.waitFor(); assert.ok((await usage.innerText()).includes('UI alias workshop saved')); await image('F03-recipe-alias-definition-usage');
    return { aliasPixel: pixel, hitAndInspector: true, originalLayoutAliasPreserved: true, recipeAliasCheckboxChecked: true, recipeUsageVisible: true, originalRecipeAliasPreserved: true };
  });
  await phase('D3', async () => {
    await go('layout', layoutIdFor(invalidCodes[0])); await exportButton(200); const cases = [];
    for (const code of invalidCodes) {
      await go('layout', layoutIdFor(code)); const initial = await entity();
      if (code === 'out_of_bounds' || code === 'overlap') { await chooseBuilding('bld_legacy_kitchen'); await place(code === 'out_of_bounds' ? { x: -1, y: 2 } : { x: 3, y: 2 }); }
      else if (code === 'entrance_blocked' || code === 'unreachable') {
        await page.locator('.terrain-tools').getByRole('button', { name: code === 'entrance_blocked' ? '障碍' : '水', exact: true }).click();
        const points = code === 'entrance_blocked' ? [{ x: 3, y: 2 }] : Array.from({ length: 5 }, (_, y) => ({ x: 2, y }));
        const first = await pointer(points[0]); await page.mouse.down(); for (const tile of points.slice(1)) { const pos = await canvasPoint(tile); await page.mouse.move(pos.x, pos.y); } await page.mouse.up();
      } else await page.getByLabel('实例归属', { exact: true }).selectOption('public');
      const checked = await checkReady(layoutIdFor(code), code); const issue = checked.json.errors.find(row => row.code === code); assert.ok(issue); assert.equal(issue.blocking, true);
      await page.locator(`[data-issue-code="${code}"]`).first().click();
      const canvas = page.getByTestId('layout-canvas');
      await poll(() => canvas.evaluate((el, size) => { const r = el.getBoundingClientRect(), cell = Number(el.dataset.zoom) * size; return { x: Math.floor((r.width / 2 - Number(el.dataset.cameraX)) / cell), y: Math.floor((r.height / 2 - Number(el.dataset.cameraY)) / cell) }; }, tileSize), point => point.x === issue.x && point.y === issue.y, 'Actual production camera has not centered the issue.');
      const bounds = await canvas.boundingBox(); await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await poll(() => page.locator('.canvas-position').innerText(), value => value.includes(`${issue.x}, ${issue.y}`), 'Issue click did not center its actual grid location.');
      await image(`D3-${code}-issue-centered`); const expected = await entity(); assert.deepEqual(await save('layout', layoutIdFor(code)), expected);
      const targetBefore = await snapshotFiles(test.runtime); await writeJson(path.join(test.output, `D3-${code}-target-before.json`), targetBefore);
      const rejected = await exportButton(422), targetAfter = await snapshotFiles(test.runtime); await writeJson(path.join(test.output, `D3-${code}-target-after.json`), targetAfter); assert.deepEqual(targetAfter, targetBefore);
      assert.ok(rejected.json.errors.some(row => row.code === code)); cases.push({ code, issue, exported: false, exportResponseSha256: rejected.sha256, wholeTargetUnchanged: true, saveStatus: 200, centeredActualGrid: true });
      await writeJson(path.join(test.output, 'D3-COMPLETED-CASES.json'), cases);
      await focusCanvas(); await page.keyboard.press('Control+z'); await waitEntity(initial); await save('layout', layoutIdFor(code));
    }
    return cases;
  });
  await phase('D4-ui', async () => {
    await page.getByRole('button', { name: '生产', exact: true }).click(); await page.locator('.base-subnav').getByRole('button', { name: '生产链', exact: true }).click();
    const node = page.locator('.react-flow__node[data-id="item:quenching_sand"]'); await node.waitFor(); await image('D4-real-chain-warning');
    const button = page.getByRole('button', { name: '导出可用内容', exact: true }); assert.equal(await button.isEnabled(), true);
    const exported = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/export'); await button.click(); const result = await exported; assert.equal(result.status(), 200); await result.body();
    await node.click(); await page.waitForFunction(() => document.querySelector('#field-id')?.value === 'quenching_sand');
    return { realNodeJump: 'quenching_sand', warningDoesNotDisableExport: true, actualExport: 200, filteringDelegatedToFrontendD9: true };
  });
  assert.deepEqual(pageErrors, []);
} catch (error) {
  failure = { check: test.activeCheck, category: test.activeCheck === 'Preflight' ? 'HarnessOrEnvironmentPrecondition' : 'BrowserFailureRequiresTriage', message: error.message, stack: error.stack };
  if (page) { try { await image('FAILURE'); await writeFile(path.join(test.output, 'FAILURE.html'), await page.content()); } catch {} }
} finally {
  if (context) { try { await context.tracing.stop({ path: path.join(test.output, 'trace.zip') }); await context.close(); record('owned-context-closed'); } catch (error) { failure ??= { check: 'BrowserCleanup', message: error.message }; } }
  const results = await Promise.allSettled(pending); if (results.some(r => r.status === 'rejected')) failure ??= { check: 'EvidenceCapture', message: 'A network capture task failed; inspect the original recorder output.' };
  if (test.identity?.browser?.processId) {
    const pid = test.identity.browser.processId;
    try { const after = await test.command('browser-exactpid-after-close', test.args['--pwsh'], ['-NoProfile', '-Command', `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; [ordered]@{processId=${pid};present=[bool]$p;observedUtc=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Compress`]); test.identity.browser.afterClose = JSON.parse(after.stdoutBytes.toString('utf8')); assert.equal(test.identity.browser.afterClose.present, false); } catch (error) { failure ??= { check: 'BrowserAbsence', message: error.message }; }
  }
  if (frontend) { try { const actual = await frontendMetadata('frontend-identity-before-stop'); assert.equal(actual.startedAtUtc, frontendIdentity.startedAtUtc); const stopped = await frontend.stop(); const { stdoutBytes, stderrBytes, ...receipt } = stopped; test.identity.frontendService = { actual, stopped: receipt }; await frontendPortFree(); } catch (error) { failure ??= { check: 'FrontendCleanup', message: error.message }; } }
  if (manifest) for (const row of manifest.files) if (sha256(await readFile(path.join(repository, row.path))) !== row.sha256) failure ??= { check: 'FrozenFrontendChanged', message: row.path };
  await writeJson(path.join(test.output, 'BROWSER_ACCEPTANCE.json'), { schemaVersion: 1, passed: !failure, failure, checks: test.checks, identity: test.identity, events, network, moduleResponses, screenshots, pageErrors, consoleMessages,
    readonlyModuleEvidence: { url: activeModuleUrl, directStoreMutation: false }, video: { requested: false }, doesNotClaim: ['D7 rerun', 'D9 eight images rerun', 'Unity diagnostics fixed', 'Whole P3 PASS'] });
}
process.exitCode = await test.finish(failure) ? 0 : 1;
