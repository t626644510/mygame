import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { P2HttpContext, clone } from './http-context.mjs';
import { compareTrees } from '../json-assertions.mjs';
import { compareLogBytes, readJson, snapshotFiles, sha256, writeJson } from './evidence.mjs';

const test = new P2HttpContext(process.argv.slice(2));
let failure;
let trialId, trial, character, pending, draftItem, beforePendingExport, beforePendingValues;
function editorKeys(value, pointer = '') {
  const found = [];
  if (Array.isArray(value)) value.forEach((row, index) => found.push(...editorKeys(row, `${pointer}/${index}`)));
  else if (value && typeof value === 'object') for (const [key, row] of Object.entries(value)) {
    if (['notes', 'draft', 'sourceJson', 'sourceSha256', 'baselineJson', 'editIntent', 'editIntents', 'bindings', 'edits'].includes(key)) found.push(`${pointer}/${key}`);
    found.push(...editorKeys(row, `${pointer}/${key}`));
  }
  return found;
}
async function exportAndVerify(expectedTables) {
  const result = await test.api('/api/export', 'POST', {}); assert.equal(result.status, 200);
  const manifest = await readJson(path.join(test.runtime, 'manifest.json'));
  assert.deepEqual(manifest.files.map(row => row.path).sort(), expectedTables.map(row => `${row}.json`).sort());
  for (const file of manifest.files) {
    const bytes = await readFile(path.join(test.runtime, file.path)); assert.equal(sha256(bytes), file.sha256);
    const parsed = JSON.parse(bytes.toString('utf8')); const collection = file.path.replace('.json', '');
    assert.equal(parsed[collection].length, file.count);
    assert.deepEqual(parsed[collection].map(row => row.id), parsed[collection].map(row => row.id).sort());
    assert.deepEqual(editorKeys(parsed), []);
  }
  assert.equal(manifest.contentHash, sha256(Buffer.from(manifest.files.map(row => `${row.path}\n${row.sha256}\n`).join(''), 'utf8')));
  return manifest;
}
async function failedExportUnchanged(action, needle) {
  const content = await snapshotFiles(test.content), target = await snapshotFiles(test.runtime);
  const result = await action(); test.require422(result, needle);
  assert.deepEqual(await snapshotFiles(test.content), content);
  assert.deepEqual(await snapshotFiles(test.runtime), target, 'Failed export changed a path or byte anywhere in the target.'); return result;
}

