import type {Building, BuildingInstance, Geometry, Point} from './types'

export {referenceIndex as buildingIndex, resolveReference as resolveBuilding} from './references'

// Screen/grid y increases downward. Rotate external entrance coordinates too;
// the entrance must never be clamped into the solid footprint.
export function projectBuilding(building: Building, instance: BuildingInstance): Geometry {
 let width = building.footprint.w, height = building.footprint.h, entrance: Point = {...building.entrance}
 for (let turns = 0; turns < ((instance.rotation % 360) + 360) % 360 / 90; turns++) {
  entrance = {x: height - 1 - entrance.y, y: entrance.x}; [width, height] = [height, width]
 }
 return {instanceId: instance.instanceId, buildingId: instance.buildingId, x: instance.x, y: instance.y, width, height, rotation: instance.rotation, entrance: {x: instance.x + entrance.x, y: instance.y + entrance.y}}
}
export function validEntrance(building: Building, point: Point) {
 const {w, h} = building.footprint, {x, y} = point
 const inside = x >= 0 && x < w && y >= 0 && y < h
 return building.walkableFootprint && inside || (x === -1 || x === w) && y >= 0 && y < h || (y === -1 || y === h) && x >= 0 && x < w
}
