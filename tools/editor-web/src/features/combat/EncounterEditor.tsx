import {useState} from 'react'
import {Plus, Trash2} from 'lucide-react'
import {Button} from '../../components/ui/button'
import {useEditorStore} from '../../store'
import {useCombatStore, visibleEntities} from './store'
import type {Encounter, Rules, Trial} from './types'
import {NumberField, TextField} from './Fields'
import {FormationEditor} from './FormationEditor'
import {ActionOverridesEditor} from './ActionOverridesEditor'

export function EncounterEditor({encounter}: {encounter: Encounter}) {
 const state = useCombatStore(), items = useEditorStore(s => s.items), [rulesChoice, setRulesChoice] = useState('')
 const drops = encounter.publicDrops ?? []
 const allRules = visibleEntities<Rules>('rule')
 const contexts = visibleEntities<Trial>('trial').flatMap(trial => trial.encounters.filter(slot => slot.encounterId === encounter.id).map(slot => slot.rulesId || trial.rulesId || 'rules_combat'))
 const choices = [...new Set(contexts.length ? contexts : ['rules_combat'])]
 const ruleId = rulesChoice && choices.includes(rulesChoice) ? rulesChoice : choices.length === 1 ? choices[0] : ''
 const rules = allRules.find(rules => rules.id === ruleId) || null
 const change = <K extends keyof Encounter,>(key: K, value: Encounter[K]) => state.edit('/' + key, entity => Object.assign(entity, {[key]: value}))
 return <div className="combat-scroll combat-encounter"><div className="combat-two"><TextField name="name" label="遭遇名称" value={encounter.name} onChange={value => change('name', value)} errors={state.errors} /><label>站位检查来源<select aria-label="遭遇站位规则来源" value={ruleId} onChange={e => setRulesChoice(e.target.value)}>{choices.length > 1 && <option value="">多个规则来源，请选择</option>}{choices.map(id => <option key={id}>{id}</option>)}</select></label></div><TextField name="description" label="说明" value={encounter.description} onChange={value => change('description', value)} multiline errors={state.errors} /><ActionOverridesEditor encounter={encounter} onChange={value => change('actionOverrides', value)} /><FormationEditor slots={encounter.enemies} rules={rules} label="敌方站位" onChange={value => change('enemies', value)} /><section className="combat-card"><h3>胜利奖励配置</h3><p className="field-hint">这是配置，实际是否获得由核心战斗结果决定。</p><div className="combat-two"><NumberField name="experiencePool" label="经验池" value={encounter.experiencePool} integer min={0} onChange={value => change('experiencePool', value)} errors={state.errors} /><NumberField name="publicCash" label="公库现金" value={encounter.publicCash} integer min={0} onChange={value => change('publicCash', value)} errors={state.errors} /></div>{drops.map((drop, index) => <div className="drop-row" key={index} data-field={`publicDrops.${index}`}><select aria-label={`掉落${index + 1}物品`} value={drop.itemId} onChange={e => {const updated = [...drops]; updated[index] = {...drop, itemId: e.target.value}; change('publicDrops', updated)}}>{!items.some(item => item.id === drop.itemId) && <option value={drop.itemId}>{drop.itemId} · 原引用</option>}{items.map(item => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select><input aria-label={`掉落${index + 1}数量`} type="number" min="1" step="1" value={drop.quantity} onChange={e => {if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) {const updated = [...drops]; updated[index] = {...drop, quantity: e.target.valueAsNumber}; change('publicDrops', updated)}}} /><Button size="icon" aria-label={`删除掉落${index + 1}`} variant="ghost" onClick={() => change('publicDrops', drops.filter((_, i) => i !== index))}><Trash2 size={14} /></Button></div>)}<Button size="sm" onClick={() => change('publicDrops', [...drops, {itemId: items[0]?.id || '', quantity: 1}])}><Plus size={13} />添加掉落</Button></section></div>
}
