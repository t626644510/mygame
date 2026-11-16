import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { compareTrees } from '../json-assertions.mjs';
import { repository, options, isolatedPath, freshDirectory, runRecorded, verifySavedBytes, sourceSnapshot, captureInputs, snapshotFiles, writeJson, readJson, sha256, compareLogBytes } from './evidence.mjs';
import { singleInputs, linkedInputs, linkedLogStatus } from './inputs.mjs';

const args = options(process.argv.slice(2), ['--dotnet', '--cli', '--expected-cli-sha', '--oracle-build', '--contract-sha', '--output', '--work']);
const output = isolatedPath(args['--output'], 'outputs/helper_editor_p2/verification');
const work = isolatedPath(args['--work'], 'work/p2_verification_20261116');
const cli = path.resolve(repository, args['--cli']);
const dotnet = path.resolve(args['--dotnet']);
const rules = path.resolve(repository, args['--rules'] ?? 'content/rules/rules_combat.json');
const selection = new Set((args['--only'] ?? 'C1,C3').split(','));
assert.ok([...selection].every(id => ['C1', 'C2', 'C3'].includes(id)), 'This runner only implements C1/C2/C3. Other phases are not silently passed.');
const cases = args['--cases'] ? args['--cases'].split(',') : singleInputs;
assert.ok(cases.every(file => singleInputs.includes(file)), 'Unknown original single input.');
const linkedCases = args['--linked-cases'] ? args['--linked-cases'].split(',') : linkedInputs;
assert.ok(linkedCases.every(file => linkedInputs.includes(file)), 'Unknown original linked input.');
const c3Cases = new Set((args['--c3-cases'] ?? 'reuse,pressure-25-to-18,pressure-18-to-25').split(','));
assert.ok([...c3Cases].every(id => ['reuse', 'pressure-25-to-18', 'pressure-18-to-25'].includes(id)), 'Unknown C3 subcase.');
await freshDirectory(output); await freshDirectory(work);
const commands = [], checks = [];
let activeCheck = 'Preflight';
let failure, identity, before, inputs;
let commandNumber = 0;

async function command(name, executable, argv, expected = 0) {
  const receipt = await runRecorded({ executable, args: argv, cwd: repository, prefix: path.join(output, 'commands', `${String(++commandNumber).padStart(3, '0')}-${name}`), timeoutMs: 120000 });
  await verifySavedBytes(receipt);
  commands.push(receipt);
  assert.equal(receipt.timedOut, false, `${name}: timed out`);
  assert.equal(receipt.spawnError, null, `${name}: spawn failed`);
  assert.equal(receipt.exitCode, expected, `${name}: exit ${receipt.exitCode}; expected ${expected}; preserve raw receipt before classification.`);
  return receipt;
}
async function product(name, argv, expected = 0) { return command(name, dotnet, [cli, ...argv], expected); }
async function seed(caseName) {
  const content = path.join(work, caseName, 'content'); await freshDirectory(content);
  for (const folder of ['items', '_requests', 'skills', 'characters', 'encounters', 'trials', 'rules', '_imports']) await mkdir(path.join(content, folder), { recursive: true });
  const items = ['expedition_ore', 'quenching_sand', 'mat_grain', 'con_simple_meal', 'eq_patrol_sword'];
  for (const id of items) await copyFile(path.join(repository, 'content/items', `${id}.json`), path.join(content, 'items', `${id}.json`));
  // Only the accepted P1 seed requests, never later P2 business imports/notes.
  for (const id of ['REQ-0001', 'REQ-0002', 'REQ-0003']) await copyFile(path.join(repository, 'content/_requests', `${id}.json`), path.join(content, '_requests', `${id}.json`));
  await copyFile(rules, path.join(content, 'rules/rules_combat.json'));
  return content;
}
async function importScenario(file, content, name) {
  const result = await product(`${name}-import`, ['import-scenario', file, '--content', content]);
  const value = JSON.parse(result.stdoutBytes.toString('utf8')); assert.equal(value.ok, true); assert.equal(typeof value.trialId, 'string');
  return value;
}
async function noWriteOnRejectedImport(source, content, name, id) {
  const prior = await snapshotFiles(content);
  const result = await product(name, ['import-scenario', source, '--content', content], 1);
  assert.deepEqual(await snapshotFiles(content), prior, 'Rejected import changed a file, raw byte, or path.');
  const message = result.stdoutBytes.toString('utf8') + result.stderrBytes.toString('utf8');
  assert.ok(message.includes(id), `Conflict error does not identify ${id}.`);
  return { conflictingId: id, completeDirectoryUnchanged: true, stdout: result.stdout, stderr: result.stderr };
}
function unexpectedKeys(normalized, candidate, pointer = '') {
  const errors = [];
  if (Array.isArray(candidate) && Array.isArray(normalized)) candidate.forEach((v, i) => errors.push(...unexpectedKeys(normalized[i], v, `${pointer}/${i}`)));
  else if (candidate && typeof candidate === 'object' && normalized && typeof normalized === 'object') {
    for (const [key, value] of Object.entries(candidate)) {
      if (!Object.hasOwn(normalized, key)) errors.push(`${pointer}/${key}`);
      else errors.push(...unexpectedKeys(normalized[key], value, `${pointer}/${key}`));
    }
  }
  return errors;
}

