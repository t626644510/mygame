import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { P2HttpContext, clone } from './http-context.mjs';
import { compareTrees } from '../json-assertions.mjs';
import { readJson, snapshotFiles, writeJson } from './evidence.mjs';

const test = new P2HttpContext(process.argv.slice(2));
let failure, source, character;
try {
  await test.initialize(); await test.start('equipment-inline');
  const trialId = (await test.import('default.json')).trialId;
  source = await readJson(path.join(test.output, 'original-inputs/default.json'));
  const importedTrial = (await test.get('trial', trialId)).json;
  character = (await test.get('character', importedTrial.allies.find(row => row.unitId === 'mage').characterId)).json;
  if (test.args['--inline-only'] !== 'true') await test.phase('Equipment.NonzeroBasic7SentinelAndExplicitZeroLabelVsDefinition', async () => {
    const formal = (await test.get('item', 'eq_patrol_sword')).json;
    const sword = { ...clone(formal), id: 'eq_probe_basic', aliases: [], name: '隔离基础加成7', equipment: { ...clone(formal.equipment), combatBonus: [{ id: 'equipmentDamageBonus', value: 7 }] } };
    const created = await test.api(`/api/content/item/${sword.id}`, 'PUT', sword, { 'If-None-Match': '*' }); assert.equal(created.status, 201);
    const equipped = clone(character); equipped.defaultEquipment = [{ slot: sword.equipment.slot, itemId: sword.id }];
    await test.save('character', equipped, [{ op: 'set', path: '/defaultEquipment' }]);
    const trial = { schemaVersion: 1, id: 'trial_equipment_probe', title: '隔离基础装备投影', playerTeam: 'friendly', carryTeam: 'friendly', draft: false, rulesId: 'rules_combat',
      allies: [{ unitId: 'mage', characterId: character.id, team: 'friendly', row: 2, column: 1, hp: -1, mp: -1, equipmentDamageBonus: -1, equipmentSourceId: '' }],
      encounters: [{ encounterId: importedTrial.encounters[0].encounterId, rulesId: 'rules_combat', waitBefore: 0 }] };
    const newTrial = await test.api(`/api/content/trial/${trial.id}`, 'PUT', trial, { 'If-None-Match': '*' }); assert.equal(newTrial.status, 201);
    const inferred = await test.assemble(trial.id), inferredUnit = inferred.config.units.find(row => row.id === 'mage');
    assert.equal(inferredUnit.equipmentDamageBonus, 7); assert.equal(inferredUnit.equipmentSourceId, sword.id);
    assert.equal(sword.equipment.enhancement[0].attackBonusDelta, 4); assert.notEqual(inferredUnit.equipmentDamageBonus, 11);
    const explicit = clone(trial); explicit.allies[0].equipmentDamageBonus = 0; explicit.allies[0].equipmentSourceId = 'guard-linen-sword-001';
    const explicitResult = await test.api('/api/assemble', 'POST', { trial: explicit }); assert.equal(explicitResult.status, 200);
    const explicitUnit = explicitResult.json.config.units.find(row => row.id === 'mage');
    assert.equal(explicitUnit.equipmentDamageBonus, 0); assert.equal(explicitUnit.equipmentSourceId, 'guard-linen-sword-001');
    const wrong = clone(equipped); wrong.defaultEquipment[0].itemId = 'guard-linen-sword-001';
    const wrongType = await test.unchanged(() => test.api('/api/validate-entity', 'POST', { type: 'character', mode: 'update', entity: wrong })); test.require422(wrongType);
    const draft = { ...clone(sword), id: 'eq_related_draft', draft: true };
    const draftCreated = await test.api(`/api/content/item/${draft.id}`, 'PUT', draft, { 'If-None-Match': '*' }); assert.equal(draftCreated.status, 201);
    equipped.defaultEquipment[0].itemId = draft.id; await test.save('character', equipped, [{ op: 'set', path: '/defaultEquipment' }]);
    const run = await test.unchanged(() => test.api('/api/trial/run', 'POST', { trialId: trial.id })); test.require422(run, draft.id);
    await writeFile(path.join(test.runtime, 'keep.bin'), Buffer.from([0, 13, 10, 255]));
    const before = await snapshotFiles(test.runtime);
    const exported = await test.api('/api/export', 'POST', {}); test.require422(exported, draft.id);
    assert.deepEqual(await snapshotFiles(test.runtime), before);
    await test.save('character', character, [{ op: 'set', path: '/defaultEquipment' }]);
    return { inferred: 7, explicit: 0, enhancementNotAdded: 4, sourceInstanceLabelPreserved: true, instanceNotDefinition: 422, activeDraftRunAndExport: 422, failedExportFullTargetUnchanged: true };
  });
  await test.phase('Preview.NewInlineCharacterResolvedDefaultsMatchActualNormalize', async () => {
    const fresh = clone(character); fresh.id = 'chr_inline_probe';
    const rules = (await test.get('rule', 'rules_combat')).json;
    const preview = await test.unchanged(() => test.api('/api/character/validate', 'POST', { character: fresh, context: { rules } })); assert.equal(preview.status, 200);
    const oracle = await test.oracle('inline-action-defaults', 'snapshot', source);
    const normalized = new Map((await readJson(path.join(oracle, 'normalized-actions.json'))).map(row => [row.id, row]));
    const differences = [];
    for (const row of preview.json.resolvedActions) {
      assert.ok(normalized.has(row.actionId));
      differences.push(...compareTrees(normalized.get(row.actionId), row.shared), ...compareTrees(normalized.get(row.actionId), row.effective));
    }
    await writeJson(path.join(test.output, 'comparisons/inline-resolved-defaults.json'), { differences, actualCore: [...normalized.values()], actualPreview: preview.json });
    assert.deepEqual(differences, []);
    return 'comparisons/inline-resolved-defaults.json';
  });
} catch (error) {
  failure = { check: test.activeCheck, category: test.activeCheck === 'Preflight' ? 'HarnessOrEnvironmentPrecondition' : 'AcceptanceFailure_RequiresProductHarnessEnvironmentTriage', message: error.message, stack: error.stack };
}
process.exitCode = await test.finish(failure) ? 0 : 1;
