import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { P2HttpContext, clone } from './http-context.mjs';
import { compareTrees } from '../json-assertions.mjs';
import { compareLogBytes, readJson, writeJson } from './evidence.mjs';

const test = new P2HttpContext(process.argv.slice(2));
let failure;
async function rejection(type, entity, needle) {
  const current = await test.get(type, entity.id);
  const pure = await test.unchanged(() => test.api('/api/validate-entity', 'POST', { type, mode: 'update', entity }));
  test.require422(pure, needle);
  const put = await test.unchanged(() => test.api(`/api/content/${type}/${entity.id}`, 'PUT', entity, { 'If-Match': current.response.headers.etag }));
  test.require422(put, needle);
  return { validation: pure.status, put: put.status, directoryUnchanged: true };
}
async function previewAgainstKernel(name, character, expected, trialId, encounterIndex = 1) {
  const preview = await test.unchanged(() => test.api('/api/character/validate', 'POST', { character, context: { trialId, encounterIndex } }));
  assert.equal(preview.status, 200);
  const assembled = await test.assemble(trialId, { overrides: { characters: [character] } });
  assert.deepEqual(preview.json.ruleContext, assembled.ruleContexts[encounterIndex - 1], 'Preview and actual trial did not use the same rule context.');
  const oracle = await test.oracle(name, 'snapshot', expected);
  const snapshot = await readJson(path.join(oracle, 'initial-snapshot.json'));
  const unit = snapshot.units.find(row => row.id === preview.json.unitId); assert.ok(unit);
  assert.equal(preview.json.instructionCapacity, unit.instructionCapacity);
  assert.equal(preview.json.conditionTermCapacity, unit.conditionTermCapacity);
  const projection = unit.instructions.map(({ id, capacityAllowed, actionAvailable, validationReason, display }) => ({ id, capacityAllowed, actionAvailable, validationReason, display }));
  assert.deepEqual(preview.json.instructions, projection, 'Preview validationReason/display differs from direct actual GetSnapshot.');
  const pool = (await readJson(path.join(oracle, 'available-actions.json'))).find(row => row.unitId === unit.id).actions.map(row => row.id);
  assert.deepEqual(preview.json.availableActions, pool, 'Preview action whitelist differs from actual GetAvailableActions.');
  await writeJson(path.join(test.output, 'comparisons', `${name}.json`), { preview: preview.json, directUnit: unit, directAvailableActionIds: pool });
  return preview.json;
}