try {
  assert.equal(sha256(await readFile(cli)), args['--expected-cli-sha'], 'Explicit product DLL identity mismatch; do not run this candidate.');
  const contractPath = path.join(repository, 'docs/editor/P2_API_CONTRACT.md');
  assert.equal(sha256(await readFile(contractPath)), args['--contract-sha'], 'Contract changed or is not frozen.');
  const oracleBuild = await readJson(path.resolve(repository, args['--oracle-build']));
  assert.equal(oracleBuild.passed, true); assert.equal(sha256(await readFile(oracleBuild.assembly.path)), oracleBuild.assembly.sha256);
  const currentKernel = await sourceSnapshot();
  for (const source of oracleBuild.sourceAfter.filter(s => s.path.startsWith('Game/Assets/Prototype/Combat/Runtime/') && s.path.endsWith('.cs'))) {
    assert.deepEqual(currentKernel.find(s => s.path === source.path), source, 'Oracle was built from a different kernel source. Reconcile the authorized version before a product check.');
  }
  // Missing formal rules is a not-ready precondition, not a wave of failed imports.
  assert.equal((await readJson(rules)).id, 'rules_combat');
  if (selection.has('C2')) {
    assert.ok(args['--observer-source-sha'], 'C2 requires the root-frozen observer source hash and explicitly ready product adapter.');
    assert.equal(sha256(await readFile(path.join(repository, 'Game/Assets/Prototype/Combat/Runtime/CombatExpedition.cs'))), args['--observer-source-sha']);
  }
  before = await sourceSnapshot();
  inputs = await captureInputs(path.join(output, 'original-inputs'));
  identity = { dotnet, cli: { path: cli, sha256: args['--expected-cli-sha'] }, oracle: oracleBuild.assembly, contract: { path: contractPath, sha256: args['--contract-sha'] }, protectedPhysicalFiles: before.length,
    declaredBaseline: '2651a82322d675a077031b8bea2aec797a52cead', gitBlobProvenance: 'Independently supplied by Git owner; physical SHA is not a Git blob claim.' };
  if (args['--build-receipt']) {
    const source = path.resolve(repository, args['--build-receipt']);
    const bytes = await readFile(source);
    await copyFile(source, path.join(output, 'PRODUCT_BUILD_RECEIPT.json'));
    identity.productBuildReceipt = { source, bytes: bytes.length, sha256: sha256(bytes) };
  }
  const input = file => path.join(output, 'original-inputs', file);

  if (selection.has('C1')) for (const file of cases) {
    activeCheck = `C1:${file}`;
    const name = file.replace(/\.json$/, ''); const content = await seed(`c1-${name}`);
    const originalOut = path.join(output, 'C1', name, 'direct');
    const assembledOut = path.join(output, 'C1', name, 'assembled-kernel');
    await command(`${name}-direct`, dotnet, [oracleBuild.assembly.path, 'single', input(file), '--out', originalOut]);
    const imported = await importScenario(input(file), content, name);
    const assembled = path.join(output, 'C1', name, 'assembled.json');
    await product(`${name}-assemble`, ['assemble', imported.trialId, '--content', content, '--out', assembled]);
    await command(`${name}-assembled-kernel`, dotnet, [oracleBuild.assembly.path, 'single', assembled, '--out', assembledOut]);
    const logs = compareLogBytes(await readFile(path.join(originalOut, 'combat.log')), await readFile(path.join(assembledOut, 'combat.log')));
    const expected = await readJson(path.join(originalOut, 'normalized-scenario.json'));
    const normalizedDifference = compareTrees(expected, await readJson(path.join(assembledOut, 'normalized-scenario.json')));
    const initialDifference = compareTrees(await readJson(path.join(originalOut, 'initial-snapshot.json')), await readJson(path.join(assembledOut, 'initial-snapshot.json')));
    const resultDifference = compareTrees(await readJson(path.join(originalOut, 'run-result.json')), await readJson(path.join(assembledOut, 'run-result.json')));
    const helperKeys = unexpectedKeys(expected, await readJson(assembled));
    const metadata = await readJson(path.join(content, '_imports', `${imported.trialId}.json`));
    assert.equal(metadata.sourceKind, 'scenario'); assert.equal(metadata.sourceJson, (await readFile(input(file))).toString('utf8'));
    assert.equal(metadata.sourceSha256, sha256(await readFile(input(file))));
    const comparison = { file, trialId: imported.trialId, logs, normalizedDifference, initialDifference, resultDifference, unexpectedRuntimeKeys: helperKeys, sourceProvenance: metadata.sourceSha256 };
    await writeJson(path.join(output, 'C1', name, 'COMPARISON.json'), comparison);
    assert.equal(logs.equal, true, `${file}: ExportLogText bytes differ.`);
    assert.deepEqual(normalizedDifference, [], `${file}: normalized Runtime fields/order differ.`); assert.deepEqual(initialDifference, []); assert.deepEqual(resultDifference, []); assert.deepEqual(helperKeys, []);
    checks.push({ id: activeCheck, status: 'Passed', evidence: path.join(output, 'C1', name, 'COMPARISON.json') });
  }
  if (selection.has('C2')) for (const file of linkedCases) {
    activeCheck = `C2:${file}`;
    const name = file.replace(/\.json$/, ''); const content = await seed(`c2-${name}`);
    const directOut = path.join(output, 'C2', name, 'direct');
    const assembledOut = path.join(output, 'C2', name, 'assembled-kernel');
    await command(`${name}-direct-linked`, dotnet, [oracleBuild.assembly.path, 'linked', input(file), '--out', directOut]);
    const importReceipt = await product(`${name}-import-linked`, ['import-expedition', input(file), '--content', content]);
    const imported = JSON.parse(importReceipt.stdoutBytes.toString('utf8')); assert.equal(imported.ok, true);
    const assembled = path.join(output, 'C2', name, 'assembled.json');
    await product(`${name}-assemble-linked`, ['assemble', imported.trialId, '--content', content, '--out', assembled]);
    await command(`${name}-assembled-linked`, dotnet, [oracleBuild.assembly.path, 'linked', assembled, '--out', assembledOut]);
    const direct = await readJson(path.join(directOut, 'ORACLE_RESULT.json'));
    const candidate = await readJson(path.join(assembledOut, 'ORACLE_RESULT.json'));
    assert.equal(direct.result.sameRuntimeInstance, true); assert.equal(candidate.result.sameRuntimeInstance, true);
    assert.equal(direct.result.replayCalls, 0); assert.equal(candidate.result.replayCalls, 0);
    const source = await readJson(input(file));
    assert.equal(direct.result.logs.length, source.encounters.length); assert.equal(candidate.result.logs.length, source.encounters.length);
    const logs = [];
    for (let index = 0; index < source.encounters.length; index++) {
      const left = direct.result.logs[index], right = candidate.result.logs[index];
      assert.equal(left.encounterIndex, index + 1); assert.equal(right.encounterIndex, index + 1);
      assert.equal(left.encounterId, source.encounters[index].id); assert.equal(right.encounterId, left.encounterId);
      assert.equal(left.scenarioId, source.encounters[index].scenario.id); assert.equal(right.scenarioId, left.scenarioId);
      logs.push({ encounterIndex: index + 1, encounterId: left.encounterId, scenarioId: left.scenarioId,
        ...compareLogBytes(await readFile(path.join(directOut, left.file)), await readFile(path.join(assembledOut, right.file))) });
    }
    const normalizedDifference = compareTrees(await readJson(path.join(directOut, 'normalized-expedition.json')), await readJson(path.join(assembledOut, 'normalized-expedition.json')));
    const reportDifference = compareTrees(await readJson(path.join(directOut, 'expedition-report.json')), await readJson(path.join(assembledOut, 'expedition-report.json')));
    const comparison = { file, trialId: imported.trialId, logRoute: 'SameRuntimeExpeditionInstance.ExportEncounterLogText', logs, normalizedDifference, reportDifference };
    await writeJson(path.join(output, 'C2', name, 'COMPARISON.json'), comparison);
    assert.ok(logs.every(row => row.equal), `${file}: same-instance encounter log bytes differ.`);
    assert.deepEqual(normalizedDifference, []); assert.deepEqual(reportDifference, []);
    checks.push({ id: activeCheck, status: 'Passed', evidence: path.join(output, 'C2', name, 'COMPARISON.json') });
  }
  if (selection.has('C3')) {
    if (c3Cases.has('reuse')) {
    activeCheck = 'C3:equivalent-library-area';
    const content = await seed('c3-reuse'); await importScenario(input('round4_mage_library.json'), content, 'c3-library');
    const priorSkills = (await readdir(path.join(content, 'skills'))).sort();
    const area = await importScenario(input('round4_area.json'), content, 'c3-area');
    assert.deepEqual((await readdir(path.join(content, 'skills'))).sort(), priorSkills); assert.equal(priorSkills.length, 35);
    assert.equal(area.reused.filter(r => r.type === 'skill').length, 35);
    checks.push({ id: 'C3:equivalent-reuse', status: 'Passed', skillCount: priorSkills.length });
    activeCheck = 'C3:modified-skill-same-source-reimport';
    const skillFile = path.join(content, 'skills/mage_firebolt.json'); const mutated = await readJson(skillFile); mutated.magnitude++;
    await writeJson(skillFile, mutated);
    const altered = await noWriteOnRejectedImport(input('round4_area.json'), content, 'c3-altered-reimport', 'mage_firebolt');
    checks.push({ id: activeCheck, status: 'Passed', skillCount: priorSkills.length, altered });
    }
    for (const [first, next, direction] of [['round2_capacity.json', 'round2_one_idle.json', '25-to-18'], ['round2_one_idle.json', 'round2_capacity.json', '18-to-25']]) {
      if (!c3Cases.has(`pressure-${direction}`)) continue;
      activeCheck = `C3:pressure-${direction}`;
      const root = await seed(`c3-pressure-${direction}`); await importScenario(input(first), root, `c3-pressure-${direction}-initial`);
      const rejected = await noWriteOnRejectedImport(input(next), root, `c3-pressure-${direction}-conflict`, 'pressure_strike');
      checks.push({ id: activeCheck, status: 'Passed', ...rejected });
    }
  }
} catch (error) {
  failure = { check: activeCheck, category: activeCheck === 'Preflight' ? 'HarnessOrEnvironmentPrecondition_NotProductRun' : 'AcceptanceFailure_RequiresProductHarnessEnvironmentTriage', message: error.message, stack: error.stack };
}
const after = before ? await sourceSnapshot() : undefined;
if (before && JSON.stringify(before) !== JSON.stringify(after)) failure ??= { check: 'SourceProtection', category: 'SourceChangedDuringRun', message: 'Protected Game/input files changed while this isolated check ran.' };
await writeJson(path.join(output, 'P2_CLI_ACCEPTANCE.json'), { schemaVersion: 1, passed: !failure, scope: 'Only explicitly listed checks; no P2 completion claim.', identity, requested: [...selection], selectedCases: cases,
  c2: { status: checks.filter(check => check.id.startsWith('C2:')).length ? 'Executed_ListedCasesOnly' : 'NotRun', reason: selection.has('C2') ? 'SameInstanceObserver_SelectedCases' : linkedLogStatus }, checks, failure, physicalInputManifest: inputs, sourceBefore: before, sourceAfter: after,
  commands: commands.map(({ stdoutBytes, stderrBytes, ...receipt }) => receipt), isolated: { work, allWritesUnderDedicatedRoots: true, noServicesOrBrowsersStarted: true } });
console.log(JSON.stringify({ passed: !failure, checks: checks.map(c => c.id), failure,
  c2: checks.some(check => check.id.startsWith('C2:')) ? 'Executed_ListedCasesOnly' : linkedLogStatus, evidence: output }));
process.exitCode = failure ? 1 : 0;
