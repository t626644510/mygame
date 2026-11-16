import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { compareTrees } from '../json-assertions.mjs';
import { P2HttpContext, clone } from './http-context.mjs';
import { compareLogBytes, readJson, writeJson } from './evidence.mjs';

const test = new P2HttpContext(process.argv.slice(2));
let failure;
let source, trialId, skill, secondEncounter, initialMetadata;
const action = scene => scene.actions.find(row => row.id === 'pressure_strike');
const expectedWithMagnitudes = (first, second) => {
  const result = clone(source); action(result.encounters[0].scenario).magnitude = first; action(result.encounters[1].scenario).magnitude = second; return result;
};
async function metadataUnchanged() {
  const metadata = await test.metadata(trialId);
  for (const field of ['sourceKind', 'sourceName', 'sourceSha256', 'sourceJson', 'bindings']) assert.deepEqual(metadata[field], initialMetadata[field], `Save reset imported ${field}.`);
  return metadata;
}
async function lastIntent(id, pointer, expected) {
  const metadata = await metadataUnchanged();
  const entries = metadata.edits.filter(row => row.type === 'skill' && row.id === id && row.path === pointer);
  assert.equal(entries.length, 1, 'Same path must have exactly one last effective operation.'); assert.equal(entries[0].op, expected);
}
async function assertConfig(name, expected) {
  const assembled = await test.assemble(trialId);
  const differences = compareTrees(expected, assembled.config);
  await writeJson(path.join(test.output, 'comparisons', `${name}-config.json`), { differences, expected, actual: assembled.config, resolvedActions: assembled.resolvedActions });
  assert.deepEqual(differences, [], 'Only the explicitly edited source fields may change.');
  const resolved = assembled.resolvedActions.filter(row => row.actionId === 'pressure_strike');
  assert.equal(resolved.length, 2);
  assert.deepEqual(resolved.map(row => row.effective.magnitude), expected.encounters.map(row => action(row.scenario).magnitude));
  await metadataUnchanged(); return assembled;
}
async function nativeComparison(name, expected) {
  await assertConfig(name, expected);
  const oracle = await test.oracle(name, 'linked', expected);
  const reference = await readJson(path.join(oracle, 'ORACLE_RESULT.json'));
  assert.equal(reference.result.sameRuntimeInstance, true); assert.equal(reference.result.replayCalls, 0);
  const run = await test.run(trialId); assert.equal(run.kind, 'expedition');
  const reportDifference = compareTrees(await readJson(path.join(oracle, 'expedition-report.json')), run.result);
  const logs = [];
  for (let index = 0; index < expected.encounters.length; index++) {
    assert.equal(run.logs[index].encounterIndex, index + 1);
    logs.push(compareLogBytes(await readFile(path.join(oracle, reference.result.logs[index].file)), Buffer.from(run.logs[index].logText, 'utf8')));
  }
  await writeJson(path.join(test.output, 'comparisons', `${name}-native.json`), { reportDifference, logs, sourceRoute: 'Direct actual CombatExpeditionSession and same-instance public log observer', serviceRoute: 'Real HTTP trial/run' });
  assert.deepEqual(reportDifference, []); assert.ok(logs.every(row => row.equal));
  return run;
}

