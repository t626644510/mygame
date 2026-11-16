import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { P2HttpContext, clone } from './http-context.mjs';
import { compareTrees } from '../json-assertions.mjs';
import { repository, compareLogBytes, readJson, writeJson } from './evidence.mjs';

const test = new P2HttpContext(process.argv.slice(2));
let failure;
const ruleFields = ['maxUnitsPerTeam', 'gridRows', 'gridColumns', 'alliesIncludeSelf', 'maxEvents', 'maxWait', 'capacity'];
async function preview(name, character, trialId, index, expectedScene, expectedMagnitude) {
  const result = await test.unchanged(() => test.api('/api/character/validate', 'POST', { character, context: { trialId, encounterIndex: index } })); assert.equal(result.status, 200);
  const assembly = await test.assemble(trialId); assert.deepEqual(result.json.ruleContext, assembly.ruleContexts[index - 1]);
  assert.equal(result.json.ruleContext.sourceScenarioId, expectedScene.id);
  const direct = await test.oracle(name, 'snapshot', expectedScene);
  const unit = (await readJson(path.join(direct, 'initial-snapshot.json'))).units.find(row => row.id === result.json.unitId);
  assert.equal(result.json.instructionCapacity, unit.instructionCapacity); assert.equal(result.json.conditionTermCapacity, unit.conditionTermCapacity);
  assert.deepEqual(result.json.instructions, unit.instructions.map(({ id, capacityAllowed, actionAvailable, validationReason, display }) => ({ id, capacityAllowed, actionAvailable, validationReason, display })));
  const resolved = result.json.resolvedActions.find(row => row.actionId === 'pressure_strike'); assert.ok(resolved); assert.equal(resolved.effective.magnitude, expectedMagnitude);
  await writeJson(path.join(test.output, 'comparisons', `${name}.json`), { preview: result.json, directSnapshotUnit: unit, currentAssemblyContext: assembly.ruleContexts[index - 1] });
}