try {
  await test.initialize(); await test.start('draft-export');
  const continueAfterExport = test.args['--continue-after-export'] === 'true';
  test.identity.executionBoundary = continueAfterExport ? 'Repair CLI export-scenario plus previously unexecuted refs/draft/equipment; prior successful global export/draft checks inherited.' : 'Initial export checks then refs/draft/equipment.';
  if (!continueAfterExport) await test.phase('P1.ValidIndependentDraftItemExcludedWhileFiveItemExportSucceeds', async () => {
    await writeFile(path.join(test.runtime, 'keep.meta'), Buffer.from([0, 13, 10, 255]));
    await writeFile(path.join(test.runtime, 'unmanaged.bin'), Buffer.from([67, 10, 13, 0, 254]));
    const initial = await exportAndVerify(['items']); const initialTree = await snapshotFiles(test.runtime);
    const grain = (await test.get('item', 'mat_grain')).json;
    draftItem = { ...clone(grain), id: 'mat_independent_draft', aliases: [], name: '隔离合法草稿材料', draft: true };
    const create = await test.api(`/api/content/item/${draftItem.id}`, 'PUT', draftItem, { 'If-None-Match': '*' }); assert.equal(create.status, 201);
    const after = await exportAndVerify(['items']); assert.equal(after.contentHash, initial.contentHash);
    assert.deepEqual(await snapshotFiles(test.runtime), initialTree);
    const items = (await readJson(path.join(test.runtime, 'items.json'))).items;
    assert.equal(items.length, 5); assert.equal(items.some(row => row.id === draftItem.id), false);
    assert.deepEqual(items.find(row => row.id === 'expedition_ore').aliases, ['expedition-ore']);
    assert.deepEqual(items.find(row => row.id === 'quenching_sand').aliases, ['quenching-sand']);
    const sword = items.find(row => row.id === 'eq_patrol_sword');
    // The original bridge is read directly, without introducing a new unit or formula.
    const originalPreparation = await readJson(path.resolve('Game/Assets/StreamingAssets/Prototype/BaseEconomy/preparation.json'));
    assert.equal(sword.equipment.enhancement[0].materials.find(row => row.itemId === 'expedition_ore').quantity, originalPreparation.oreRequired);
    assert.equal(sword.equipment.enhancement[0].materials.find(row => row.itemId === 'quenching_sand').quantity, originalPreparation.auxiliaryRequired);
    assert.equal(sword.equipment.enhancement[0].attackBonusDelta, originalPreparation.enhancementAttackBonus);
    assert.equal(sword.aliases.includes('guard-linen-sword-001'), false);
    return { originalFive: 5, excludedDraft: draftItem.id, runtimeItemsSha256: initial.files[0].sha256, bridge: 'Existing preparation fields; no new Runtime rule or unit.' };
  });
  if (continueAfterExport) {
    await writeFile(path.join(test.runtime, 'keep.meta'), Buffer.from([0, 13, 10, 255]));
    await writeFile(path.join(test.runtime, 'unmanaged.bin'), Buffer.from([67, 10, 13, 0, 254]));
    const grain = (await test.get('item', 'mat_grain')).json;
    draftItem = { ...clone(grain), id: 'mat_independent_draft', aliases: [], name: '隔离合法草稿材料', draft: true };
    const create = await test.api(`/api/content/item/${draftItem.id}`, 'PUT', draftItem, { 'If-None-Match': '*' }); assert.equal(create.status, 201);
  }
  await test.phase(continueAfterExport ? 'Repair.CLIExportScenarioPureRuntimeAndNativeLog' : 'Export.NewTablesDeterministicAndIndependentScenarioUsesActualCore', async () => {
    trialId = (await test.import('default.json')).trialId;
    trial = (await test.get('trial', trialId)).json;
    character = (await test.get('character', trial.allies.find(row => row.unitId === 'mage').characterId)).json;
    const first = await exportAndVerify(['items', 'skills', 'characters', 'encounters']);
    if (!continueAfterExport) {
      const firstTree = await snapshotFiles(test.runtime);
      await exportAndVerify(['items', 'skills', 'characters', 'encounters']); assert.deepEqual(await snapshotFiles(test.runtime), firstTree);
      await test.command('same-export-cli', test.dotnet, [test.cli, 'export', '--content', test.content, '--out', test.runtime]);
      assert.deepEqual(await snapshotFiles(test.runtime), firstTree);
    }
    const scenario = await test.api('/api/export-scenario', 'POST', { trialId }); assert.equal(scenario.status, 200);
    assert.equal(scenario.json.path, `_exports/${trialId}.json`);
    const bytes = await readFile(path.join(test.content, scenario.json.path)); assert.equal(sha256(bytes), scenario.json.sha256);
    const cliOut = path.join(test.output, 'exported-scenario-cli.json');
    await test.command('scenario-export-cli', test.dotnet, [test.cli, 'export-scenario', trialId, '--content', test.content, '--out', cliOut]);
    assert.ok(bytes.equals(await readFile(cliOut)));
    const parsed = JSON.parse(bytes.toString('utf8')); assert.deepEqual(editorKeys(parsed), []);
    const source = await readJson(path.join(test.output, 'original-inputs/default.json'));
    assert.deepEqual(compareTrees(source, parsed), []);
    const oracle = await test.oracle('exported-scenario', 'single', parsed);
    const actual = await test.run(trialId);
    const log = compareLogBytes(await readFile(path.join(oracle, 'combat.log')), Buffer.from(actual.logText, 'utf8')); assert.equal(log.equal, true);
    await writeJson(path.join(test.output, 'comparisons/exported-scenario.json'), { log, runtimeConfigDifference: compareTrees(source, parsed), manifest: first });
    return 'comparisons/exported-scenario.json';
  });
  await test.phase('Refs.NewTypedEdgesBlockDeletionAndRejectWrongTypes', async () => {
    const actionId = character.instructions[0].actionId;
    for (const [type, id, sourceType, pointer] of [['skill', actionId, 'character', '/instructions/0/actionId'], ['character', character.id, 'trial', '/allies/0/characterId'], ['encounter', trial.encounters[0].encounterId, 'trial', '/encounters/0/encounterId'], ['rule', trial.encounters[0].rulesId, 'trial', '/encounters/0/rulesId']]) {
      const refs = await test.api(`/api/refs/${id}`); assert.equal(refs.status, 200); assert.ok(Array.isArray(refs.json));
      assert.ok(refs.json.some(row => row.sourceType === sourceType && row.jsonPointer === pointer && row.quantity === null && row.legacy === false));
      const current = await test.get(type, id);
      const denied = await test.unchanged(() => test.api(`/api/content/${type}/${id}`, 'DELETE', undefined, { 'If-Match': current.response.headers.etag }));
      assert.equal(denied.status, 409); assert.equal(denied.json.code, 'referenced'); assert.ok(denied.json.refs.length);
    }
    const canonical = await test.api('/api/refs/expedition_ore'), alias = await test.api('/api/refs/expedition-ore');
    assert.equal(canonical.status, 200); assert.equal(alias.status, 200); assert.deepEqual(canonical.json, alias.json);
    assert.ok(canonical.json.some(row => row.path === 'items/eq_patrol_sword.json' && row.quantity === 3));
    const wrong = clone(character); wrong.instructions[0].actionId = 'expedition_ore';
    const rejected = await test.unchanged(() => test.api('/api/validate-entity', 'POST', { type: 'character', mode: 'update', entity: wrong })); test.require422(rejected);
    return { referencedDeletes: 4, deleteStatus: 409, typedSkillReferenceReject: 422, aliasesSameRefs: true };
  });
  await test.phase('C8.PendingSkillRequiresAtomicCombatRequestAndUnrelatedExportStillSucceeds', async () => {
    pending = { schemaVersion: 1, id: 'verify_pending_skill', displayName: '隔离待实现效果', description: '', effectKind: 'pending', magnitude: 0, mpCost: 0, baseWait: 1, draft: true };
    const noRequest = await test.unchanged(() => test.api(`/api/content/skill/${pending.id}`, 'PUT', pending, { 'If-None-Match': '*' })); test.require422(noRequest, 'pending');
    const body = { entity: pending, requests: [{ kind: 'new_effect', owner: 'combat', title: '隔离P2待实现效果', body: '仅用于验证需求与草稿事务，不授权实现。', expected: '', field: 'effectKind', createdAt: '' }] };
    const saved = await test.api(`/api/content/skill/${pending.id}`, 'PUT', body, { 'If-None-Match': '*' }); assert.equal(saved.status, 201);
    assert.equal(saved.json.createdRequests.length, 1); assert.equal(saved.json.createdRequests[0].target, `skill:${pending.id}`); assert.equal(saved.json.createdRequests[0].status, 'open');
    const markdown = await readFile(path.join(test.content, 'REQUESTS.md'), 'utf8'); assert.ok(markdown.includes('combat') && markdown.includes(pending.id) && markdown.includes('隔离P2待实现效果'));
    const manifest = await exportAndVerify(['items', 'skills', 'characters', 'encounters']);
    assert.equal((await readJson(path.join(test.runtime, 'skills.json'))).skills.some(row => row.id === pending.id), false);
    assert.equal((await readJson(path.join(test.runtime, 'items.json'))).items.some(row => row.id === draftItem.id), false);
    beforePendingExport = await snapshotFiles(test.runtime);
    beforePendingValues = Object.fromEntries(await Promise.all(manifest.files.map(async row => [row.path, await readJson(path.join(test.runtime, row.path))])));
    return { newRequestTarget: saved.json.createdRequests[0].target, legalUnrelatedExport: true, manifest };
  });
  await test.phase('C8.ActiveWhitelistPendingBlocksRunAndBothExportsWithoutPartialWrites', async () => {
    const candidate = clone(character); candidate.availableActionIds = [...new Set([...(candidate.availableActionIds ?? []), ...candidate.instructions.map(row => row.actionId), pending.id])]; candidate.availableActionIdsExplicit = true;
    await test.save('character', candidate, [{ op: 'set', path: '/availableActionIds' }, { op: 'set', path: '/availableActionIdsExplicit' }]);
    const contentBefore = await snapshotFiles(test.content);
    const run = await test.unchanged(() => test.api('/api/trial/run', 'POST', { trialId })); test.require422(run, pending.id); assert.ok(JSON.stringify(run.json.errors).includes(character.id));
    await failedExportUnchanged(() => test.api('/api/export', 'POST', {}), pending.id);
    const scenario = await test.unchanged(() => test.api('/api/export-scenario', 'POST', { trialId })); test.require422(scenario, pending.id);
    const cliBefore = await snapshotFiles(test.runtime);
    await test.command('pending-export-cli', test.dotnet, [test.cli, 'export', '--content', test.content, '--out', test.runtime], 1);
    assert.deepEqual(await snapshotFiles(test.runtime), cliBefore); assert.deepEqual(await snapshotFiles(test.content), contentBefore);
    assert.deepEqual(await snapshotFiles(test.runtime), beforePendingExport);
    await test.save('character', character, ['availableActionIds', 'availableActionIdsExplicit'].map(field => ({ op: Object.hasOwn(character, field) ? 'set' : 'remove', path: `/${field}` })));
    await exportAndVerify(['items', 'skills', 'characters', 'encounters']);
    for (const [file, value] of Object.entries(beforePendingValues)) assert.deepEqual(compareTrees(value, await readJson(path.join(test.runtime, file))), [], 'Restored successful export changed a semantic definition.');
    return { run: 422, globalExport: 422, independentExport: 422, cliExportExit: 1, allTargetPathsAndBytesUnchanged: true };
  });
  await test.phase('P1.DefaultEquipmentUsesBasicBonusAndDraftDefinitionBlocksOnlyRelatedRun', async () => {
    const formalSword = (await test.get('item', 'eq_patrol_sword')).json;
    const sword = { ...clone(formalSword), id: 'eq_probe_basic', aliases: [], name: '隔离基础加成7', equipment: { ...clone(formalSword.equipment), combatBonus: [{ id: 'equipmentDamageBonus', value: 7 }] } };
    const itemCreate = await test.api(`/api/content/item/${sword.id}`, 'PUT', sword, { 'If-None-Match': '*' }); assert.equal(itemCreate.status, 201);
    const trialCandidate = { schemaVersion: 1, id: 'trial_equipment_probe', title: '隔离基础装备投影', playerTeam: 'friendly', carryTeam: 'friendly', draft: false,
      rulesId: 'rules_combat', allies: [{ unitId: 'mage', characterId: character.id, team: 'friendly', row: 2, column: 1, hp: -1, mp: -1, equipmentDamageBonus: -1, equipmentSourceId: '' }],
      encounters: [{ encounterId: trial.encounters[0].encounterId, rulesId: 'rules_combat', waitBefore: 0 }] };
    const slot = trialCandidate.allies[0];
    const candidate = clone(character); candidate.defaultEquipment = [{ slot: sword.equipment.slot, itemId: sword.id }];
    await test.save('character', candidate, [{ op: 'set', path: '/defaultEquipment' }]);
    const newTrial = await test.api(`/api/content/trial/${trialCandidate.id}`, 'PUT', trialCandidate, { 'If-None-Match': '*' }); assert.equal(newTrial.status, 201);
    const assembled = await test.assemble(trialCandidate.id); const unit = assembled.config.units.find(row => row.id === slot.unitId);
    const basic = sword.equipment.combatBonus.filter(row => row.id === 'equipmentDamageBonus').reduce((sum, row) => sum + row.value, 0);
    assert.equal(unit.equipmentDamageBonus, basic); assert.equal(unit.equipmentSourceId, sword.id);
    assert.equal(basic, 7); assert.notEqual(unit.equipmentDamageBonus, basic + sword.equipment.enhancement[0].attackBonusDelta);
    const explicitZero = clone(trialCandidate); explicitZero.allies[0].equipmentDamageBonus = 0; explicitZero.allies[0].equipmentSourceId = 'guard-linen-sword-001';
    const zeroAssembly = await test.api('/api/assemble', 'POST', { trial: explicitZero }); assert.equal(zeroAssembly.status, 200);
    assert.equal(zeroAssembly.json.config.units.find(row => row.id === 'mage').equipmentDamageBonus, 0);
    assert.equal(zeroAssembly.json.config.units.find(row => row.id === 'mage').equipmentSourceId, 'guard-linen-sword-001');
    const instanceDefinition = clone(candidate); instanceDefinition.defaultEquipment[0].itemId = 'guard-linen-sword-001';
    const wrongItem = await test.unchanged(() => test.api('/api/validate-entity', 'POST', { type: 'character', mode: 'update', entity: instanceDefinition })); test.require422(wrongItem);
    const draft = { ...clone(sword), id: 'eq_related_draft', aliases: [], draft: true };
    const create = await test.api(`/api/content/item/${draft.id}`, 'PUT', draft, { 'If-None-Match': '*' }); assert.equal(create.status, 201);
    candidate.defaultEquipment[0].itemId = draft.id; await test.save('character', candidate, [{ op: 'set', path: '/defaultEquipment' }]);
    const run = await test.unchanged(() => test.api('/api/trial/run', 'POST', { trialId: trialCandidate.id })); test.require422(run, draft.id);
    await failedExportUnchanged(() => test.api('/api/export', 'POST', {}), draft.id);
    return { projectedBasicBonus: basic, enhancementNotProjected: sword.equipment.enhancement[0].attackBonusDelta, relatedDraftRun: 422, relatedDraftExport: 422 };
  });
} catch (error) {
  failure = { check: test.activeCheck, category: test.activeCheck === 'Preflight' ? 'HarnessOrEnvironmentPrecondition' : 'AcceptanceFailure_RequiresProductHarnessEnvironmentTriage', message: error.message, stack: error.stack };
}
process.exitCode = await test.finish(failure) ? 0 : 1;
