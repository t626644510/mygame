import assert from 'node:assert/strict';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { P3HttpContext } from './http-context.mjs';
import { repository, firstMealInput, readJson, writeJson, snapshotFiles, sha256 } from './evidence.mjs';
import { building, layout, flows, rotationProbe, invalidLayouts, chainProbes } from './fixtures.mjs';

const ctx = new P3HttpContext(process.argv.slice(2));
const selected = new Set((ctx.args['--only'] ?? 'D2,D3,D4,D5,D8').split(','));
assert.ok(selected.size && [...selected].every(id => ['D2', 'D3', 'D4', 'D5', 'D8'].includes(id)), 'Unknown --only criterion.');
const d3Codes = new Set((ctx.args['--d3-codes'] ?? invalidLayouts().map(probe => probe.code).join(',')).split(','));
const d3Cases = invalidLayouts().filter(probe => d3Codes.has(probe.code));
assert.equal(d3Cases.length, d3Codes.size, 'Unknown --d3-codes selector.');
ctx.scope = `Only selected ${[...selected].join(',')} backend/CLI criteria. Browser, performance, screenshots, Unity and whole-P3 approval are separate.`;
const phase = (id, name, action) => selected.has(id) ? ctx.phase(name, action) : undefined;
let failure = null;
async function chain() {
  const result = await ctx.unchanged(() => ctx.api('/api/chain'));
  assert.equal(result.status, 200); return result.json;
}
function assertWarning(result, code, id) {
  const matches = result.issues.filter(issue => issue.code === code && (issue.entityId === id || JSON.stringify(issue).includes(id)));
  assert.ok(matches.length, `Missing ${code} for ${id}`);
  for (const issue of matches) { assert.equal(issue.severity, 'warning'); assert.equal(issue.blocking, false); }
}
async function exportOk() {
  const result = await ctx.unchanged(() => ctx.api('/api/export', 'POST', {}));
  assert.equal(result.status, 200); assert.equal(result.json.ok, true); return result;
}
async function exportRejected(needle) {
  const result = await ctx.unchanged(() => ctx.unchanged(() => ctx.api('/api/export', 'POST', {}), ctx.runtime));
  ctx.require422(result, needle); return result;
}