try {
  await test.initialize(); await test.start('linked-deltas');
  const trialId = (await test.import('round2_expedition.json', true)).trialId;
  const source = await readJson(path.join(test.output, 'original-inputs/round2_expedition.json'));
  const baseline = await test.metadata(trialId);
  let trial = (await test.get('trial', trialId)).json;
  const mage = (await test.get('character', trial.allies.find(row => row.unitId === 'mage').characterId)).json;
  const expected = clone(source);
  await test.phase('R04.ExplicitRunBudgetRemoveUsesCoreDefaultsAndPreservesScenes', async () => {
    delete trial.runBudget;
    await test.save('trial', trial, [{ op: 'remove', path: '/runBudget' }]);
    delete expected.maxStepsPerBattle; delete expected.maxWaitPerBattle;
    const assembly = await test.assemble(trialId);
    assert.equal(Object.hasOwn(assembly.config, 'maxStepsPerBattle'), false); assert.equal(Object.hasOwn(assembly.config, 'maxWaitPerBattle'), false);
    assert.deepEqual(compareTrees(expected, assembly.config), []);
    const direct = await test.oracle('removed-root-budget', 'linked', expected);
    const normalized = await readJson(path.join(direct, 'normalized-expedition.json'));
    assert.equal(normalized.maxStepsPerBattle, 10000); assert.equal(normalized.maxWaitPerBattle, 100000);
    assert.deepEqual(normalized.encounters.map(row => [row.scenario.maxEvents, row.scenario.maxWait]), source.encounters.map(row => [row.scenario.maxEvents, row.scenario.maxWait]));
    const run = await test.run(trialId);
    assert.deepEqual(compareTrees(await readJson(path.join(direct, 'expedition-report.json')), run.result), []);
    const directReceipt = await readJson(path.join(direct, 'ORACLE_RESULT.json'));
    const logs = await Promise.all(run.logs.map(async (row, index) => compareLogBytes(await readFile(path.join(direct, directReceipt.result.logs[index].file)), Buffer.from(row.logText, 'utf8'))));
    assert.ok(logs.every(row => row.equal));
    const metadata = await test.metadata(trialId); assert.deepEqual(metadata.bindings, baseline.bindings); assert.equal(metadata.sourceJson, baseline.sourceJson);
    assert.equal(metadata.edits.find(row => row.type === 'trial' && row.id === trialId && row.path === '/runBudget').op, 'remove');
    await writeJson(path.join(test.output, 'comparisons/removed-root-budget.json'), { rawRootBudgetAbsent: true, normalizedCoreDefaults: [normalized.maxStepsPerBattle, normalized.maxWaitPerBattle], sceneBudgets: normalized.encounters.map(row => [row.scenario.maxEvents, row.scenario.maxWait]), logs });
    return 'comparisons/removed-root-budget.json';
  });
  await test.phase('R05.RebindingAdoptsWholeTargetRuleAndMatchingPreview', async () => {
    const target = (await test.get('rule', 'rules_combat')).json;
    target.maxEvents = 2468; target.maxWait = 54321; target.capacity.baseSlots = 4;
    await test.save('rule', target, [{ op: 'set', path: '/maxEvents' }, { op: 'set', path: '/maxWait' }, { op: 'set', path: '/capacity/baseSlots' }]);
    trial.encounters[1].rulesId = target.id;
    await test.save('trial', trial, [{ op: 'set', path: '/encounters' }]);
    for (const field of ruleFields) {
      if (Object.hasOwn(target, field)) expected.encounters[1].scenario[field] = clone(target[field]);
      else delete expected.encounters[1].scenario[field];
    }
    const assembly = await test.assemble(trialId); assert.deepEqual(compareTrees(expected, assembly.config), []);
    assert.equal(assembly.ruleContexts[1].rulesId, 'rules_combat');
    await preview('rebound-second-stage', mage, trialId, 2, expected.encounters[1].scenario, 12);
    return 'comparisons/rebound-second-stage.json';
  });
  await test.phase('R09.CurrentEncounterOrderAndDeleteResolveCurrentSourceContext', async () => {
    trial.encounters.reverse(); trial.encounters[0].waitBefore = 0; trial.encounters[1].waitBefore = 15;
    await test.save('trial', trial, [{ op: 'set', path: '/encounters' }]);
    let assembly = await test.assemble(trialId);
    assert.deepEqual(assembly.config.encounters.map(row => row.scenario.id), expected.encounters.map(row => row.scenario.id).reverse());
    await preview('reordered-current-first', mage, trialId, 1, expected.encounters[1].scenario, 12);
    trial.encounters.splice(1, 1); await test.save('trial', trial, [{ op: 'set', path: '/encounters' }]);
    assembly = await test.assemble(trialId); assert.equal(assembly.kind, 'expedition'); assert.equal(assembly.provenance.sourceKind, 'expedition'); assert.equal(assembly.config.encounters.length, 1);
    assert.equal(assembly.config.encounters[0].scenario.id, expected.encounters[1].scenario.id);
    await preview('deleted-current-first', mage, trialId, 1, expected.encounters[1].scenario, 12);
    assert.deepEqual((await test.metadata(trialId)).bindings, baseline.bindings);
    return ['comparisons/reordered-current-first.json', 'comparisons/deleted-current-first.json'];
  });
  await test.stop(); await test.start('single-expansion');
  await test.phase('R08.ImportedSingleExpansionKeepsOriginalFirstSceneAndNativeLog', async () => {
    const imported = (await test.import('default.json')).trialId;
    const original = await readJson(path.join(test.output, 'original-inputs/default.json'));
    const current = (await test.get('trial', imported)).json;
    const extra = clone((await test.get('encounter', current.encounters[0].encounterId)).json); extra.id = 'enc_added_probe'; extra.name = '隔离新增第二场';
    const created = await test.api(`/api/content/encounter/${extra.id}`, 'PUT', extra, { 'If-None-Match': '*' }); assert.equal(created.status, 201);
    current.encounters.push({ encounterId: extra.id, waitBefore: 0, rulesId: 'rules_combat' });
    await test.save('trial', current, [{ op: 'set', path: '/encounters' }]);
    const assembly = await test.assemble(imported);
    assert.equal(assembly.kind, 'expedition'); assert.equal(assembly.provenance.sourceKind, 'scenario'); assert.equal(assembly.config.id, imported);
    assert.equal(assembly.config.encounters.length, 2); assert.deepEqual(compareTrees(original, assembly.config.encounters[0].scenario), []);
    for (const key of ['units', 'actions', 'seed', 'playerTeam', 'maxEvents', 'maxWait', 'gridRows', 'gridColumns', 'capacity', 'randomUsed']) assert.equal(Object.hasOwn(assembly.config, key), false, `Scenario field leaked to expedition root: ${key}`);
    const run = await test.run(imported); assert.equal(run.kind, 'expedition'); assert.ok(run.logs.length >= 1);
    const directPath = path.join(repository, 'outputs/helper_editor_p2/verification/cli_assembly_005/C1/default/direct/combat.log');
    const log = compareLogBytes(await readFile(directPath), Buffer.from(run.logs[0].logText, 'utf8')); assert.equal(log.equal, true);
    await writeJson(path.join(test.output, 'comparisons/single-expansion.json'), { originalScenarioId: original.id, firstSceneDifference: compareTrees(original, assembly.config.encounters[0].scenario), originalDirectLog: directPath, firstStageLog: log, sourceKind: assembly.provenance.sourceKind, currentKind: assembly.kind, configuredEncounters: assembly.config.encounters.length, executedLogs: run.logs.length });
    return 'comparisons/single-expansion.json';
  });
} catch (error) {
  failure = { check: test.activeCheck, category: test.activeCheck === 'Preflight' ? 'HarnessOrEnvironmentPrecondition' : 'AcceptanceFailure_RequiresProductHarnessEnvironmentTriage', message: error.message, stack: error.stack };
}
process.exitCode = await test.finish(failure) ? 0 : 1;
