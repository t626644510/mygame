// Isolated acceptance data only. Never write these objects to formal content/.
export function building(id, changes = {}) {
  return { schemaVersion: 1, id, name: id, description: 'P3 isolated acceptance fixture',
    footprint: { w: 1, h: 1 }, walkableFootprint: true, entrance: { x: 0, y: 0 },
    function: 'workshop', recipeIds: ['rcp_simple_meal'], workSlots: 1, storageSlots: 0,
    ownership: 'private', buildCost: { cash: 0, workTicks: 0, materials: [] }, draft: false, ...changes };
}

export function recipe(id, changes = {}) {
  return { schemaVersion: 1, id, name: id, inputs: [{ itemId: 'mat_grain', quantity: 1 }],
    outputs: [{ itemId: 'con_simple_meal', quantity: 1 }], workTicks: 3,
    workerTags: ['cook'], draft: false, ...changes };
}

export function layout(id, changes = {}) {
  return { schemaVersion: 1, id, name: id, width: 10, height: 5, movementTicksPerTile: 1,
    tiles: [], buildings: [{ instanceId: 'kitchen_01', buildingId: 'bld_legacy_kitchen', x: 3, y: 2, rotation: 0, ownership: 'private' }],
    spawns: [{ id: 'supplier', x: 1, y: 2, role: 'supplier' }, { id: 'customer', x: 0, y: 2, role: 'customer' }],
    zones: [], draft: false, ...changes };
}

export function flows(changes = {}) {
  return { schemaVersion: 1, id: 'rules_base_item_flows',
    sources: [{ itemId: 'mat_grain', kind: 'resident_sale', note: 'Isolated first-meal source annotation' }],
    sinks: [{ itemId: 'con_simple_meal', kind: 'resident_need', note: 'Isolated first-meal sink annotation' }], ...changes };
}

export function rotationProbe() {
  return {
    definition: building('bld_rotation_probe', { footprint: { w: 3, h: 2 }, walkableFootprint: false, entrance: { x: 1, y: 2 } }),
    layout: layout('layout_rotation_probe', { buildings: [{ instanceId: 'rotated_01', buildingId: 'bld_rotation_probe', x: 3, y: 1, rotation: 90, ownership: 'private' }] }),
    expected: { width: 2, height: 3, localEntrance: { x: -1, y: 1 }, worldEntrance: { x: 2, y: 2 }, storedRotation: 90 },
  };
}

// Each case is active. Geometry problems must not pass by draft exclusion.
// Additional consequences such as disconnected endpoints are not suppressed.
export function invalidLayouts() {
  return [
    { code: 'out_of_bounds', entity: layout('layout_bad_bounds', { buildings: [{ instanceId: 'bad_bounds', buildingId: 'bld_legacy_kitchen', x: -1, y: 2, rotation: 0, ownership: 'private' }] }) },
    { code: 'overlap', entity: layout('layout_bad_overlap', { buildings: [
      { instanceId: 'overlap_a', buildingId: 'bld_legacy_kitchen', x: 3, y: 2, rotation: 0, ownership: 'private' },
      { instanceId: 'overlap_b', buildingId: 'bld_legacy_kitchen', x: 3, y: 2, rotation: 0, ownership: 'private' },
    ] }) },
    { code: 'entrance_blocked', entity: layout('layout_bad_entrance', { tiles: [{ x: 3, y: 2, kind: 'blocked' }] }) },
    { code: 'unreachable', entity: layout('layout_bad_unreachable', { tiles: Array.from({ length: 5 }, (_, y) => ({ x: 2, y, kind: 'water' })) }) },
    { code: 'ownership_not_allowed', definition: building('bld_private_probe'), entity: layout('layout_bad_ownership', { buildings: [{ instanceId: 'wrong_owner', buildingId: 'bld_private_probe', x: 3, y: 2, rotation: 0, ownership: 'public' }] }) },
  ];
}

export function chainProbes() {
  return {
    noSource: recipe('rcp_no_source_probe', { inputs: [{ itemId: 'mat_moon_silk', quantity: 1 }] }),
    cycle: [recipe('rcp_cycle_a', { outputs: [{ itemId: 'mat_moon_silk', quantity: 1 }] }), recipe('rcp_cycle_b', { inputs: [{ itemId: 'mat_moon_silk', quantity: 1 }], outputs: [{ itemId: 'mat_grain', quantity: 1 }] })],
    noBuilding: recipe('rcp_unassigned_probe'),
    noSink: recipe('rcp_no_sink_probe', { outputs: [{ itemId: 'mat_moon_silk', quantity: 1 }] }),
    nonPositiveMargin: recipe('rcp_negative_margin_probe', { inputs: [{ itemId: 'con_simple_meal', quantity: 1 }], outputs: [{ itemId: 'mat_grain', quantity: 1 }] }),
  };
}
