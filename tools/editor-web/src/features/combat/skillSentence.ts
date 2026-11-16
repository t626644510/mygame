import type {RuntimeAction} from './types'

const modes: Record<string, string> = {single: '指令选中的一名合法目标', row: '锚点同队、同排且仍在指令范围内的合法目标', column: '锚点同队、同列且仍在指令范围内的合法目标', all: '锚点同队且仍在指令范围内的全部合法目标'}
const statusRead: Record<string, (skill: RuntimeAction) => string> = {
 guard: skill => `施加每次直接减伤 ${skill.statusMagnitude ?? 0} 的防护`,
 magic_guard: skill => `施加额外减少魔法伤害 ${skill.statusMagnitude ?? 0} 的魔法屏障`,
 empowered: skill => `施加伤害输出加值 ${skill.statusMagnitude ?? 0} 的增伤`,
 weakened: skill => `施加伤害输出减值 ${skill.statusMagnitude ?? 0} 的虚弱`,
 vulnerable: () => '施加易伤标记，供条件和选择器识别，不附加伤害倍率',
 haste: skill => `施加 ${skill.statusMagnitude ?? 0} 速度点的加速`,
 slow: skill => `施加 ${skill.statusMagnitude ?? 0} 速度点的减速`,
 silenced: () => '施加沉默，阻止 isMagic 为真的动作',
 stunned: () => '施加定身，阻止主动行动，保留尚余的正常 WAIT',
}
export function skillSentence(skill: RuntimeAction & {draft?: boolean}): string {
 if (skill.draft && skill.effectKind === 'pending') return '待实现效果，仅登记需求；不会进入试跑或运行时导出。'
 const target = modes[skill.targetMode || 'single'] || `目标模式“${skill.targetMode}”（未实现）`
 const damage = {magic: '魔法', physical: '物理', legacy: '旧兼容'}[skill.damageType || 'legacy'] || skill.damageType
 const effects: Record<string, string> = {
  damage: `对${target}造成基础 ${skill.magnitude} 点${damage}伤害；实际值由核心计入装备、增减伤和防护`,
  heal: `为${target}恢复至多 ${skill.magnitude} HP，不超过最大 HP`,
  restore_mp: `为${target}恢复至多 ${skill.magnitude} MP，不超过最大 MP；施放消耗先扣除，目标由指令选择`,
  drain_mp: `从${target}汲取至多 ${skill.magnitude} MP，并向施放者返还实际扣除量，封顶其最大 MP；不能自吸，返还溢出销毁`,
  apply_status: `向${target}${statusRead[skill.statusKind || '']?.(skill) || `施加状态“${skill.statusKind || '未选择'}”`}，持续 ${skill.statusDuration ?? 0} WAIT；同状态 ID 替换刷新`,
  cleanse: `清除${target}的全部有害动态状态及永久易伤测试标记`,
  dispel: `清除${target}的全部增益状态`,
 }
 return `消耗 ${skill.mpCost} MP；基础 WAIT ${skill.baseWait}（效果即时结算后的行动间隔，实际间隔见试跑）。${effects[skill.effectKind] || `效果“${skill.effectKind}”尚未实现`}。${skill.isMagic ? '属于魔法动作，被沉默时不能使用。' : '属于非魔法动作，不因沉默被禁止。'}${skill.targetMode && skill.targetMode !== 'single' ? '群体只扣一次 MP、预约一次 WAIT；覆盖成员不重复判断锚点条件。' : ''}`
}