try {
  await ctx.initialize();
  await ctx.start('backend');
  await writeFile(path.join(ctx.runtime, 'unmanaged.keep'), Buffer.from([0, 13, 10, 255]));
  if (!selected.has('D2')) {
    // Fresh prerequisite data for a targeted follow-up, never a repeated D2 PASS.
    await ctx.create('rule', flows());
    const setup = await ctx.api('/api/import-first-meal', 'POST', {});
    assert.equal(setup.status, 200); assert.equal(setup.json.ok, true);
  }
  await phase('D2', 'D2_real_import_distance_and_existing_kernel_bridge', async () => {
    assert.ok(ctx.args['--first-meal-baseline'], 'Pass the actual FIRST_MEAL_BASELINE.json; do not replace the old kernel oracle by a formula.');
    const baselinePath = path.resolve(repository, ctx.args['--first-meal-baseline']);
    const baselineBytes = await readFile(baselinePath); const baseline = JSON.parse(baselineBytes.toString('utf8'));
    assert.equal(baseline.kernelOraclePassed, true); assert.equal(baseline.sourceStable, true);
    const inputBytes = await readFile(path.join(repository, firstMealInput));
    assert.equal(baseline.sourceAfter.find(row => row.path === firstMealInput).sha256, sha256(inputBytes));
    for (const row of baseline.sourceAfter.filter(row => row.path.startsWith('Game/Assets/Prototype/BaseEconomy/Runtime/')))
      assert.equal(sha256(await readFile(path.join(repository, row.path))), row.sha256);
    await copyFile(baselinePath, path.join(ctx.output, 'FIRST_MEAL_BASELINE.json'));
    await ctx.create('rule', flows());
    const receiptPath = path.join(ctx.output, 'first-meal-import.json');
    await ctx.cliCommand('import-first-meal', ['import-first-meal', '--content', ctx.content, '--out', receiptPath]);
    const imported = await readJson(receiptPath);
    assert.equal(imported.ok, true); assert.equal(imported.staticOnly, true); assert.equal(imported.created.length, 4);
    assert.equal(imported.source.sha256, sha256(inputBytes));
    const repeat = await ctx.unchanged(() => ctx.api('/api/import-first-meal', 'POST', {}));
    assert.equal(repeat.status, 200); assert.equal(repeat.json.created.length, 0); assert.equal(repeat.json.reused.length, 4);
    const distances = [];
    for (const [name, supplierTiles, customerTiles] of [['near', 2, 3], ['far', 7, 8]]) {
      const disk = await ctx.get('layout', `layout_first_meal_${name}`);
      const result = await ctx.unchanged(() => ctx.api('/api/layout/distance', 'POST', { layout: disk.json, from: { instanceId: 'kitchen_01' } }));
      assert.equal(result.status, 200); assert.equal(result.json.distanceField.length, disk.json.width * disk.json.height);
      assert.equal(result.json.distanceField[result.json.from.y * disk.json.width + result.json.from.x], 0);
      const supplier = result.json.targets.find(target => target.kind === 'spawn' && target.id === 'supplier');
      const customer = result.json.targets.find(target => target.kind === 'spawn' && target.id === 'customer');
      assert.equal(supplier.tiles, supplierTiles); assert.equal(customer.tiles, customerTiles);
      assert.equal(supplier.ticks, supplierTiles * disk.json.movementTicksPerTile); assert.equal(customer.ticks, customerTiles * disk.json.movementTicksPerTile);
      const direct = baseline.results.find(row => row.name === name);
      assert.equal(direct.firstMealTick, name === 'near' ? 7 : 17);
      distances.push({ name, supplier, customer, directKernelFirstMealTick: direct.firstMealTick });
    }
    return { imported, distances, directKernelReceipt: { path: baselinePath, bytes: baselineBytes.length, sha256: sha256(baselineBytes) } };
  });
  await phase('D3', `D3_active_layouts_${d3Cases.map(probe => probe.code).join('_')}_save_locate_export_no_write`, async () => {
    await exportOk();
    const checks = [];
    for (const probe of d3Cases) {
      if (probe.definition) await ctx.create('building', probe.definition);
      const pure = await ctx.unchanged(() => ctx.api('/api/validate-entity', 'POST', { type: 'layout', mode: 'create', entity: probe.entity }));
      assert.equal(pure.status, 200, 'Geometry must remain editable at the structure-validation boundary.');
      await ctx.create('layout', probe.entity);
      assert.equal((await ctx.get('layout', probe.entity.id)).json.draft, false);
      const checked = await ctx.unchanged(() => ctx.api('/api/layout/check', 'POST', { layout: probe.entity }));
      assert.equal(checked.status, 200); assert.equal(checked.json.ok, false);
      const issues = checked.json.errors.filter(issue => issue.code === probe.code);
      assert.ok(issues.length, `Missing ${probe.code}`);
      for (const issue of issues) {
        assert.equal(issue.severity, 'error'); assert.equal(issue.blocking, true); assert.equal(issue.entityId, probe.entity.id);
        assert.ok(issue.field && (issue.instanceId || issue.spawnId), 'Issue must locate an actual instance or spawn.');
        const group = issue.instanceId ? 'buildings' : 'spawns';
        const index = probe.entity[group].findIndex(target => (group === 'buildings' ? target.instanceId : target.id) === (issue.instanceId || issue.spawnId));
        assert.ok(index >= 0); assert.ok(issue.field === `/${group}/${index}` || issue.field.startsWith(`/${group}/${index}/`));
        assert.ok(Number.isInteger(issue.x) && Number.isInteger(issue.y), 'Spatial issue must expose a real grid location.');
      }
      const validated = await ctx.unchanged(() => ctx.api('/api/validate-content', 'POST', {}));
      ctx.require422(validated, probe.code);
      await exportRejected(probe.code);
      checks.push({ code: probe.code, layoutId: probe.entity.id, issues, exported: false, wholeTargetUnchanged: true });
      await ctx.remove('layout', probe.entity.id);
    }
    await exportOk();
    return checks;
  });
  await phase('D5', 'D5_rotation_geometry_distance_saved_original_definition', async () => {
    const probe = rotationProbe();
    await ctx.create('building', probe.definition); await ctx.create('layout', probe.layout);
    const checked = await ctx.unchanged(() => ctx.api('/api/layout/check', 'POST', { layout: probe.layout }));
    assert.equal(checked.status, 200); assert.equal(checked.json.ok, true);
    const geometry = checked.json.geometry.find(row => row.instanceId === 'rotated_01');
    assert.equal(geometry.width, 2); assert.equal(geometry.height, 3); assert.equal(geometry.rotation, 90);
    assert.deepEqual(geometry.entrance, probe.expected.worldEntrance);
    const distance = await ctx.unchanged(() => ctx.api('/api/layout/distance', 'POST', { layout: probe.layout, from: { instanceId: 'rotated_01' } }));
    assert.equal(distance.status, 200); assert.deepEqual(distance.json.from, probe.expected.worldEntrance);
    assert.equal((await ctx.get('layout', probe.layout.id)).json.buildings[0].rotation, 90);
    assert.deepEqual((await ctx.get('building', probe.definition.id)).json, probe.definition);
    return { geometry, expected: probe.expected, frontendStatus: 'NotRun' };
  });
  await phase('D4', 'D4_five_flags_are_visible_nonblocking_and_definition_usage', async () => {
    const baseline = await chain();
    const meal = baseline.recipes.find(row => row.recipeId === 'rcp_simple_meal');
    assert.equal(meal.inputValue, 6); assert.equal(meal.outputValue, 10); assert.equal(meal.workTicks, 3); assert.equal(meal.valueAddedPerTick, 1.3333);
    const moon = structuredClone((await ctx.get('item', 'mat_grain')).json);
    Object.assign(moon, { id: 'mat_moon_silk', aliases: [], name: 'P3 isolated moon-silk fixture', description: 'Isolated work-order acceptance fixture.', baseValue: 2, tags: [] });
    await ctx.create('item', moon);
    const probes = chainProbes(); const observations = [];
    for (const [name, code, entities, target] of [
      ['noSource', 'no_source', [probes.noSource], moon.id],
      ['cycle', 'cycle', probes.cycle, probes.cycle[0].id],
      ['noBuilding', 'no_building', [probes.noBuilding], probes.noBuilding.id],
      ['noSink', 'no_sink', [probes.noSink], moon.id],
      ['nonPositiveMargin', 'non_positive_margin', [probes.nonPositiveMargin], probes.nonPositiveMargin.id],
    ]) {
      for (const entity of entities) await ctx.create('recipe', entity);
      const result = await chain(); assertWarning(result, code, target);
      if (name === 'cycle') assert.ok(result.cycles.some(cycle => probes.cycle.every(entity => cycle.includes(entity.id))));
      if (name === 'nonPositiveMargin') assert.equal(result.recipes.find(row => row.recipeId === target).valueAddedPerTick, -1.3333);
      if (name === 'noBuilding') {
        const unplaced = building('bld_unplaced_probe', { recipeIds: [target] });
        await ctx.create('building', unplaced);
        const defined = await chain();
        assert.equal(defined.recipes.find(row => row.recipeId === target).flags.includes('no_building'), false, 'An unplaced building definition still implements the recipe.');
        assert.ok(defined.recipes.find(row => row.recipeId === target).buildings.includes(unplaced.id));
        await ctx.remove('building', unplaced.id);
      }
      await exportOk(); observations.push({ name, code, target, exportSucceeded: true });
      for (const entity of entities) await ctx.remove('recipe', entity.id);
    }
    return { meal, observations };
  });
  await phase('D8', 'D8_four_exports_draft_notes_repeated_bytes_and_hard_references', async () => {
    const pending = building('bld_pending_probe', { function: 'pending', recipeIds: [], draft: true, notes: 'Editor-only draft note' });
    await ctx.create('building', pending, [{ kind: 'new_building_function', owner: 'base', title: 'Isolated pending building', body: 'No runtime implementation is requested by this fixture.', expected: '', field: 'function' }]);
    const meal = structuredClone((await ctx.get('recipe', 'rcp_simple_meal')).json); meal.notes = 'Editor-only recipe note'; await ctx.save('recipe', meal);
    await exportOk(); const first = await snapshotFiles(ctx.runtime);
    await ctx.cliCommand('export-repeat', ['export', '--content', ctx.content, '--out', ctx.runtime]);
    assert.deepEqual(await snapshotFiles(ctx.runtime), first, 'Repeat export differs in paths or original bytes.');
    const files = ['buildings.json', 'recipes.json', 'layouts.json', 'base_item_flows.json'];
    function noEditorFields(value) {
      if (Array.isArray(value)) { for (const row of value) noEditorFields(row); return; }
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) { assert.ok(!['draft', 'notes', 'note'].includes(key), `Editor field leaked: ${key}`); noEditorFields(child); }
    }
    const exports = [];
    for (const file of files) {
      const bytes = await readFile(path.join(ctx.runtime, file)); const value = JSON.parse(bytes.toString('utf8'));
      noEditorFields(value); assert.equal(JSON.stringify(value).includes(pending.id), false);
      exports.push({ file, bytes: bytes.length, sha256: sha256(bytes) });
    }
    const pendingLayout = layout('layout_active_pending_probe', { buildings: [{ instanceId: 'pending_01', buildingId: pending.id, x: 3, y: 2, rotation: 0, ownership: 'private' }] });
    await ctx.create('layout', pendingLayout); await exportRejected(pending.id); await ctx.remove('layout', pendingLayout.id);
    const badReference = structuredClone((await ctx.get('recipe', 'rcp_simple_meal')).json);
    badReference.inputs[0].itemId = 'mat_missing_probe';
    const badFile = ctx.entityFile('recipe', badReference.id); const originalBytes = await readFile(badFile);
    await writeJson(badFile, badReference); // Explicit isolated file-corruption fixture, never a successful editor save.
    try { await exportRejected('mat_missing_probe'); } finally { await writeFile(badFile, originalBytes); }
    await exportOk();
    return { files: exports, repeatedWholeTargetEqual: true, draftExcluded: pending.id, missingReferenceInjection: 'Isolated content file only; original bytes restored in finally.' };
  });
} catch (error) { failure = { check: ctx.activeCheck, category: 'UnclassifiedFirstFailureRequiresReview', message: error.message, stack: error.stack }; }
process.exitCode = await ctx.finish(failure) ? 0 : 1;
