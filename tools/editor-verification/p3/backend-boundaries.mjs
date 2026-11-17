import assert from 'node:assert/strict';
import { P3HttpContext } from './http-context.mjs';
import { building, recipe, layout, flows } from './fixtures.mjs';

const ctx = new P3HttpContext(process.argv.slice(2));
const selected = new Set((ctx.args['--only'] ?? 'aliases,etag,refs,schema,distance,pending').split(','));
assert.ok(selected.size && [...selected].every(id => ['aliases', 'etag', 'refs', 'schema', 'distance', 'pending'].includes(id)), 'Unknown --only boundary.');
ctx.scope = `Targeted P3 ${[...selected].join(',')} boundaries only; no repeated D2-D8 suite, browser or Unity.`;
const phase = (id, name, action) => selected.has(id) ? ctx.phase(name, action) : undefined;
let failure = null;
async function pure(type, entity, mode = 'create', requests) {
  return ctx.unchanged(() => ctx.api('/api/validate-entity', 'POST', { type, mode, entity, ...(requests ? { requests } : {}) }));
}
try {
  await ctx.initialize(); await ctx.start('boundaries');
  await ctx.create('rule', flows());
  const seed = await ctx.api('/api/import-first-meal', 'POST', {});
  assert.equal(seed.status, 200); assert.equal(seed.json.ok, true); // prerequisite import only

  const aliasedRecipe = recipe('rcp_boundary_probe', { aliases: ['legacy_recipe_alias'] });
  const aliasedBuilding = building('bld_boundary_probe', { aliases: ['legacy_building_alias'], recipeIds: ['legacy_recipe_alias'],
    buildCost: { cash: 0, workTicks: 0, materials: [{ itemId: 'quenching-sand', quantity: 2 }] } });
  const aliasLayout = layout('layout_boundary_probe', { buildings: [{ instanceId: 'alias_01', buildingId: 'legacy_building_alias', x: 3, y: 2, rotation: 0, ownership: 'private' }] });
  if (!selected.has('aliases') && (selected.has('etag') || selected.has('refs'))) {
    await ctx.create('recipe', aliasedRecipe); await ctx.create('building', aliasedBuilding); await ctx.create('layout', aliasLayout);
  }
  await phase('aliases', 'P3_alias_resolution_global_collision_and_original_reference_strings', async () => {
    await ctx.create('recipe', aliasedRecipe); await ctx.create('building', aliasedBuilding); await ctx.create('layout', aliasLayout);
    const lookup = await ctx.api('/api/ids/legacy_building_alias');
    assert.equal(lookup.status, 200); assert.equal(lookup.json.canonicalId, aliasedBuilding.id); assert.equal(lookup.json.type, 'building'); assert.equal(lookup.json.viaAlias, true);
    const check = await ctx.unchanged(() => ctx.api('/api/layout/check', 'POST', { layout: aliasLayout }));
    assert.equal(check.status, 200); assert.equal(check.json.ok, true); assert.equal(check.json.geometry[0].width, 1);
    const bad = building('bld_duplicate_alias_probe', { aliases: ['expedition-ore'] });
    ctx.require422(await pure('building', bad));
    ctx.require422(await ctx.unchanged(() => ctx.api(`/api/content/building/${bad.id}`, 'PUT', bad, { 'If-None-Match': '*' })));
    const badItem = structuredClone((await ctx.get('item', 'mat_grain')).json); badItem.id = aliasedBuilding.id;
    ctx.require422(await ctx.unchanged(() => ctx.api('/api/validate-item', 'POST', { mode: 'create', entity: badItem })));
    const reread = await ctx.get('building', aliasedBuilding.id); assert.deepEqual(reread.json.recipeIds, ['legacy_recipe_alias']);
    assert.equal((await ctx.get('layout', aliasLayout.id)).json.buildings[0].buildingId, 'legacy_building_alias');
    return { canonicalBuilding: lookup.json, aliasStringsPreserved: true, layout: aliasLayout.id };
  });
  await phase('etag', 'P3_ETag_already_exists_stale_current_and_fresh_save', async () => {
    const original = await ctx.get('building', aliasedBuilding.id);
    const duplicate = await ctx.unchanged(() => ctx.api(`/api/content/building/${aliasedBuilding.id}`, 'PUT', aliasedBuilding, { 'If-None-Match': '*' }));
    assert.equal(duplicate.status, 409); assert.equal(duplicate.json.etag, original.response.headers.etag); assert.deepEqual(duplicate.json.current, original.json);
    const freshValue = { ...original.json, name: 'Fresh disk version' }; const saved = await ctx.save('building', freshValue);
    assert.notEqual(saved.response.headers.etag, original.response.headers.etag);
    const stale = await ctx.unchanged(() => ctx.api(`/api/content/building/${aliasedBuilding.id}`, 'PUT', { ...original.json, name: 'Rejected stale version' }, { 'If-Match': original.response.headers.etag }));
    assert.equal(stale.status, 409); assert.deepEqual(stale.json.current, saved.json); assert.equal(stale.json.etag, saved.response.headers.etag);
    await ctx.save('building', { ...saved.json, name: 'Final fresh version' });
    return { alreadyExists: duplicate.status, stale: stale.status, freshSaved: true };
  });
  await phase('refs', 'P3_refs_alias_delete_protection_and_existing_item_bridge', async () => {
    const refs = await ctx.api(`/api/refs/${aliasedBuilding.id}`); assert.equal(refs.status, 200);
    const aliasRefs = await ctx.api('/api/refs/legacy_building_alias'); assert.deepEqual(aliasRefs.json, refs.json);
    const use = refs.json.find(row => row.sourceType === 'layout' && row.sourceId === aliasLayout.id);
    assert.ok(use); assert.equal(use.jsonPointer, '/buildings/0/buildingId'); assert.equal(use.quantity, null);
    const recipeRefs = await ctx.api(`/api/refs/${aliasedRecipe.id}`);
    assert.ok(recipeRefs.json.some(row => row.sourceType === 'building' && row.sourceId === aliasedBuilding.id && row.jsonPointer === '/recipeIds/0'));
    const sandRefs = await ctx.api('/api/refs/quenching-sand');
    assert.ok(sandRefs.json.some(row => row.sourceType === 'building' && row.sourceId === aliasedBuilding.id && row.quantity === 2));
    for (const [type, id] of [['building', aliasedBuilding.id], ['recipe', aliasedRecipe.id], ['item', 'quenching_sand']]) {
      const disk = await ctx.get(type, id);
      const rejected = await ctx.unchanged(() => ctx.api(`/api/content/${type}/${id}`, 'DELETE', undefined, { 'If-Match': disk.response.headers.etag }));
      assert.equal(rejected.status, 409); assert.equal(rejected.json.code, 'referenced'); assert.ok(rejected.json.refs.length);
    }
    const weapon = (await ctx.get('item', 'eq_patrol_sword')).json;
    const enhance = weapon.equipment.enhancement.find(row => row.level === 1);
    assert.equal(enhance.attackBonusDelta, 4);
    assert.ok(enhance.materials.some(row => row.itemId === 'expedition_ore' && row.quantity === 3));
    assert.ok(enhance.materials.some(row => row.itemId === 'quenching_sand' && row.quantity === 2));
    return { buildingRefs: refs.json, recipeRefs: recipeRefs.json, sandReferences: sandRefs.json, existingEnhancement: enhance };
  });
  await phase('schema', 'P3_schema_nested_null_fraction_and_source_label_rejected_without_write', async () => {
    const probes = [
      building('bld_bad_null_probe', { footprint: null }),
      building('bld_bad_fraction_probe', { footprint: { w: 1.5, h: 1 } }),
      building('bld_bad_nested_probe', { buildCost: { cash: 0, workTicks: 0, materials: [], extra: true } }),
      building('bld_bad_instance_material_probe', { buildCost: { cash: 0, workTicks: 0, materials: [{ itemId: 'guard-linen-sword-001', quantity: 1 }] } }),
    ];
    for (const entity of probes) {
      ctx.require422(await pure('building', entity));
      ctx.require422(await ctx.unchanged(() => ctx.api(`/api/content/building/${entity.id}`, 'PUT', entity, { 'If-None-Match': '*' })));
    }
    ctx.require422(await pure('layout', layout('layout_bad_size_probe', { width: 257 })));
    ctx.require422(await pure('recipe', recipe('rcp_zero_quantity_probe', { inputs: [{ itemId: 'mat_grain', quantity: 0 }] })));
    return { pairedBuildingCases: probes.map(row => row.id), layoutSize257Rejected: true, recipeQuantityZeroRejected: true };
  });
  await phase('distance', 'P3_distance_invalid_source_unreachable_and_storage_threshold_tiles', async () => {
    const wall = layout('layout_partition_distance_probe', { movementTicksPerTile: 3,
      tiles: Array.from({ length: 5 }, (_, y) => ({ x: 2, y, kind: 'water' })) });
    const unreachable = await ctx.unchanged(() => ctx.api('/api/layout/distance', 'POST', { layout: wall, from: { instanceId: 'kitchen_01' } }));
    assert.equal(unreachable.status, 200); assert.equal(unreachable.json.distanceField.length, 50);
    for (const id of ['supplier', 'customer']) {
      const target = unreachable.json.targets.find(row => row.kind === 'spawn' && row.id === id);
      assert.equal(target.tiles, -1); assert.equal(target.ticks, -1);
    }
    for (const from of [{ instanceId: 'missing_instance' }, { instanceId: 'kitchen_01', x: 3, y: 2 }, { x: 2, y: 2 }, { x: -1, y: 2 }])
      ctx.require422(await ctx.unchanged(() => ctx.api('/api/layout/distance', 'POST', { layout: wall, from })));
    const storage = building('bld_storage_probe', { function: 'storage', recipeIds: [], storageSlots: 4 }); await ctx.create('building', storage);
    const observations = [];
    for (const [name, storageX, tiles, expectedDistance, shouldWarn] of [
      ['twelve_tiles', 13, [], 12, false], ['thirteen_tiles', 14, [], 13, true],
      ['detour_exceeds_twelve', 13, [1, 2, 3].map(y => ({ x: 7, y, kind: 'blocked' })), 16, true],
    ]) {
      const candidate = layout(`layout_${name}_probe`, { width: 18, movementTicksPerTile: 2, tiles, buildings: [
        { instanceId: 'workshop', buildingId: 'bld_legacy_kitchen', x: 1, y: 2, rotation: 0, ownership: 'private' },
        { instanceId: 'storage', buildingId: storage.id, x: storageX, y: 2, rotation: 0, ownership: 'private' },
      ] });
      const checked = await ctx.unchanged(() => ctx.api('/api/layout/check', 'POST', { layout: candidate }));
      assert.equal(checked.status, 200); assert.equal(checked.json.ok, true);
      const warnings = checked.json.warnings.filter(row => row.code === 'far_from_storage');
      assert.equal(warnings.length > 0, shouldWarn);
      for (const row of warnings) { assert.equal(row.severity, 'warning'); assert.equal(row.blocking, false); }
      const distance = await ctx.unchanged(() => ctx.api('/api/layout/distance', 'POST', { layout: candidate, from: { instanceId: 'workshop' } }));
      assert.equal(distance.status, 200);
      const target = distance.json.targets.find(row => row.kind === 'building' && row.id === 'storage');
      assert.equal(target.tiles, expectedDistance); assert.equal(target.ticks, expectedDistance * 2);
      observations.push({ name, tiles: target.tiles, ticks: target.ticks, farFromStorage: shouldWarn });
    }
    const noStorage = await ctx.unchanged(() => ctx.api('/api/layout/check', 'POST', { layout: layout('layout_no_storage_probe') }));
    assert.equal(noStorage.json.warnings.some(row => row.code === 'far_from_storage'), false);
    return { unreachableTargets: unreachable.json.targets, observations, noStorageDoesNotInventWarning: true };
  });
  await phase('pending', 'P3_pending_requires_atomic_base_request', async () => {
    const pending = building('bld_pending_boundary_probe', { function: 'pending', recipeIds: [], draft: true });
    ctx.require422(await pure('building', pending));
    ctx.require422(await ctx.unchanged(() => ctx.api(`/api/content/building/${pending.id}`, 'PUT', pending, { 'If-None-Match': '*' })));
    const requests = [{ kind: 'new_building_function', owner: 'base', title: 'Boundary pending function', field: 'function', body: 'Static fixture only.', expected: '' }];
    const validated = await pure('building', pending, 'create', requests); assert.equal(validated.status, 200);
    const saved = await ctx.api(`/api/content/building/${pending.id}`, 'PUT', { entity: pending, requests }, { 'If-None-Match': '*' });
    assert.equal(saved.status, 201); assert.equal(saved.json.createdRequests.length, 1);
    const created = saved.json.createdRequests[0]; assert.equal(created.kind, 'new_building_function'); assert.equal(created.owner, 'base'); assert.equal(created.target, `building:${pending.id}`);
    assert.deepEqual((await ctx.get('building', pending.id)).json, pending);
    const listing = await ctx.api('/api/requests'); assert.ok(listing.json.some(row => row.id === created.id && row.target === created.target));
    return { request: created, negativePureAndPutNoWrite: true, compoundStatus: saved.status };
  });
} catch (error) { failure = { check: ctx.activeCheck, category: 'UnclassifiedFirstFailureRequiresReview', message: error.message, stack: error.stack }; }
process.exitCode = await ctx.finish(failure) ? 0 : 1;
