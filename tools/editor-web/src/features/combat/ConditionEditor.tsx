import {useState} from 'react'
import {Plus, Trash2} from 'lucide-react'
import {Modal} from '../../components/ui/modal'
import {Button} from '../../components/ui/button'
import {clone} from '../../lib/utils'
import type {CombatCatalog, Condition, Term} from './types'

import {conditionSentence} from './conditionSentence'

const rowNames = ['前排', '中排', '后排']
const operatorsFor = (condition: Condition) => [0, 1].map(index => ['and', 'or'].includes(condition.operators?.[index] ?? '') ? condition.operators![index] : condition.operation === 'any' ? 'or' : 'and')
function removeTerm(value: Condition, index: number): Condition {
 const rest = {...value}, terms = value.terms.filter((_, i) => i !== index)
 delete rest.operators; delete rest.grouping
 if (value.operation !== 'mixed') return {...rest, terms}
 const operators = operatorsFor(value)
 // Removing the middle term keeps the operator outside its original group.
 const remaining = operators[index === 0 ? 1 : index === 2 ? 0 : value.grouping === 'right' ? 0 : 1]
 return {...rest, terms, operation: remaining === 'or' ? 'any' : 'all'}
}
export function ConditionEditor({condition, catalog, capacity, onClose, onApply}: {condition: Condition; catalog: CombatCatalog; capacity?: number; onClose: () => void; onApply: (value: Condition) => void}) {
 const [draft, setDraft] = useState(() => clone(condition))
 const [search, setSearch] = useState('')
 const update = (index: number, patch: Partial<Term>) => setDraft(value => ({...value, terms: value.terms.map((term, i) => i === index ? {...term, ...patch} : term)}))
 const errors = draft.terms.flatMap((term, index) => {const definition = catalog.conditions.find(option => option.id === term.kind); return definition?.usesThreshold && (term.threshold === undefined || !Number.isFinite(term.threshold) || term.threshold < definition.minThreshold || term.threshold > definition.maxThreshold || definition.integerThreshold && !Number.isInteger(term.threshold)) ? [`第 ${index + 1} 项阈值须在 ${definition.minThreshold}–${definition.maxThreshold} 范围内${definition.integerThreshold ? '且为整数' : ''}。`] : []})
 if (draft.operation === 'mixed' && (draft.terms.length !== 3 || draft.operators?.length !== 2 || !draft.operators.every(op => ['and', 'or'].includes(op)) || !['left', 'right'].includes(draft.grouping ?? ''))) errors.push('混合条件需要三项、两个明确连接符与括号位置。')
 const mixed = (index: number, op: string) => setDraft(value => ({...value, operation: 'mixed', grouping: value.grouping === 'right' ? 'right' : 'left', operators: operatorsFor(value).map((value, i) => i === index ? op : value)}))
 const limit = Math.min(3, capacity ?? 0)
 return <Modal open onOpenChange={open => {if (!open) onClose()}} title="编辑条件组" description="每项都读取同一候选或施放者。括号明确决定求值顺序；条件数量上限来自核心预览。" className="condition-modal" footer={<><Button className="mr-auto" onClick={() => {const terms = [...draft.terms, {kind: 'always', threshold: 0, subject: 'target', value: ''}]; setDraft({...draft, terms, ...(terms.length === 3 ? {operation: 'mixed', operators: operatorsFor(draft), grouping: draft.grouping === 'right' ? 'right' : 'left'} : {})})}} disabled={draft.terms.length >= limit} title={capacity === undefined ? '等待核心校验返回条件容量' : `当前最多 ${limit} 项条件`}><Plus size={14} />添加条件</Button><Button onClick={onClose}>取消</Button><Button variant="default" disabled={!!errors.length || !draft.terms.length} onClick={() => {onApply(draft); onClose()}}>应用条件</Button></>}>
  <div className="condition-preview">{conditionSentence(draft, catalog)}</div>
  <label className="condition-search">筛选目录<input aria-label="搜索条件目录" value={search} onChange={e => setSearch(e.target.value)} placeholder="输入条件名称或 ID" /></label>
  {draft.terms.map((term, index) => {const option = catalog.conditions.find(option => option.id === term.kind); return <section className="condition-term" key={index} data-field={`condition.terms.${index}`}><header><strong>条件 {String.fromCharCode(65 + index)}</strong><select aria-label={`条件${index + 1}读取来源`} value={term.subject ?? ''} onChange={e => update(index, {subject: e.target.value})}>{term.subject === undefined && <option value="">目标 · 原字段缺省</option>}{catalog.subjects.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select><Button variant="ghost" size="icon" aria-label={`删除条件${index + 1}`} disabled={draft.terms.length <= 1} onClick={() => setDraft(value => removeTerm(value, index))}><Trash2 size={14} /></Button></header>
   <label>条件<select aria-label={`条件${index + 1}类型`} value={term.kind} onChange={e => {const definition = catalog.conditions.find(option => option.id === e.target.value); update(index, {kind: e.target.value, ...(definition?.usesThreshold ? {threshold: definition.defaultThreshold} : {}), ...(definition?.usesValue ? {value: definition.defaultValue} : {})})}}>{!option && <option value={term.kind}>{term.kind} · 未实现</option>}{[...new Set(catalog.conditions.map(option => option.category))].map(category => <optgroup key={category} label={category}>{catalog.conditions.filter(option => option.category === category && (option.id === term.kind || `${option.label} ${option.id}`.toLowerCase().includes(search.toLowerCase()))).map(option => <option key={option.id} value={option.id} title={option.description}>{option.label}</option>)}</optgroup>)}</select></label>
   {option && <p className="field-hint">{option.description}</p>}
   {option?.usesThreshold && <label>阈值{option.thresholdUnit === 'row' ? <select aria-label={`条件${index + 1}阈值`} value={term.threshold} onChange={e => update(index, {threshold: Number(e.target.value)})}>{rowNames.map((name, row) => <option key={row} value={row}>{name}</option>)}</select> : <div className="threshold-input"><input aria-label={`条件${index + 1}阈值`} type="number" step={option.integerThreshold ? 1 : 'any'} value={term.threshold === undefined ? '' : option.thresholdUnit === 'ratio' ? Number((term.threshold * 100).toFixed(8)) : term.threshold} onChange={e => {if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) update(index, {threshold: option.thresholdUnit === 'ratio' ? e.target.valueAsNumber / 100 : e.target.valueAsNumber})}} /><span>{option.thresholdUnit === 'ratio' ? '%' : option.thresholdUnit}</span></div>}</label>}
   {option?.usesValue && <label>{option.valueHint}{['has_status_kind', 'lacks_status_kind'].includes(term.kind) ? <select aria-label={`条件${index + 1}值`} value={term.value ?? ''} onChange={e => update(index, {value: e.target.value})}>{!catalog.statusKinds.some(option => option.id === term.value) && <option value={term.value ?? ''}>{term.value || '选择状态类别'}</option>}{catalog.statusKinds.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select> : <input aria-label={`条件${index + 1}值`} value={term.value ?? ''} onChange={e => update(index, {value: e.target.value})} />}</label>}
  </section>})}
  {draft.terms.length === 2 && <label className="combat-check">组合<select aria-label="两项条件组合" value={draft.operation} onChange={e => setDraft({...draft, operation: e.target.value})}><option value="all">且 · 全部满足</option><option value="any">或 · 任一满足</option></select></label>}
  {draft.terms.length === 3 && <div className="condition-operators">{[0, 1].map(index => <label key={index}>连接符 {index + 1}<select aria-label={`连接符${index + 1}`} value={draft.operators?.[index] || (draft.operation === 'any' ? 'or' : 'and')} onChange={e => mixed(index, e.target.value)}><option value="and">且 AND</option><option value="or">或 OR</option></select></label>)}<label>括号位置<select aria-label="括号位置" value={draft.grouping || 'left'} onChange={e => setDraft({...draft, operation: 'mixed', operators: operatorsFor(draft), grouping: e.target.value})}><option value="left">(A op B) op C</option><option value="right">A op (B op C)</option></select></label></div>}
  {errors.map(error => <p className="field-error" role="alert" key={error}>{error}</p>)}
 </Modal>
}
