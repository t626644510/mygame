import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { P2HttpContext, clone, isPersistingApiRequest } from './http-context.mjs';
import { startRecorded } from '../raw-evidence.mjs';
import { repository, readJson, sha256, snapshotFiles, compareLogBytes, writeJson } from './evidence.mjs';
import { compareTrees } from '../json-assertions.mjs';

const test = new P2HttpContext(process.argv.slice(2));
assert.ok(test.args['--browser-exe'] && test.args['--frontend-manifest']);
test.scope = 'Only listed real P2 browser C4-C11 checks; screenshots/performance and Unity are separate evidence.';
const selected = new Set((test.args['--only'] ?? 'C4,C11,C5,C6,C7,C10,C8').split(','));
assert.ok([...selected].every(id => ['C4', 'C4-read', 'C11', 'C5', 'C6', 'C7', 'C10', 'C8'].includes(id)));
const readC4 = selected.size === 1 && selected.has('C4-read');
if (readC4) assert.equal(test.args['--existing-content'], 'work/p2_verification_20261116/browser_003/browser/content', 'Read only the original C4 saved root; never reseed it.');
const url = 'http://127.0.0.1:5176';
const labels = { skill: '技能', character: '角色', encounter: '遭遇', trial: '试炼场', rule: '规则' };
const events = [], network = [], pendingNetwork = [], pageErrors = [], consoleMessages = [], screenshots = [];
let browserContext, browserCdp, frontend, frontendIdentity, page, failure, manifest, fixtureBefore;
let ambush, library, ambushMage, libraryMage, libraryEncounter, sourceAmbush, sourceLibrary, comparison;
let requestNumber = 0, swapped = false;
const record = (action, details = {}) => events.push({ utc: new Date().toISOString(), action, ...details });
const diskEntity = (type, id) => readJson(test.entityFile(type, id));
async function phase(id, action) {
  if (!selected.has(id)) return;
  record('phase-start', { id }); await test.phase(id, action); record('phase-passed', { id });
}
async function poll(read, predicate, message, attempts = 100) {
  for (let index = 0; index < attempts; index++) { const value = await read(); if (predicate(value)) return value; await sleep(100); }
  throw new Error(message);
}
async function screenshot(name) {
  const file = path.join(test.output, 'screenshots', `${name}.png`); await mkdir(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: false }); const bytes = await readFile(file); screenshots.push({ path: file, bytes: bytes.length, sha256: sha256(bytes), injectedStyle: false });
}
async function go(type, id) {
  await page.getByRole('button', { name: labels[type], exact: true }).click();
  await page.locator('.combat-entity-list button').filter({ has: page.locator('code', { hasText: id }) }).click();
  await page.waitForFunction(expected => document.querySelector('#field-id')?.value === expected, id);
  await page.locator({ character: '.combat-character', trial: '.trial-arena', encounter: '.combat-encounter', skill: '.combat-editor-grid', rule: '.combat-scroll' }[type]).waitFor();
}
async function save(type, id, expectedStatus = 200) {
  const response = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/content/${type}/${id}`);
  await page.getByTestId('save-combat-entity').click(); const result = await response; assert.equal(result.status(), expectedStatus);
  const body = await result.body(); record('actual-save', { type, id, status: result.status(), responseSha256: sha256(body) });
  return diskEntity(type, id);
}
async function waitPreview(id, predicate = () => true) {
  return poll(async () => {
    const last = [...network].reverse().find(row => row.url.endsWith('/api/character/validate') && row.status === 200 && row.requestJson?.character?.id === id && row.json);
    const text = await page.getByTestId('instruction-capacity').textContent().catch(() => '');
    return last?.json && new RegExp(`\\/\\s*${last.json.instructionCapacity}\\s*条`).test(text) ? last.json : undefined;
  }, value => !!value && predicate(value), `No actual ready core preview for ${id}`);
}
function row(id) { return page.locator('.combat-rule').filter({ has: page.locator(`code`, { hasText: id }) }).filter({ has: page.locator(`[data-field]`) }); }
function rule(id) { return page.locator(`article[data-instruction-id="${id}"]`); }
async function editCondition(instructionId) {
  await rule(instructionId).locator('.condition-token').click(); const dialog = page.getByRole('dialog', { name: '编辑条件组' }); await dialog.waitFor(); return dialog;
}
async function apply(dialog) { await dialog.getByRole('button', { name: '应用条件', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); }
async function coreReasons(preview) {
  for (const instruction of preview.instructions) {
    const article = rule(instruction.id); await article.locator('details.core-display summary').click();
    assert.equal(await article.getByTestId('core-validation-reason').innerText(), instruction.validationReason);
    assert.equal(await article.locator('details.core-display > p').first().innerText(), instruction.display);
  }
}
async function runCurrentTrial() {
  const response = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/trial/run');
  await page.getByTestId('run-trial').click(); const result = await response; assert.equal(result.status(), 200);
  const model = await result.json(); await page.getByTestId('trial-result').waitFor(); return model;
}
async function frontendMetadata(name) {
  const result = await test.command(name, test.args['--pwsh'], ['-NoProfile', '-File', path.join(repository, 'tools/editor-verification/owned-process.ps1'), '-OwnedProcessId', String(frontend.child.pid)]);
  const actual = JSON.parse(result.stdoutBytes.toString('utf8')); assert.equal(actual.processId, frontend.child.pid); assert.equal(actual.parentProcessId, process.pid);
  assert.equal(path.resolve(actual.executablePath).toLowerCase(), process.execPath.toLowerCase());
  assert.ok(actual.commandLine.includes('frontend-dev.mjs') && actual.commandLine.includes(test.work)); return actual;
}
async function freeFrontendPort() {
  await new Promise((resolve, reject) => { const socket = net.connect({ host: '127.0.0.1', port: 5176 }); socket.once('connect', () => { socket.destroy(); reject(new Error('Port 5176 already belongs to another service.')); }); socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error)); });
}

try {
  await test.initialize();
  manifest = await readJson(path.resolve(repository, test.args['--frontend-manifest']));
  assert.equal(new Set(manifest.files.map(row => row.path)).size, manifest.files.length);
  for (const file of manifest.files) assert.equal(sha256(await readFile(path.join(repository, file.path))), file.sha256, `Frozen frontend file changed: ${file.path}`);
  test.identity.frontend = { manifest: test.args['--frontend-manifest'], sourceHash: manifest.sourceHash, aggregateRule: manifest.aggregateRule, fileCount: manifest.files.length, files: manifest.files };
  test.identity.browser = { executable: path.resolve(test.args['--browser-exe']), sha256: sha256(await readFile(test.args['--browser-exe'])) };
  const originalContentBefore = readC4 ? await snapshotFiles(path.join(repository, test.args['--existing-content'])) : undefined;
  await test.start('browser', readC4 ? test.args['--existing-content'] : undefined);
  if (readC4) {
    const imports = await Promise.all((await readdir(path.join(test.content, '_imports'))).filter(file => file.endsWith('.json')).map(file => readJson(path.join(test.content, '_imports', file))));
    ambush = imports.find(row => row.sourceName === 'round2_ambush.json').id; library = imports.find(row => row.sourceName === 'round4_mage_library.json').id;
    assert.deepEqual(await snapshotFiles(test.content), originalContentBefore, 'Read-only startup touched the original C4 data.');
  } else { ambush = (await test.import('round2_ambush.json')).trialId; library = (await test.import('round4_mage_library.json')).trialId; }
  sourceAmbush = await readJson(path.join(test.output, 'original-inputs/round2_ambush.json')); sourceLibrary = await readJson(path.join(test.output, 'original-inputs/round4_mage_library.json'));
  const ambushTrial = (await test.get('trial', ambush)).json, libraryTrial = (await test.get('trial', library)).json;
  ambushMage = ambushTrial.allies.find(row => row.unitId === 'mage').characterId; libraryMage = libraryTrial.allies.find(row => row.unitId === 'mage').characterId; libraryEncounter = libraryTrial.encounters[0].encounterId;
  fixtureBefore = await snapshotFiles(test.content); await writeJson(path.join(test.output, 'fixture-before.json'), fixtureBefore);
  if (!readC4) { const compareOracle = await test.oracle('ambush-priority', 'compare-priority', sourceAmbush); comparison = await readJson(path.join(compareOracle, 'comparison.json')); }
  await freeFrontendPort();
  frontend = await startRecorded({ executable: process.execPath, args: [path.join(repository, 'tools/editor-verification/frontend-dev.mjs'), path.join(test.work, 'vite-cache')], cwd: path.join(repository, 'tools/editor-web'), prefix: path.join(test.output, 'frontend'), timeoutMs: 900000 });
  frontendIdentity = await frontendMetadata('frontend-identity-start');
  await poll(async () => { try { return (await fetch(url)).status; } catch { return 0; } }, status => status === 200, 'Owned Vite did not become ready.');
  const require = createRequire(import.meta.url); const { chromium } = require(path.join(repository, 'tools/editor-web/node_modules/playwright'));
  const temporary = path.join(test.work, 'browser-temp'), profile = path.join(test.work, 'browser-profile'); await mkdir(temporary); await mkdir(profile);
  test.browserLaunchAttempted = true;
  browserContext = await chromium.launchPersistentContext(profile, { executablePath: test.args['--browser-exe'], headless: true, viewport: { width: 1280, height: 800 }, env: { ...process.env, TEMP: temporary, TMP: temporary }, args: ['--no-first-run', '--no-default-browser-check'] });
  test.browserStarted = true; await browserContext.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await browserContext.addInitScript(() => localStorage.setItem('helper-theme', 'light'));
  browserCdp = await browserContext.browser().newBrowserCDPSession();
  const processes = await browserCdp.send('SystemInfo.getProcessInfo'), browserProcess = processes.processInfo.find(row => row.type === 'browser');
  const ownedBrowser = await test.command('browser-exact-owned-identity', test.args['--pwsh'], ['-NoProfile', '-File', path.join(repository, 'tools/editor-verification/owned-process.ps1'), '-OwnedProcessId', String(browserProcess.id)]);
  const browserIdentity = JSON.parse(ownedBrowser.stdoutBytes.toString('utf8')); assert.equal(browserIdentity.parentProcessId, process.pid); assert.ok(browserIdentity.commandLine.includes(profile));
  test.identity.browser.process = browserIdentity; test.identity.browser.cdpProcesses = processes.processInfo;
  page = browserContext.pages()[0] ?? await browserContext.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => pageErrors.push({ at: new Date().toISOString(), message: error.message, stack: error.stack }));
  page.on('console', message => consoleMessages.push({ at: new Date().toISOString(), type: message.type(), text: message.text() }));
  page.on('response', response => {
    const parsed = new URL(response.url()); if (!parsed.pathname.startsWith('/api/')) return;
    const number = ++requestNumber, request = response.request(), startedAt = new Date().toISOString();
    const pending = (async () => {
      const prefix = path.join(test.output, 'browser-network', String(number).padStart(4, '0')); await mkdir(path.dirname(prefix), { recursive: true });
      const requestBytes = request.postDataBuffer() ?? Buffer.alloc(0); await writeFile(prefix + '.request', requestBytes);
      let bytes, unavailable; try { bytes = await response.body(); await writeFile(prefix + '.response', bytes); } catch (error) { unavailable = error.message; }
      let json, requestJson; try { json = bytes && JSON.parse(bytes.toString('utf8')); } catch {} try { requestJson = JSON.parse(requestBytes.toString('utf8')); } catch {}
      let headers, headersUnavailable; try { headers = await response.allHeaders(); } catch (error) { headersUnavailable = error.message; }
      const saved = { number, startedAt, completedAt: new Date().toISOString(), url: response.url(), method: request.method(), status: response.status(), headers, headersUnavailable, request: { path: prefix + '.request', bytes: requestBytes.length, sha256: sha256(requestBytes) }, response: bytes ? { path: prefix + '.response', bytes: bytes.length, sha256: sha256(bytes) } : { unavailable }, json, requestJson };
      await writeJson(prefix + '.json', saved); network.push(saved);
    })(); pendingNetwork.push(pending);
  });
  await page.goto(`${url}/#/combat/character/${ambushMage}`); await page.waitForFunction(id => document.querySelector('#field-id')?.value === id, ambushMage);
  await waitPreview(ambushMage); assert.deepEqual(pageErrors, []);

  await phase('C4-read', async () => {
    const expected = ['fallback_attack', 'emergency_heal'];
    await page.waitForFunction(ids => JSON.stringify([...document.querySelectorAll('article[data-instruction-id]')].map(row => row.dataset.instructionId)) === JSON.stringify(ids), expected);
    const saved = await diskEntity('character', ambushMage); assert.deepEqual(saved.instructions.map(row => row.id), expected); assert.equal(Object.hasOwn(saved, 'availableActionIds'), false);
    const preview = await waitPreview(ambushMage); assert.deepEqual(preview.availableActions, ['first_aid', 'basic_attack']);
    assert.deepEqual(await snapshotFiles(test.content), originalContentBefore);
    assert.equal(network.some(row => isPersistingApiRequest(row.method, row.url)), false);
    await screenshot('C4-original-persisted-order-readonly');
    return { originalContent: test.content, original003SavedOrder: expected, coldComponentReady: true, poolStillMissing: true, actualCorePool: preview.availableActions, noSeedImportSaveOrWrite: true, fullDirectoryBytesUnchanged: true };
  });

  await phase('C4', async () => {
    const old = await readFile(test.entityFile('character', ambushMage)); const originalIds = sourceAmbush.units.find(row => row.id === 'mage').instructions.map(row => row.id);
    const grip = page.getByRole('button', { name: '拖动第 2 条指令', exact: true }); await grip.click(); await page.keyboard.press('Space');
    await page.waitForFunction(() => !!document.querySelector('.combat-rule.dragging'));
    record('keyboard-drag-picked', { id: originalIds[1] });
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(id => [...document.querySelectorAll('[role="status"]')].some(element => element.textContent.includes('moved over droppable area ' + id)), originalIds[0]);
    record('keyboard-drag-over-target', { id: originalIds[0] }); await page.keyboard.press('Space');
    await page.waitForFunction(ids => JSON.stringify([...document.querySelectorAll('article[data-instruction-id]')].map(row => row.dataset.instructionId)) === JSON.stringify(ids), [originalIds[1], originalIds[0]]);
    assert.ok(old.equals(await readFile(test.entityFile('character', ambushMage))), 'Unsaved keyboard drag wrote disk.');
    await go('trial', ambush);
    const response = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/trial/compare');
    await page.getByTestId('compare-trial').click(); const actual = await response; assert.equal(actual.status(), 200); const model = await actual.json();
    assert.deepEqual(model.comparison.firstDivergence, comparison.firstDivergence);
    const card = page.getByTestId('comparison-card'); await card.waitFor(); const text = await card.innerText(); const expected = comparison.firstDivergence;
    assert.ok(text.includes(`记录序号 ${expected.recordIndex}`));
    for (const side of ['baseline', 'variant']) { assert.ok(text.includes(expected[side].actionId)); assert.ok(text.includes(expected[side].targetId)); }
    assert.ok(text.includes(`WAIT ${expected.variant?.time ?? expected.baseline.time}`));
    await screenshot('C4-actual-comparison'); await go('character', ambushMage); const saved = await save('character', ambushMage);
    assert.deepEqual(saved.instructions.map(row => row.id), [originalIds[1], originalIds[0]]); swapped = true;
    await page.reload(); await page.waitForFunction(id => document.querySelector('#field-id')?.value === id, ambushMage);
    await page.waitForFunction(ids => JSON.stringify([...document.querySelectorAll('article[data-instruction-id]')].map(row => row.dataset.instructionId)) === JSON.stringify(ids), [originalIds[1], originalIds[0]]);
    return { independentOracle: 'oracle/ambush-priority/comparison.json', firstDivergence: expected, keyboard: ['Space', 'ArrowUp', 'Space'], actualSave: 200, persistedOrder: saved.instructions.map(row => row.id) };
  });
  await phase('C11', async () => {
    await go('trial', ambush); const model = await runCurrentTrial(); const steps = model.result.steps;
    const expected = clone(sourceAmbush); if (swapped) expected.units.find(row => row.id === 'mage').instructions.reverse();
    const direct = await test.oracle('ambush-ui-run', 'single', expected); assert.deepEqual(compareTrees(await readJson(path.join(direct, 'run-result.json')), model.result), []);
    const logs = compareLogBytes(await readFile(path.join(direct, 'combat.log')), Buffer.from(model.logText, 'utf8')); assert.equal(logs.equal, true);
    const runCount = network.filter(row => row.url.endsWith('/api/trial/run')).length;
    await page.getByRole('button', { name: '单步', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('.combat-step').length === 1);
    await page.getByRole('button', { name: '单步', exact: true }).click(); await page.getByRole('button', { name: '显示全部', exact: true }).click();
    assert.equal(network.filter(row => row.url.endsWith('/api/trial/run')).length, runCount, 'Local reveal requested a second simulation.');
    const actors = steps.filter(row => row.actorId); const inspected = [...new Set([0, actors.reduce((best, row, index) => row.attempts.length > actors[best].attempts.length ? index : best, 0), actors.length - 1])];
    for (const index of inspected) {
      const step = actors[index]; await page.locator('.run-timeline circle[role="button"]').nth(index).click();
      await page.waitForFunction(value => document.querySelector('.step-inspector .inspector-heading code')?.textContent === '#' + value, step.index);
      const articles = page.locator('.attempt-record'); assert.equal(await articles.count(), step.attempts.length);
      for (let attemptIndex = 0; attemptIndex < step.attempts.length; attemptIndex++) {
        const attempt = step.attempts[attemptIndex], article = articles.nth(attemptIndex);
        assert.equal(await article.locator('.attempt-reason').innerText(), attempt.reason);
        if (!await article.locator('details').evaluate(element => element.open)) await article.locator('details summary').click();
        assert.equal(await article.locator('.candidate-record').count(), attempt.candidates.length);
        for (let candidate = 0; candidate < attempt.candidates.length; candidate++) assert.equal(await article.locator('.candidate-record').nth(candidate).locator('p').innerText(), attempt.candidates[candidate].reason);
      }
    }
    const jumpStep = actors.find(step => step.attempts.some(attempt => model.bindings.some(binding => binding.unitId === step.actorId && binding.instructionId === attempt.instructionId && binding.entityType === 'character')));
    const actorIndex = actors.findIndex(step => step.index === jumpStep.index); await page.locator('.run-timeline circle[role="button"]').nth(actorIndex).click();
    const attemptIndex = jumpStep.attempts.findIndex(attempt => model.bindings.some(binding => binding.unitId === jumpStep.actorId && binding.instructionId === attempt.instructionId && binding.entityType === 'character'));
    const attempt = jumpStep.attempts[attemptIndex], binding = model.bindings.find(binding => binding.unitId === jumpStep.actorId && binding.instructionId === attempt.instructionId && binding.entityType === 'character');
    await page.locator('.attempt-record').nth(attemptIndex).getByRole('button', { name: '跳到这条指令', exact: true }).click();
    await page.waitForFunction(id => document.querySelector('#field-id')?.value === id, binding.entityId);
    await rule(attempt.instructionId).waitFor();
    await page.waitForFunction(id => document.querySelector(`article[data-instruction-id="${id}"]`)?.classList.contains('highlighted'), attempt.instructionId);
    await page.waitForFunction(id => document.querySelector(`article[data-instruction-id="${id}"]`)?.contains(document.activeElement), attempt.instructionId);
    return { actualCoreRunEqual: true, log: logs, inspectedStepIndices: inspected.map(index => actors[index].index), revealDidNotRerun: true, jump: { characterId: binding.entityId, instructionId: attempt.instructionId } };
  });
  await phase('C5', async () => {
    await go('character', libraryMage); await waitPreview(libraryMage);
    await page.locator('[id="field-attributes.2.value"]').fill('10');
    const core = await waitPreview(libraryMage, value => value.instructionCapacity === 2); await page.waitForFunction(() => document.querySelector('[data-testid="instruction-capacity"]')?.textContent.includes('5 / 2'));
    const direct = await readJson(path.join(repository, 'outputs/helper_editor_p2/verification/http_semantics_002/comparisons/mage-int-10.json'));
    assert.deepEqual(core.instructions, direct.preview.instructions); await coreReasons(core);
    const nextId = await page.getByTestId('capacity-divider').evaluate(element => element.parentElement.querySelector('article')?.dataset.instructionId); assert.equal(nextId, sourceLibrary.units.find(row => row.id === 'mage').instructions[2].id);
    let saved = await save('character', libraryMage); assert.equal(saved.attributes[2].value, 10);
    await page.reload(); await page.waitForFunction(id => document.querySelector('#field-id')?.value === id, libraryMage); await waitPreview(libraryMage, value => value.instructionCapacity === 2);
    await page.locator('[id="field-attributes.2.value"]').fill('40'); await waitPreview(libraryMage, value => value.conditionTermCapacity === 3 && value.instructionCapacity === 5); saved = await save('character', libraryMage);
    assert.equal(saved.attributes[2].value, 40); assert.deepEqual(saved.availableActionIds, sourceLibrary.units.find(row => row.id === 'mage').availableActionIds);
    return { persistedIntelligence10: true, directReasonsEqual: true, dividerBeforeInstruction: nextId, restored40: true };
  });
  await phase('C6', async () => {
    await go('character', libraryMage); await waitPreview(libraryMage, value => value.conditionTermCapacity === 3);
    const ids = sourceLibrary.units.find(row => row.id === 'mage').instructions.map(row => row.id);
    for (let index = 0; index < 2; index++) {
      const dialog = await editCondition(ids[index]); while (await dialog.locator('.condition-term').count() < 3) await dialog.getByRole('button', { name: '添加条件', exact: true }).click();
      await dialog.getByLabel('条件1类型', { exact: true }).selectOption('hp_ratio_at_most'); await dialog.getByLabel('条件1阈值', { exact: true }).fill('35'); await dialog.getByLabel('条件1读取来源', { exact: true }).selectOption('target');
      await dialog.getByLabel('条件2类型', { exact: true }).selectOption('row_is'); await dialog.getByLabel('条件2阈值', { exact: true }).selectOption('2');
      await dialog.getByLabel('条件3类型', { exact: true }).selectOption('mp_ratio_at_least'); await dialog.getByLabel('条件3阈值', { exact: true }).fill('10'); await dialog.getByLabel('条件3读取来源', { exact: true }).selectOption('actor');
      await dialog.getByLabel('连接符1', { exact: true }).selectOption('and'); await dialog.getByLabel('连接符2', { exact: true }).selectOption('or'); await dialog.getByLabel('括号位置', { exact: true }).selectOption(index ? 'right' : 'left'); await apply(dialog); await waitPreview(libraryMage);
    }
    const saved = await save('character', libraryMage);
    for (let index = 0; index < 2; index++) { const condition = saved.instructions[index].condition; assert.equal(condition.operation, 'mixed'); assert.deepEqual(condition.operators, ['and', 'or']); assert.equal(condition.grouping, index ? 'right' : 'left'); assert.equal(condition.terms[0].threshold, 0.35); assert.equal(condition.terms[1].threshold, 2); }
    await page.reload(); await page.waitForFunction(id => document.querySelector('#field-id')?.value === id, libraryMage); const core = await waitPreview(libraryMage);
    assert.ok(core.instructions.slice(0, 2).every(row => row.actionAvailable && row.capacityAllowed));
    return { left: saved.instructions[0].condition, right: saved.instructions[1].condition, actualSaveAndReload: true };
  });
  await phase('C7', async () => {
    await go('character', libraryMage); await waitPreview(libraryMage, value => value.conditionTermCapacity === 3);
    const id = sourceLibrary.units.find(row => row.id === 'mage').instructions[0].id, before = await readFile(test.entityFile('character', libraryMage));
    const dialog = await editCondition(id); await dialog.getByLabel('条件1类型', { exact: true }).selectOption('hp_ratio_at_most'); await dialog.getByLabel('条件1阈值', { exact: true }).fill('35');
    while (await dialog.locator('.condition-term').count() < 2) await dialog.getByRole('button', { name: '添加条件', exact: true }).click();
    await dialog.getByLabel('条件2类型', { exact: true }).selectOption('opponents_alive_at_least'); await dialog.getByLabel('条件2阈值', { exact: true }).fill('2.5');
    assert.equal(await dialog.getByRole('button', { name: '应用条件', exact: true }).isDisabled(), true); assert.ok((await dialog.getByRole('alert').allTextContents()).join('').includes('整数')); assert.ok(before.equals(await readFile(test.entityFile('character', libraryMage))));
    await dialog.getByLabel('条件2类型', { exact: true }).selectOption('row_is'); await dialog.getByLabel('条件2阈值', { exact: true }).selectOption('2'); await apply(dialog);
    const saved = await save('character', libraryMage); assert.equal(saved.instructions[0].condition.terms[0].threshold, 0.35); assert.equal(saved.instructions[0].condition.terms[1].threshold, 2);
    return { percentInput: 35, storedRatio: 0.35, rearRowStored: 2, fractionalIntegerDisabled: true, diskUnchangedWhileInvalid: true };
  });
  await phase('C10', async () => {
    await go('encounter', libraryEncounter); const original = await diskEntity('encounter', libraryEncounter); const grid = page.locator('.formation-grid[aria-label="敌方站位"]'); await grid.waitFor();
    const template = page.locator('.formation-palette .draggable-characters button').filter({ has: page.locator('code', { hasText: original.enemies[0].characterId }) });
    const occupied = grid.locator(`button[data-row="${original.enemies[0].row}"][data-column="${original.enemies[0].column}"]`); await template.dragTo(occupied);
    await page.getByTestId('formation-error').waitFor(); assert.ok((await page.getByTestId('formation-error').innerText()).includes('占')); assert.deepEqual((await diskEntity('encounter', libraryEncounter)).enemies, original.enemies);
    await template.click(); let placed = original.enemies.length;
    while (placed < 6) { await grid.getByRole('button', { name: /空位$/ }).first().click(); placed++; }
    await grid.getByRole('button', { name: /空位$/ }).first().click(); assert.ok((await page.getByTestId('formation-error').innerText()).includes('6'));
    const saved = await save('encounter', libraryEncounter); assert.equal(saved.enemies.length, 6); assert.equal(new Set(saved.enemies.map(row => `${row.row}:${row.column}`)).size, 6);
    return { collisionRejected: true, seventhRejected: true, persistedValidEnemies: saved.enemies.length, noPositionOverwrite: true };
  });
  await phase('C8', async () => {
    await page.getByRole('button', { name: '技能', exact: true }).click(); await page.locator('.combat-toolbar-actions').getByRole('button', { name: '新建技能', exact: true }).click();
    const id = 'ui_pending_skill'; await page.locator('#field-id').fill(id); await page.locator('#field-displayName').fill('独立UI待实现样本'); await page.locator('#field-effectKind').selectOption('pending');
    await page.getByTestId('save-combat-entity').click(); await page.locator('.combat-problems').waitFor();
    await assert.rejects(readFile(test.entityFile('skill', id)), { code: 'ENOENT' });
    await page.getByRole('button', { name: /备注 \/ 需求/ }).click(); const dialog = page.getByRole('dialog', { name: '登记待实现战斗效果' }); await dialog.waitFor();
    await dialog.getByLabel('战斗需求类型').selectOption('new_effect'); await dialog.getByLabel('战斗需求标题').fill('独立UI待实现需求'); await dialog.getByLabel('战斗需求说明').fill('隔离验收需求，不授权实现。'); await dialog.getByRole('button', { name: '附上需求', exact: true }).click();
    const saved = await save('skill', id, 201); assert.equal(saved.effectKind, 'pending'); assert.equal(saved.draft, true);
    assert.ok((await readFile(path.join(test.content, 'REQUESTS.md'), 'utf8')).includes(`skill:${id}`));
    await go('character', libraryMage); const learned = page.locator('.learned-action').filter({ has: page.locator('code', { hasText: id }) }); await learned.locator('input[type="checkbox"]').check();
    const equipped = await save('character', libraryMage); assert.ok(equipped.availableActionIds.includes(id)); await go('trial', library);
    const response = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/trial/run'); await page.getByTestId('run-trial').click(); const rejected = await response; assert.equal(rejected.status(), 422);
    await page.locator('.trial-error').waitFor(); const error = await page.locator('.trial-error').innerText(); assert.ok(error.includes(id) && error.includes(libraryMage));
    const before = await snapshotFiles(test.runtime); const blocked = await test.api('/api/export', 'POST', {}); test.require422(blocked, id); assert.deepEqual(await snapshotFiles(test.runtime), before);
    await go('character', libraryMage); await page.locator('.learned-action').filter({ has: page.locator('code', { hasText: id }) }).locator('input[type="checkbox"]').uncheck(); await save('character', libraryMage);
    const exported = await test.api('/api/export', 'POST', {}); assert.equal(exported.status, 200); assert.equal((await readJson(path.join(test.runtime, 'skills.json'))).skills.some(skill => skill.id === id), false);
    return { noRequestNotSaved: true, compoundCreate: 201, pendingDraft: true, actualTrialRun: 422, errorContainsSkillAndCharacter: true, restoredValidExport: 200, pendingExcluded: true };
  });
  assert.deepEqual(pageErrors, []);
} catch (error) {
  failure = { check: test.activeCheck, category: test.activeCheck === 'Preflight' ? 'HarnessOrEnvironmentPrecondition_NotProductRun' : 'BrowserAcceptanceFailure_RequiresProductHarnessEnvironmentTriage', message: error.message, stack: error.stack };
  if (page) { try { await screenshot('FAILURE'); await writeFile(path.join(test.output, 'FAILURE.html'), await page.content()); } catch {} }
} finally {
  if (browserContext) {
    try { await browserContext.tracing.stop({ path: path.join(test.output, 'trace.zip') }); await browserContext.close(); record('owned-browser-context-closed'); }
    catch (error) { failure ??= { check: 'BrowserCleanup', message: error.message }; }
  }
  const captured = await Promise.allSettled(pendingNetwork);
  const captureErrors = captured.filter(row => row.status === 'rejected').map(row => String(row.reason));
  if (captureErrors.length) failure ??= { check: 'BrowserEvidenceCapture', category: 'HarnessEvidenceFailure', message: captureErrors.join('\n') };
  if (test.identity?.browser?.process) {
    try {
      const pid = Number(test.identity.browser.process.processId);
      const script = `$ownedAfter = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; [pscustomobject]@{processId=${pid};present=[bool]$ownedAfter;observedUtc=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress`;
      const result = await test.command('browser-exactpid-after-close', test.args['--pwsh'], ['-NoProfile', '-Command', script]);
      test.identity.browser.afterClose = JSON.parse(result.stdoutBytes.toString('utf8')); assert.equal(test.identity.browser.afterClose.present, false);
    } catch (error) { failure ??= { check: 'OwnedBrowserAbsence', category: 'CleanupEvidenceFailure', message: error.message }; }
  }
  if (frontend) {
    try { const actual = await frontendMetadata('frontend-identity-before-stop'); assert.equal(actual.startedAtUtc, frontendIdentity.startedAtUtc); }
    catch (error) { failure ??= { check: 'FrontendIdentityCleanup', message: error.message }; }
    const stopped = await frontend.stop(); const { stdoutBytes, stderrBytes, ...receipt } = stopped; test.identity.frontendService = { actual: frontendIdentity, stopped: receipt }; await freeFrontendPort();
  }
  if (manifest) for (const file of manifest.files) if (sha256(await readFile(path.join(repository, file.path))) !== file.sha256) failure ??= { check: 'FrontendSourceVersion', message: `Frozen source changed: ${file.path}` };
  await writeJson(path.join(test.output, 'BROWSER_ACCEPTANCE.json'), { schemaVersion: 1, passed: !failure, failure, checks: test.checks, identity: test.identity, events, pageErrors, consoleMessages, network, screenshots, fixtureBefore, fixtureAfter: test.content ? await snapshotFiles(test.content) : undefined, video: { requested: false, reason: 'Independent functional trace/HTTP/PNG suffice; existing frontend videos remain separate. No ffmpeg/runtime download.' }, sourceOwner: 'frontend manifest; no CSS injection, mocked API, direct store mutation or user profile', doesNotClaim: ['C12 eight screenshots rerun', 'C13 performance rerun', 'P2 whole-phase PASS', 'Native Unity issue fixed'] });
}
process.exitCode = await test.finish(failure) ? 0 : 1;
