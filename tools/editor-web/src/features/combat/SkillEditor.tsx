import {useCombatStore} from './store'
import {splitTags, type Skill} from './types'
import {NumberField, SelectField, TextField} from './Fields'
import {skillSentence} from './skillSentence'

export function SkillEditor({skill}: {skill: Skill}) {
 const {catalog, edit, errors} = useCombatStore()
 if (!catalog) return null
 const change = <K extends keyof Skill,>(key: K, value: Skill[K]) => edit('/' + key, entity => {Object.assign(entity, {[key]: value})})
 return <div className="combat-editor-grid"><div className="combat-form">
  <TextField name="displayName" label="技能名称" value={skill.displayName} onChange={value => change('displayName', value)} errors={errors} />
  <SelectField name="effectKind" label="效果" value={skill.effectKind} options={[...catalog.effectKinds, {id: 'pending', label: '其他（未实现）'}]} onChange={value => change('effectKind', value)} errors={errors} />
  {skill.effectKind === 'pending' && <p className="pending-notice">待实现效果：须附一条 combat 专项非备注需求。保存后为草稿，依赖它的试炼和导出会被阻止。</p>}
  <div className="combat-two"><NumberField name="mpCost" label="MP 消耗" value={skill.mpCost} integer min={0} onChange={value => change('mpCost', value)} errors={errors} /><NumberField name="baseWait" label="基础 WAIT" value={skill.baseWait} onChange={value => change('baseWait', value)} hint="效果结算后的基础行动间隔。" errors={errors} /></div>
  <SelectField name="targetMode" label="目标模式" value={skill.targetMode} options={catalog.targetModes} onChange={value => change('targetMode', value)} errors={errors} hint="先由指令选锚点，再按模式覆盖；不是敌我范围。" />
  <label className="combat-check"><input type="checkbox" checked={skill.isMagic ?? false} onChange={e => change('isMagic', e.target.checked)} />魔法动作 · 会被沉默阻止{skill.isMagic === undefined && <small>原字段缺省</small>}</label>
  {skill.effectKind === 'damage' && <SelectField name="damageType" label="伤害种类" value={skill.damageType} options={catalog.damageTypes} onChange={value => change('damageType', value)} errors={errors} hint="与“魔法动作”独立；原 legacy 不自动改为 physical。" />}
  {['damage', 'heal', 'restore_mp', 'drain_mp'].includes(skill.effectKind) && <NumberField name="magnitude" label="基础量" value={skill.magnitude} integer min={0} onChange={value => change('magnitude', value)} errors={errors} />}
  {skill.effectKind === 'apply_status' && <section className="combat-card"><h3>状态</h3><TextField name="statusId" label="状态 ID" value={skill.statusId} onChange={value => change('statusId', value)} errors={errors} /><SelectField name="statusKind" label="状态类别" value={skill.statusKind} options={catalog.statusKinds} onChange={value => change('statusKind', value)} errors={errors} /><div className="combat-two"><NumberField name="statusMagnitude" label="状态强度" value={skill.statusMagnitude} integer onChange={value => change('statusMagnitude', value)} errors={errors} /><NumberField name="statusDuration" label="持续 WAIT" value={skill.statusDuration} onChange={value => change('statusDuration', value)} errors={errors} /></div></section>}
  <TextField name="classTags" label="职业标签" value={skill.classTags?.join(', ')} onChange={value => change('classTags', splitTags(value))} hint="仅用于分组，不会扩大角色已学技能。" errors={errors} />
  <TextField name="description" label="说明" value={skill.description} onChange={value => change('description', value)} multiline errors={errors} />
 </div><aside className="combat-inspector"><div className="inspector-heading">读出来是这样</div><p className="skill-sentence" data-testid="skill-sentence">{skillSentence(skill)}</p><p className="field-hint">这里只描述配置；真实扣除、目标、结算与行动间隔以 C# 试跑为准。切换效果不会自动删除未编辑字段。</p><SkillReferences /></aside></div>
}
export function SkillReferences() {const refs = useCombatStore(s => s.refs); return <section className="combat-card"><h3>谁在用 <span className="mono">{refs.length}</span></h3>{refs.map((ref, index) => <div className="reference-line" key={index}><strong>{ref.sourceId}</strong><code>{ref.path}{ref.jsonPointer}</code>{ref.legacy && <span className="badge legacy">旧配置 · 只读</span>}</div>)}{!refs.length && <p className="field-hint">没有已保存的引用。</p>}</section>}
