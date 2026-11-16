import {useEffect, useRef, useState} from 'react'
import {Plus, Trash2} from 'lucide-react'
import {Button} from '../../components/ui/button'
import {useEditorStore} from '../../store'
import {combatApi, errorsFrom} from './api'
import {useCombatStore, visibleEntities, sessionDirty} from './store'
import {attributeLabels, splitTags, type Character, type CharacterValidation, type Encounter, type Session, type Skill, type Trial} from './types'
import {NumberField, TextField} from './Fields'
import {CombatRuleEditor} from './CombatRuleEditor'
import {SourceSummary} from './SourceSummary'
import {ResolvedActions} from './ActionOverridesEditor'

export function CharacterEditor({session, onNote}: {session: Session; onNote: (field: string) => void}) {
 const state = useCombatStore(), character = session.entity as Character
 const [preview, setPreview] = useState<CharacterValidation | null>(null), [previewError, setPreviewError] = useState(''), serial = useRef(0)
 const items = useEditorStore(s => s.items), skills = visibleEntities<Skill>('skill')
 const online = useEditorStore(s => s.online)
 const encounters = visibleEntities<Encounter>('encounter')
 const contexts = visibleEntities<Trial>('trial').flatMap(trial => trial.encounters.flatMap((encounter, index) => trial.allies.some(slot => slot.characterId === character.id) || encounters.find(item => item.id === encounter.encounterId)?.enemies.some(slot => slot.characterId === character.id) ? [{trialId: trial.id, encounterIndex: index + 1, label: `${trial.title} · 第 ${index + 1} 场`}] : []))
 const contextOptionsKey = contexts.map(c => `${c.trialId}:${c.encounterIndex}`).join('|')
 const contextKey = state.context ? `${state.context.trialId}:${state.context.encounterIndex}` : ''
 const revisionKey = Object.values(state.sessions).filter(sessionDirty).map(s => `${s.type}:${s.entity.id}:${s.revision}`).join('|')
 useEffect(() => {
  if (!online) return
  const choices = contextOptionsKey.split('|').filter(Boolean)
  if (choices.includes(contextKey)) return
  if (choices.length === 1) {const separator = choices[0].lastIndexOf(':'); useCombatStore.getState().setContext({trialId: choices[0].slice(0, separator), encounterIndex: Number(choices[0].slice(separator + 1))})}
  else if (contextKey) useCombatStore.getState().setContext(undefined)
 }, [character.id, contextOptionsKey, contextKey, online])
 useEffect(() => {
  if (!online) return
  const controller = new AbortController(), request = ++serial.current
  setPreview(null); setPreviewError('')
  const timer = window.setTimeout(() => {
   const store = useCombatStore.getState()
   void combatApi.character(character, store.overrides(character.id), store.context, controller.signal).then(value => {if (request === serial.current) setPreview(value)}).catch(error => {if (!controller.signal.aborted && request === serial.current) setPreviewError(errorsFrom(error).map(e => e.message).join('\n') || (error instanceof Error ? error.message : '核心预览失败'))})
  }, 300)
  return () => {clearTimeout(timer); controller.abort()}
 }, [character, session.revision, contextKey, revisionKey, online])
 useEffect(() => {
  if (!state.highlight) return
  const frame = requestAnimationFrame(() => {const row = Array.from(document.querySelectorAll<HTMLElement>('[data-instruction-id]')).find(row => row.dataset.instructionId === state.highlight); row?.scrollIntoView({block: 'center'}); row?.querySelector<HTMLElement>('button')?.focus()})
  return () => cancelAnimationFrame(frame)
 }, [state.highlight])
 if (!state.catalog) return null
 const edit = state.edit, change = <K extends keyof Character,>(key: K, value: Character[K]) => edit('/' + key, entity => Object.assign(entity, {[key]: value}))
 const used = character.instructions.length, capacity = preview?.instructionCapacity
 const learnedIds = preview?.availableActions ?? character.availableActionIds ?? []
 const actionsPending = !preview && character.availableActionIds === undefined
 return <div className="combat-character"><div className="combat-character-main"><section className="combat-card"><div className="combat-two"><TextField name="name" label="角色名称" value={character.name} onChange={value => change('name', value)} errors={state.errors} /><TextField name="tags" label="标签" value={character.tags?.join(', ')} onChange={value => change('tags', splitTags(value))} /></div><div className="attribute-grid">{Object.entries(attributeLabels).map(([id, label]) => {const index = character.attributes.findIndex(attribute => attribute.id === id); return <div className={id === 'intelligence' ? '' : 'attribute-pending'} key={id}><NumberField name={`attributes.${index}.value`} label={label} value={character.attributes[index]?.value} integer min={0} onChange={value => edit(`/attributes/${index}/value`, entity => {(entity as Character).attributes[index].value = value})} errors={state.errors} hint={id === 'intelligence' ? '进入核心指令容量' : '尚未接入战斗'} /></div>})}</div><div className="combat-three">{(['maxHp', 'maxMp', 'agilityFactor'] as const).map(key => <NumberField key={key} name={`combatOverride.${key}`} label={{maxHp: '最大 HP', maxMp: '最大 MP', agilityFactor: '敏捷系数'}[key]} value={character.combatOverride[key]} integer={key !== 'agilityFactor'} onChange={value => edit(`/combatOverride/${key}`, entity => {(entity as Character).combatOverride[key] = value})} hint="手填 · 等公式" errors={state.errors} />)}</div></section>
  <section className="combat-card capacity-card"><div className="combat-two"><label>校验规则来源<select aria-label="角色校验规则来源" value={contextKey} onChange={e => {const choice = contexts.find(context => `${context.trialId}:${context.encounterIndex}` === e.target.value); state.setContext(choice ? {trialId: choice.trialId, encounterIndex: choice.encounterIndex} : undefined)}}><option value="">{contexts.length > 1 ? '有多个来源，请明确选择' : contexts.length ? '自动解析唯一来源' : '新建角色 · 全局模板'}</option>{contexts.map(context => <option value={`${context.trialId}:${context.encounterIndex}`} key={`${context.trialId}:${context.encounterIndex}`}>{context.label}</option>)}</select></label><div className="capacity-summary" data-testid="instruction-capacity"><strong>{capacity === undefined ? '核心校验中…' : `${used} / ${capacity} 条`}</strong><span>条件项上限 {preview?.conditionTermCapacity ?? '—'}</span></div></div><div className="capacity-meter"><i style={{width: capacity ? `${Math.min(100, used / capacity * 100)}%` : '0%'}} /></div>{preview && <p className="field-hint" title={`智力 ${preview.ruleContext.rules.capacity.secondConditionAtIntelligence} 开放第2项，${preview.ruleContext.rules.capacity.thirdConditionAtIntelligence} 开放第3项条件`}>核心规则 {preview.ruleContext.rulesId} · 当前校验不执行战斗，技能已接通不代表当前 MP 足够。</p>}{previewError && <p className="field-error" role="alert">{previewError}</p>}</section>
  <CombatRuleEditor character={{...character, availableActionIds: learnedIds}} skills={skills.map(skill => {const actual = preview?.resolvedActions.find(action => action.actionId === skill.id && action.encounterIndex === preview.ruleContext.encounterIndex); return actual ? {...skill, ...actual.effective} : skill})} catalog={state.catalog} validation={preview || undefined} actionsPending={actionsPending} onChange={instructions => change('instructions', instructions)} onNote={onNote} highlight={state.highlight} />
  <section className="combat-card"><h3>默认装备</h3><p className="field-hint">仅投影基础 equipmentDamageBonus；强化等级、实例与来源标签不会当作物品定义。</p>{character.defaultEquipment.map((entry, index) => <div className="equipment-row" key={index}><select aria-label={`装备${index + 1}槽位`} value={entry.slot} onChange={e => {const entries = [...character.defaultEquipment]; entries[index] = {...entry, slot: e.target.value}; change('defaultEquipment', entries)}}>{['weapon', 'armor', 'accessory'].map(slot => <option key={slot}>{slot}</option>)}</select><select aria-label={`装备${index + 1}定义`} value={entry.itemId} onChange={e => {const entries = [...character.defaultEquipment]; entries[index] = {...entry, itemId: e.target.value}; change('defaultEquipment', entries)}}>{!items.some(item => item.id === entry.itemId) && <option value={entry.itemId}>{entry.itemId || '选择装备定义'}</option>}{items.filter(item => item.category === 'equipment').map(item => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select><Button size="icon" variant="ghost" aria-label={`删除装备${index + 1}`} onClick={() => change('defaultEquipment', character.defaultEquipment.filter((_, i) => i !== index))}><Trash2 size={14} /></Button></div>)}<Button size="sm" onClick={() => change('defaultEquipment', [...character.defaultEquipment, {slot: 'weapon', itemId: items.find(item => item.category === 'equipment')?.id || ''}])}><Plus size={13} />添加基础装备</Button></section>
 </div><aside className="combat-inspector"><details className="learned-actions" open><summary>已学技能 <span className="mono">{actionsPending ? '解析中…' : learnedIds.length}</span></summary><p className="field-hint">{actionsPending ? '缺省技能池正等待核心解析；解析完成后才能明确修改。' : '职业标签只分组；勾选才明确修改白名单。'}</p>{[...new Set(skills.map(skill => skill.classTags?.[0] || '未分组'))].map(group => <section key={group}><h3>{group}</h3>{skills.filter(skill => (skill.classTags?.[0] || '未分组') === group).map(skill => <label className={`learned-action ${skill.draft ? 'pending-token' : ''}`} key={skill.id}><input type="checkbox" disabled={actionsPending} checked={learnedIds.includes(skill.id)} onChange={e => change('availableActionIds', e.target.checked ? [...new Set([...learnedIds, skill.id])] : learnedIds.filter(id => id !== skill.id))} /><span>{skill.displayName}<code>{skill.id}</code></span>{skill.draft && <span className="badge pending">草稿</span>}</label>)}</section>)}</details><SourceSummary contexts={preview ? [preview.ruleContext] : []} />{preview && <ResolvedActions actions={preview.resolvedActions} />}</aside></div>
}
