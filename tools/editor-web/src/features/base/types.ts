import type {RequestDraft} from '../../types'

export const baseTypes = ['building', 'layout', 'recipe', 'rule'] as const
export type BaseType = typeof baseTypes[number]
export type BaseModule = 'map' | 'production'
export const flowRuleId = 'rules_base_item_flows'
export const baseLabels: Record<BaseType, string> = {building: '建筑', layout: '布局', recipe: '配方', rule: '物品流规则'}
export const functionLabels: Record<string, string> = {workshop: '工坊', storage: '仓储', housing: '住宅', shop: '商店', public_service: '公共服务', decoration: '装饰', pending: '其他（未实现）'}
export const ownerLabels = {public: '公有', private: '私有', both: '公有 / 私有均可'}
interface Entity {schemaVersion: number; id: string; name?: string; description?: string; draft?: boolean; aliases?: string[]}
export interface Point {x: number; y: number}
export interface Material {itemId: string; quantity: number}
export interface Building extends Entity {
 name: string; description: string; footprint: {w: number; h: number}; walkableFootprint: boolean; entrance: Point
 function: string; recipeIds: string[]; workSlots: number; storageSlots: number; ownership: 'public' | 'private' | 'both'
 buildCost: {cash: number; workTicks: number; materials: Material[]}
}
export interface Recipe extends Entity {name: string; inputs: Material[]; outputs: Material[]; workTicks: number; workerTags: string[]}
export interface BuildingInstance extends Point {instanceId: string; buildingId: string; rotation: number; ownership: 'public' | 'private'}
export interface Spawn extends Point {id: string; role: string}
export interface Layout extends Entity {name: string; width: number; height: number; movementTicksPerTile: number; tiles: (Point & {kind: 'blocked' | 'water'})[]; buildings: BuildingInstance[]; spawns: Spawn[]; zones: never[]}
export interface FlowEntry {itemId: string; kind: string; note?: string}
export interface FlowRules extends Entity {sources: FlowEntry[]; sinks: FlowEntry[]}
export type BaseEntity = Building | Recipe | Layout | FlowRules
export interface BaseSession {type: BaseType; entity: BaseEntity; base: BaseEntity; etag: string; isNew: boolean; requests: RequestDraft[]; revision: number; past: BaseEntity[]; future: BaseEntity[]}
export interface BaseIssue {code: string; message: string; severity: string; blocking: boolean; entityType: string; entityId: string; field: string; instanceId: string; spawnId: string; x: number | null; y: number | null}
export interface Geometry extends Point {instanceId: string; buildingId: string; width: number; height: number; rotation: number; entrance: Point}
export interface LayoutCheck {ok: boolean; errors: BaseIssue[]; warnings: BaseIssue[]; geometry: Geometry[]}
export interface DistanceTarget extends Point {kind: 'building' | 'spawn'; id: string; instanceId: string; spawnId: string; tiles: number; ticks: number}
export interface LayoutDistance {width: number; height: number; from: Point; distanceField: number[]; targets: DistanceTarget[]}
export interface ChainNode {id: string; type: 'item' | 'recipe'; entityId: string; label: string; flags: string[]}
export interface ChainEdge {id: string; source: string; target: string; itemId: string; recipeId: string; quantity: number}
export interface ChainRecipe {recipeId: string; buildings: string[]; inputValue: number; outputValue: number; workTicks: number; valueAddedPerTick: number; flags: string[]}
export interface ChainItem {itemId: string; sources: Record<string, unknown>[]; sinks: Record<string, unknown>[]; flags: string[]}
export interface ChainAnalysis {items: ChainItem[]; recipes: ChainRecipe[]; cycles: string[][]; graph: {nodes: ChainNode[]; edges: ChainEdge[]}; issues: BaseIssue[]; excludedDraftIds: string[]}
export function baseName(entity: BaseEntity) {return entity.name || (entity.id === flowRuleId ? '基地物品来源与去处' : entity.id)}
export function newBaseEntity(type: BaseType): BaseEntity {
 const common = {schemaVersion: 1, draft: false}
 if (type === 'building') return {...common, id: 'bld_', name: '', description: '', footprint: {w: 2, h: 2}, walkableFootprint: false, entrance: {x: 1, y: 2}, function: 'workshop', recipeIds: [], workSlots: 1, storageSlots: 0, ownership: 'both', buildCost: {cash: 0, workTicks: 1, materials: []}}
 if (type === 'recipe') return {...common, id: 'rcp_', name: '', inputs: [], outputs: [], workTicks: 1, workerTags: []}
 if (type === 'layout') return {...common, id: 'layout_', name: '', width: 16, height: 12, movementTicksPerTile: 1, tiles: [], buildings: [], spawns: [], zones: []}
 return {schemaVersion: 1, id: flowRuleId, sources: [], sinks: []}
}