try {
  await test.initialize(); await test.start('default');
  let source, trialId;
  if (test.args['--skip-passed-intent'] !== 'true') await test.phase('B007.PureAndPutRejectIdIntentWithoutWrites', async () => {
    const entity = { schemaVersion: 1, id: 'verify_intent_skill', effectKind: 'damage', magnitude: 1, mpCost: 0, baseWait: 1, draft: false };
    for (const route of ['validate', 'put']) {
      const body = { entity, requests: [], editIntent: [{ op: 'set', path: '/id' }] };
      const result = await test.unchanged(() => route === 'validate' ? test.api('/api/validate-entity', 'POST', { type: 'skill', mode: 'create', ...body }) : test.api(`/api/content/skill/${entity.id}`, 'PUT', body, { 'If-None-Match': '*' }));
      test.require422(result, 'edit_intent');
    }
    const pure = await test.unchanged(() => test.api('/api/validate-entity', 'POST', { type: 'skill', mode: 'create', entity })); assert.equal(pure.status, 200);
    const created = await test.api(`/api/content/skill/${entity.id}`, 'PUT', entity, { 'If-None-Match': '*' }); assert.equal(created.status, 201);
    const disk = await test.get('skill', entity.id);
    const deleted = await test.api(`/api/content/skill/${entity.id}`, 'DELETE', undefined, { 'If-Match': disk.response.headers.etag }); assert.equal(deleted.status, 200);
    return { negativePure: 422, negativePut: 422, positivePure: 200, positiveCreate: 201, delete: 200 };
  });
  await test.phase('B007.NormalizedMetadataMatchesActualCoreWhileRawS0StaysRaw', async () => {
    trialId = (await test.import('default.json')).trialId;
    source = await readJson(path.join(test.output, 'original-inputs/default.json'));
    const assembled = await test.assemble(trialId);
    assert.deepEqual(compareTrees(source, assembled.config), [], 'S0 raw presence/order changed during metadata normalization.');
    const oracle = await test.oracle('default-normalized', 'snapshot', source);
    const byId = new Map((await readJson(path.join(oracle, 'normalized-actions.json'))).map(action => [action.id, action]));
    const differences = [];
    for (const row of assembled.resolvedActions) {
      assert.ok(byId.has(row.actionId), `Direct core did not expose ${row.actionId}`);
      differences.push(...compareTrees(byId.get(row.actionId), row.shared), ...compareTrees(byId.get(row.actionId), row.effective));
    }
    await writeJson(path.join(test.output, 'comparisons/default-normalized.json'), { rawConfigDifference: compareTrees(source, assembled.config), resolvedActionDifferences: differences, actualCoreActions: [...byId.values()], resolvedActions: assembled.resolvedActions });
    assert.deepEqual(differences, []);
    return 'comparisons/default-normalized.json';
  });
  await test.phase('Budgets.UnrelatedGlobalRuleCannotBroadcastIntoImportedSource', async () => {
    const global = (await test.get('rule', 'rules_combat')).json;
    global.maxEvents = 23; global.capacity.baseSlots += 1;
    await test.save('rule', global, [{ op: 'set', path: '/maxEvents' }, { op: 'set', path: '/capacity/baseSlots' }]);
    assert.deepEqual(compareTrees(source, (await test.assemble(trialId)).config), []);
    return { sourceUnchanged: true };
  });
  await test.phase('Budgets.SourceSceneZeroUsesCoreFallbackWithoutChangingCallBudget', async () => {
    const trial = (await test.get('trial', trialId)).json;
    const bound = (await test.get('rule', trial.encounters[0].rulesId)).json;
    bound.maxEvents = 0; bound.maxWait = 0;
    await test.save('rule', bound, [{ op: 'set', path: '/maxEvents' }, { op: 'set', path: '/maxWait' }]);
    const expected = clone(source); expected.maxEvents = 0; expected.maxWait = 0;
    const assembled = await test.assemble(trialId); assert.deepEqual(compareTrees(expected, assembled.config), []);
    const oracle = await test.oracle('default-scene-zero', 'single', expected);
    const result = await test.run(trialId);
    const log = compareLogBytes(await readFile(path.join(oracle, 'combat.log')), Buffer.from(result.logText, 'utf8'));
    assert.equal(log.equal, true); assert.deepEqual(compareTrees(await readJson(path.join(oracle, 'run-result.json')), result.result), []);
    await writeJson(path.join(test.output, 'comparisons/default-scene-zero.json'), { log, resultEqual: true, sourceSceneBudget: { maxEvents: 0, maxWait: 0 }, independentCallDefaults: { maxSteps: 10000, maxWait: 100000 } });
    return 'comparisons/default-scene-zero.json';
  });
  await test.phase('Budgets.ExplicitCallZeroRejectsInsteadOfBecomingMissing', async () => {
    const trial = (await test.get('trial', trialId)).json;
    for (const runBudget of [{ maxSteps: 0, maxWait: 100000 }, { maxSteps: 10000, maxWait: 0 }]) {
      const bad = clone(trial); bad.runBudget = runBudget; await rejection('trial', bad, 'runBudget');
      const run = await test.unchanged(() => test.api('/api/trial/run', 'POST', { trial: bad })); test.require422(run, 'runBudget');
    }
    return { callMaxStepsZero: 422, callMaxWaitZero: 422, directoryUnchanged: true };
  });
  await test.stop(); await test.start('linked-context');
  let linkedTrial, linkedSource, mage;
  await test.phase('Rules.SharedCharacterRequiresExplicitContextAndUsesMatchingSource', async () => {
    linkedTrial = (await test.import('round2_expedition.json', true)).trialId;
    linkedSource = await readJson(path.join(test.output, 'original-inputs/round2_expedition.json'));
    const trial = (await test.get('trial', linkedTrial)).json;
    mage = (await test.get('character', trial.allies.find(row => row.unitId === 'mage').characterId)).json;
    const ambiguous = await test.unchanged(() => test.api('/api/character/validate', 'POST', { character: mage })); test.require422(ambiguous, 'context_required');
    await previewAgainstKernel('linked-context-one', mage, linkedSource.encounters[0].scenario, linkedTrial, 1);
    const rule = (await test.get('rule', trial.encounters[1].rulesId)).json; rule.capacity.baseSlots += 1;
    await test.save('rule', rule, [{ op: 'set', path: '/capacity/baseSlots' }]);
    const expectedSecond = clone(linkedSource.encounters[1].scenario); expectedSecond.capacity.baseSlots += 1;
    await previewAgainstKernel('linked-context-two', mage, expectedSecond, linkedTrial, 2);
    const assembled = await test.assemble(linkedTrial);
    assert.deepEqual(compareTrees(linkedSource.encounters[0].scenario, assembled.config.encounters[0].scenario), []);
    assert.deepEqual(compareTrees(expectedSecond, assembled.config.encounters[1].scenario), []);
    return { ambiguous: 422, explicitContexts: [1, 2], firstSceneUnchanged: true };
  });
  await test.phase('Rules.LinkedSourceHeaderCannotBeBroadcastFromTopLevel', async () => {
    const trial = (await test.get('trial', linkedTrial)).json; trial.seed++;
    const result = await test.unchanged(() => test.api('/api/assemble', 'POST', { trial })); test.require422(result, 'source_scope');
    return { sourceScope: 422, directoryUnchanged: true };
  });
  await test.phase('Bindings.SlotAndEncounterReorderFollowsStableIds', async () => {
    const trial = (await test.get('trial', linkedTrial)).json;
    trial.allies.reverse(); trial.allies.find(row => row.unitId === 'ally').hp = 7;
    trial.encounters.reverse(); trial.encounters[0].waitBefore = 0; trial.encounters[1].waitBefore = 15;
    await test.save('trial', trial, [{ op: 'set', path: '/allies' }, { op: 'set', path: '/encounters' }]);
    const assembled = await test.assemble(linkedTrial);
    assert.deepEqual(assembled.config.encounters.map(row => row.id), linkedSource.encounters.map(row => row.id).reverse());
    assert.deepEqual(assembled.config.encounters.map(row => row.scenario.id), linkedSource.encounters.map(row => row.scenario.id).reverse());
    assert.deepEqual(assembled.config.encounters.map(row => row.scenario.actions.find(action => action.id === 'pressure_strike').magnitude), [12, 18]);
    for (const stage of assembled.config.encounters) {
      const original = linkedSource.encounters.find(row => row.id === stage.id).scenario;
      assert.equal(stage.scenario.title, original.title);
      assert.deepEqual(stage.scenario.units.filter(row => row.team === 'friendly').map(row => row.id), ['ally', 'mage']);
      for (const unit of stage.scenario.units.filter(row => row.team === 'friendly')) {
        const old = original.units.find(row => row.id === unit.id); assert.equal(unit.hp, unit.id === 'ally' ? 7 : old.hp); assert.equal(unit.mp, old.mp); assert.equal(unit.name, old.name);
      }
    }
    return { encounterOrder: ['pressure_depth', 'pressure_entrance'], allyOrder: ['ally', 'mage'], localMagnitudesFollowSource: [12, 18] };
  });
  await test.stop(); await test.start('mage-preview');
  let mageTrial, mageSource, mageEntity, encounter;
  await test.phase('C5.Capacity10And40WithExactCoreReasonsAndWhitelist', async () => {
    mageTrial = (await test.import('round4_mage_library.json')).trialId;
    mageSource = await readJson(path.join(test.output, 'original-inputs/round4_mage_library.json'));
    const trial = (await test.get('trial', mageTrial)).json;
    mageEntity = (await test.get('character', trial.allies.find(row => row.unitId === 'mage').characterId)).json;
    encounter = (await test.get('encounter', trial.encounters[0].encounterId)).json;
    for (const intelligence of [40, 10]) {
      const candidate = clone(mageEntity); candidate.attributes.find(row => row.id === 'intelligence').value = intelligence;
      const expected = clone(mageSource); expected.units.find(row => row.id === 'mage').intelligence = intelligence;
      const result = await previewAgainstKernel(`mage-int-${intelligence}`, candidate, expected, mageTrial);
      if (intelligence === 10) { assert.equal(result.instructionCapacity, 2); assert.ok(result.instructions.slice(2).every(row => row.capacityAllowed === false)); }
    }
    return ['comparisons/mage-int-40.json', 'comparisons/mage-int-10.json'];
  });
  await test.phase('C6.MixedGroupingAndSubjectsPersistAndMatchCore', async () => {
    const candidate = clone(mageEntity);
    for (let index = 0; index < 2; index++) candidate.instructions[index].condition = { operation: 'mixed', operators: ['and', 'or'], grouping: index ? 'right' : 'left', terms: [
      { kind: 'always', threshold: 0, subject: 'actor' }, { kind: 'hp_ratio_at_most', threshold: 0.35, subject: 'target' }, { kind: 'mp_ratio_at_least', threshold: 0.1, subject: 'actor' }] };
    await test.save('character', candidate, [{ op: 'set', path: '/instructions' }]);
    const expected = clone(mageSource); expected.units.find(row => row.id === 'mage').instructions = clone(candidate.instructions);
    const result = await previewAgainstKernel('mage-mixed-grouping', candidate, expected, mageTrial);
    assert.ok(result.instructions.slice(0, 2).every(row => row.capacityAllowed && row.actionAvailable));
    mageEntity = candidate; return 'comparisons/mage-mixed-grouping.json';
  });
  await test.phase('C7.RatioAndIntegerThresholdsAndRejectFractionWithoutWrite', async () => {
    const candidate = clone(mageEntity); candidate.instructions[0].condition = { operation: 'all', terms: [{ kind: 'hp_ratio_at_most', threshold: 0.35, subject: 'target' }] };
    candidate.instructions[1].condition = { operation: 'all', terms: [{ kind: 'row_is', threshold: 2, subject: 'target' }] };
    await test.save('character', candidate, [{ op: 'set', path: '/instructions' }]);
    const disk = (await test.get('character', candidate.id)).json; assert.equal(disk.instructions[0].condition.terms[0].threshold, 0.35); assert.equal(disk.instructions[1].condition.terms[0].threshold, 2);
    const bad = clone(candidate); bad.instructions[1].condition.terms[0].threshold = 2.5;
    await rejection('character', bad, 'threshold'); mageEntity = candidate;
    return { ratioStored: 0.35, rearRowStored: 2, fractionalRowRejected: true };
  });
  await test.phase('Whitelist.InstructionDoesNotTeachUnlearnedSkill', async () => {
    const candidate = clone(mageEntity); candidate.instructions[0].actionId = 'round4_enemy_attack'; candidate.instructions[0].scope = 'enemies';
    const expected = clone(mageSource); expected.units.find(row => row.id === 'mage').instructions = clone(candidate.instructions);
    const result = await previewAgainstKernel('mage-unlearned-action', candidate, expected, mageTrial);
    assert.equal(result.instructions[0].actionAvailable, false); assert.equal(result.availableActions.includes('round4_enemy_attack'), false);
    assert.deepEqual(candidate.availableActionIds, mageEntity.availableActionIds);
    return 'comparisons/mage-unlearned-action.json';
  });
  await test.phase('C10.GridCollisionAndSeventhEnemyRejectWithoutOverwritingSlots', async () => {
    const collision = clone(encounter); collision.enemies[1].row = collision.enemies[0].row; collision.enemies[1].column = collision.enemies[0].column;
    await rejection('encounter', collision);
    const seven = clone(encounter); seven.enemies = Array.from({ length: 7 }, (_, index) => ({ ...clone(encounter.enemies[0]), unitId: `verify_enemy_${index}`, row: Math.floor(index / 3), column: index % 3 }));
    await rejection('encounter', seven);
    assert.deepEqual((await test.get('encounter', encounter.id)).json.enemies, encounter.enemies);
    return { collision: 422, seventhEnemy: 422, slotsUnchanged: true };
  });
} catch (error) {
  failure = { check: test.activeCheck, category: test.activeCheck === 'Preflight' ? 'HarnessOrEnvironmentPrecondition' : 'AcceptanceFailure_RequiresProductHarnessEnvironmentTriage', message: error.message, stack: error.stack };
}
process.exitCode = await test.finish(failure) ? 0 : 1;
