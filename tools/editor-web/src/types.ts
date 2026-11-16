export const categories = ['material', 'equipment', 'consumable', 'currency', 'key'] as const
export type Category = typeof categories[number]
export const categoryLabels: Record<Category, string> = { material: '材料', equipment: '装备', consumable: '消耗品', currency: '货币', key: '关键物品' }
export const categoryPrefixes: Record<Category, string> = { material: 'mat_', equipment: 'eq_', consumable: 'con_', currency: 'cur_', key: 'key_' }

export interface Material { itemId: string; quantity: number }
export interface Enhancement { level: number; cash: number; attackBonusDelta: number; materials: Material[] }
export interface Item {
  schemaVersion: number
  id: string
  aliases: string[]
  name: string
  category: Category
  description: string
  icon: string
  stackLimit: number
  baseValue: number
  tags: string[]
  equipment: { slot: string; combatBonus: {id: string; value: number}[]; enhancement: Enhancement[] }
  consumable: { effects: {kind: string; note: string}[] }
  draft: boolean
}
export interface ContentError { path: string; code: string; message: string; field?: string }
export interface Validation { ok: boolean; errors: ContentError[]; warnings: string[] }
export interface Reference { sourceType: string; sourceId: string; path: string; jsonPointer: string; quantity: number | null; legacy: boolean; direction: 'source' | 'usage' | 'mapping' | 'reference' }
export interface Catalog { combatBonusFields: {id: string; label: string; source: string}[] }
export interface Capabilities { schemaVersion: number; contentTypes: {id: string; plural: string; label: string; editable: boolean}[]; itemCategories: string[]; equipmentSlots: string[]; combatBonusFields: Catalog['combatBonusFields']; consumableEffectKinds: string[]; exportRoot: string }
export const requestKinds = ['note', 'new_item_property', 'balance', 'bug', 'new_effect', 'new_condition', 'new_selector', 'new_status', 'new_building_function'] as const
export type RequestKind = typeof requestKinds[number]
export interface RequestDraft { kind: RequestKind; owner: string; target: string; title: string; body: string; expected: string; field: string; createdAt: string; status: 'open' }
export interface RequestRecord extends Omit<RequestDraft, 'status'> { schemaVersion: number; id: string; status: string; resolvedBy: string }
export interface EntitySummary { id: string; path: string }
export interface IdResult { exists: boolean; type: string; canonicalId: string; path: string; viaAlias: boolean }
export interface EditorSession { item: Item; base: Item; etag: string; isNew: boolean; pendingRequests: RequestDraft[] }
export interface Conflict { disk: Item; etag: string }

export function emptyItem(category: Category = 'material'): Item {
  return { schemaVersion: 1, id: categoryPrefixes[category], aliases: [], name: '', category, description: '', icon: '', stackLimit: category === 'equipment' ? 1 : 99, baseValue: 0, tags: [], equipment: { slot: category === 'equipment' ? 'weapon' : '', combatBonus: [], enhancement: [] }, consumable: { effects: [] }, draft: false }
}

export function needsCapability(item: Item, catalog: Catalog | null): boolean {
  return item.consumable.effects.length > 0 || item.equipment.combatBonus.some(b => !catalog?.combatBonusFields.some(field => field.id === b.id))
}

export function splitReferences(refs: Reference[]) {
  return { source: refs.filter(ref => ref.direction === 'source'), usage: refs.filter(ref => ref.direction === 'usage') }
}