try {
  await test.initialize();
  await test.start('variants');
  await test.phase('SourceLocal.Initial18_12AndKnownHashNoOp', async () => {
    const imported = await test.import('round2_expedition.json', true); trialId = imported.trialId;
    source = await readJson(path.join(test.output, 'original-inputs/round2_expedition.json'));
    initialMetadata = await test.metadata(trialId);
    const trial = (await test.get('trial', trialId)).json;
    secondEncounter = (await test.get('encounter', trial.encounters[1].encounterId)).json;
    skill = (await test.get('skill', 'pressure_strike')).json;
    assert.equal(skill.magnitude, 18); assert.equal(secondEncounter.actionOverrides[0].fields.magnitude, 12);
    const repeated = await test.unchanged(() => test.import('round2_expedition.json', true));
    assert.equal(repeated.trialId, trialId); await metadataUnchanged();
    const original = await nativeComparison('initial18_12', source);
    test.initialFirstLog = Buffer.from(original.logs[0].logText, 'utf8');
    return 'comparisons/initial18_12-native.json';
  });
  await test.phase('SourceLocal.Local14OnlySecondStageAndFirstLogStable', async () => {
    secondEncounter.actionOverrides[0].fields.magnitude = 14;
    await test.save('encounter', secondEncounter, [{ op: 'set', path: '/actionOverrides' }]);
    const result = await nativeComparison('local18_14', expectedWithMagnitudes(18, 14));
    assert.ok(test.initialFirstLog.equals(Buffer.from(result.logs[0].logText, 'utf8')), 'Local stage2 edit changed the original stage1 log.');
    return 'comparisons/local18_14-native.json';
  });
  await test.phase('SourceLocal.Shared20KeepsLocal12', async () => {
    secondEncounter.actionOverrides[0].fields.magnitude = 12;
    await test.save('encounter', secondEncounter, [{ op: 'set', path: '/actionOverrides' }]);
    skill.magnitude = 20; await test.save('skill', skill, [{ op: 'set', path: '/magnitude' }]);
    await nativeComparison('shared20_12', expectedWithMagnitudes(20, 12));
    return 'comparisons/shared20_12-native.json';
  });
  await test.phase('SourceLocal.DeleteFixedFieldInherits20AndReloadPersists', async () => {
    delete secondEncounter.actionOverrides[0].fields.magnitude;
    await test.save('encounter', secondEncounter, [{ op: 'set', path: '/actionOverrides' }]);
    secondEncounter = (await test.get('encounter', secondEncounter.id)).json;
    assert.equal(Object.hasOwn(secondEncounter.actionOverrides[0].fields, 'magnitude'), false);
    await nativeComparison('inherited20_20', expectedWithMagnitudes(20, 20));
    return 'comparisons/inherited20_20-native.json';
  });
  await test.phase('SourceLocal.AddOverrideAgainLastValueAndBaselineImmutable', async () => {
    secondEncounter.actionOverrides[0].fields.magnitude = 14;
    await test.save('encounter', secondEncounter, [{ op: 'set', path: '/actionOverrides' }]);
    await assertConfig('last20_14', expectedWithMagnitudes(20, 14));
    return 'comparisons/last20_14-config.json';
  });
  await test.phase('Presence.ExplicitZeroFalseAndLastSetRemoveSetIntent', async () => {
    skill.isMagic = false; skill.statusMagnitude = 0;
    await test.save('skill', skill, [{ op: 'set', path: '/isMagic' }, { op: 'set', path: '/statusMagnitude' }]);
    let expected = expectedWithMagnitudes(20, 14);
    for (const row of expected.encounters) Object.assign(action(row.scenario), { isMagic: false, statusMagnitude: 0 });
    await assertConfig('presence-set-zero-false', expected);
    await lastIntent(skill.id, '/isMagic', 'set'); await lastIntent(skill.id, '/statusMagnitude', 'set');
    delete skill.isMagic; delete skill.statusMagnitude;
    await test.save('skill', skill, [{ op: 'remove', path: '/isMagic' }, { op: 'remove', path: '/statusMagnitude' }]);
    await assertConfig('presence-remove-zero-false', expectedWithMagnitudes(20, 14));
    await lastIntent(skill.id, '/isMagic', 'remove'); await lastIntent(skill.id, '/statusMagnitude', 'remove');
    skill.isMagic = false; skill.statusMagnitude = 0;
    await test.save('skill', skill, [{ op: 'set', path: '/isMagic' }, { op: 'set', path: '/statusMagnitude' }]);
    await assertConfig('presence-last-set-zero-false', expected);
    await lastIntent(skill.id, '/isMagic', 'set'); await lastIntent(skill.id, '/statusMagnitude', 'set');
    return 'comparisons/presence-last-set-zero-false-config.json';
  });
  await test.phase('SourceLocal.RuntimeOmitIsDifferentFromInheritance', async () => {
    skill.statusDuration = 5;
    await test.save('skill', skill, [{ op: 'set', path: '/statusDuration' }]);
    secondEncounter.actionOverrides[0].fields.isMagic = false;
    secondEncounter.actionOverrides[0].fields.statusMagnitude = 0;
    secondEncounter.actionOverrides[0].remove = ['statusDuration'];
    await test.save('encounter', secondEncounter, [{ op: 'set', path: '/actionOverrides' }]);
    const expected = expectedWithMagnitudes(20, 14);
    for (const row of expected.encounters) Object.assign(action(row.scenario), { isMagic: false, statusMagnitude: 0 });
    action(expected.encounters[0].scenario).statusDuration = 5;
    await assertConfig('typed-omit', expected);
    secondEncounter.actionOverrides[0].remove = [];
    await test.save('encounter', secondEncounter, [{ op: 'set', path: '/actionOverrides' }]);
    action(expected.encounters[1].scenario).statusDuration = 5;
    await assertConfig('typed-inherit', expected);
    return 'comparisons/typed-inherit-config.json';
  });
  await test.phase('SourceLocal.FieldsAndRemoveMutualExclusion422NoWrite', async () => {
    const bad = clone(secondEncounter); bad.actionOverrides[0].fields.statusDuration = 5; bad.actionOverrides[0].remove = ['statusDuration'];
    const current = await test.get('encounter', bad.id);
    const rejected = await test.unchanged(() => test.api(`/api/content/encounter/${bad.id}`, 'PUT', bad, { 'If-Match': current.response.headers.etag }));
    test.require422(rejected, 'actionOverrides'); return { status: rejected.status, directoryUnchanged: true };
  });
  await test.phase('SourceLocal.ModifiedKnownHashRejectsWithoutResettingBindings', async () => {
    const original = await readFile(path.join(test.output, 'original-inputs/round2_expedition.json'), 'utf8');
    const result = await test.unchanged(() => test.api('/api/import-expedition', 'POST', { sourceName: 'round2_expedition.json', jsonText: original }));
    test.require422(result, 'pressure_strike'); await metadataUnchanged(); return { status: result.status, directoryUnchanged: true };
  });
} catch (error) {
  failure = { check: test.activeCheck, category: test.activeCheck === 'Preflight' ? 'HarnessOrEnvironmentPrecondition' : 'AcceptanceFailure_RequiresProductHarnessEnvironmentTriage', message: error.message, stack: error.stack };
}
process.exitCode = await test.finish(failure) ? 0 : 1;
