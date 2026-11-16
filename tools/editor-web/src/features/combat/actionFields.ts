import type {ActionField} from './types'
export const actionFields: {id: ActionField; label: string; kind: 'string' | 'number' | 'boolean'}[] = [
 {id: 'displayName', label: '名称', kind: 'string'}, {id: 'effectKind', label: '效果', kind: 'string'}, {id: 'magnitude', label: '基础量', kind: 'number'}, {id: 'mpCost', label: 'MP消耗', kind: 'number'}, {id: 'baseWait', label: '基础WAIT', kind: 'number'}, {id: 'statusId', label: '状态ID', kind: 'string'}, {id: 'statusKind', label: '状态类别', kind: 'string'}, {id: 'statusMagnitude', label: '状态强度', kind: 'number'}, {id: 'statusDuration', label: '持续WAIT', kind: 'number'}, {id: 'targetMode', label: '目标模式', kind: 'string'}, {id: 'isMagic', label: '魔法动作', kind: 'boolean'}, {id: 'damageType', label: '伤害种类', kind: 'string'},
]
export const actionValue = (value: unknown) => value === undefined ? '（Runtime字段缺省）' : typeof value === 'string' ? value === '' ? '""' : value : JSON.stringify(value)
