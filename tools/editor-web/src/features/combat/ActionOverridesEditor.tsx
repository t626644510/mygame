import {useEffect, useState} from 'react'
import {useEditorStore} from '../../store'
import {combatApi, errorsFrom} from './api'
import {actionFields, actionValue} from './actionFields'
import {skillSentence} from './skillSentence'
import {useCombatStore, visibleEntities, sessionDirty} from './store'
import type {ActionField, ActionOverride, Assembly, Encounter, ResolvedAction, Trial} from './types'

export function ResolvedActions({actions}: {actions: ResolvedAction[]}) {
 return <details className="resolved-actions"><summary>本场实际技能与来源 <span className="mono">{actions.length}</span></summary>{actions.map(action => <article key={`${action.encounterIndex}:${action.actionId}`}><strong>{action.effective.displayName} <code>{action.actionId}</code></strong><small>第 {action.encounterIndex} 场 · {action.sourceName}</small><dl><dt>共享基础量</dt><dd>{actionValue(action.shared.magnitude)}</dd><dt>本场覆盖</dt><dd>{action.local.remove.includes('magnitude') ? '省略Runtime字段' : Object.hasOwn(action.local.fields, 'magnitude') ? actionValue(action.local.fields.magnitude) : '继承共享'}</dd><dt>实际基础量</dt><dd>{actionValue(action.effective.magnitude)}</dd></dl><p>{skillSentence(action.effective)}</p></article>)}</details>
}
export function ActionOverridesEditor({encounter, onChange}: {encounter: Encounter; onChange: (overrides: ActionOverride[]) => void}) {
 const state = useCombatStore(), [context, setContext] = useState(''), [selected, setSelected] = useState(''), [assembly, setAssembly] = useState<Assembly | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false)
 const contexts = visibleEntities<Trial>('trial').flatMap(trial => trial.encounters.flatMap((entry, index) => entry.encounterId === encounter.id ? [{trial, index: index + 1}] : []))
 const contextKey = contexts.some(c => `${c.trial.id}:${c.index}` === context) ? context : contexts.length === 1 ? `${contexts[0].trial.id}:${contexts[0].index}` : ''
 const chosen = contexts.find(c => `${c.trial.id}:${c.index}` === contextKey)
 const chosenTrial = chosen?.trial
 const online = useEditorStore(s => s.online)
 const revisionKey = Object.values(state.sessions).filter(sessionDirty).map(s => `${s.type}:${s.entity.id}:${s.revision}`).join('|')
 useEffect(() => {
  if (!chosenTrial || !online) {setAssembly(null); return}
  let active = true; setLoading(true); setError('')
  const timer = setTimeout(() => {void combatApi.assemble(useCombatStore.getState().assemblyBody(chosenTrial)).then(value => {if (active) setAssembly(value)}).catch(error => {if (active) setError(errorsFrom(error).map(e => e.message).join('\n') || (error instanceof Error ? error.message : '本场实际技能解析失败'))}).finally(() => {if (active) setLoading(false)})}, 300)
  return () => {active = false; clearTimeout(timer)}
 }, [chosenTrial, contextKey, revisionKey, online])
 const actions = assembly?.resolvedActions.filter(action => action.encounterId === encounter.id && action.encounterIndex === chosen?.index) || []
 const action = actions.find(action => action.actionId === selected) || actions.find(action => encounter.actionOverrides?.some(local => local.actionId === action.actionId)) || actions[0]
 const local = encounter.actionOverrides?.find(local => local.actionId === action?.actionId)
 const change = (field: ActionField, mode: string, value?: string | number | boolean) => {
  if (!action) return
  const fields = {...local?.fields}, remove = [...(local?.remove || [])].filter(key => key !== field)
  delete fields[field]
  if (mode === 'set') Object.assign(fields, {[field]: value})
  else if (mode === 'remove') remove.push(field)
  const others = (encounter.actionOverrides || []).filter(local => local.actionId !== action.actionId)
  onChange(Object.keys(fields).length || remove.length ? [...others, {actionId: action.actionId, fields, remove}] : others)
 }
 return <details className="combat-card action-overrides" open={!!encounter.actionOverrides?.length}><summary><strong>本场技能覆盖</strong> <span className="badge">独立于共享技能</span></summary><p className="field-hint">共享定义影响所有继承者；本场固定值只影响此遭遇。继承共享与省略 Runtime 字段是两种操作，原来源不会把已删除的本场固定值复活。</p><label>解析来源<select aria-label="技能覆盖场次来源" value={contextKey} onChange={e => setContext(e.target.value)}>{contexts.length !== 1 && <option value="">请选择引用此遭遇的试炼与场次</option>}{contexts.map(c => <option value={`${c.trial.id}:${c.index}`} key={`${c.trial.id}:${c.index}`}>{c.trial.title} · 第 {c.index} 场</option>)}</select></label>{loading && <p className="field-hint">正在读取该场实际值…</p>}{error && <p className="field-error" role="alert">{error}</p>}{action ? <><label>技能<select aria-label="本场覆盖技能" value={action.actionId} onChange={e => setSelected(e.target.value)}>{actions.map(action => <option key={action.actionId} value={action.actionId}>{action.effective.displayName} · {action.actionId}</option>)}</select></label><p className="field-hint">第 {action.encounterIndex} 场 · {action.sourceName} · 原运行ID {action.actionId} 保留</p><table className="action-override-table" data-testid={`action-resolution-${action.actionId}`}><thead><tr><th>字段</th><th>{error ? '上次共享快照' : '共享值'}</th><th>本场操作 / 值</th><th>实际值{loading ? '（更新中）' : ''}</th></tr></thead><tbody>{actionFields.map(field => {const mode = local?.remove.includes(field.id) ? 'remove' : local && Object.hasOwn(local.fields, field.id) ? 'set' : 'inherit', value = local?.fields[field.id]; return <tr key={field.id} data-action-field={field.id}><th>{field.label}<code>{field.id}</code></th><td data-value="shared">{actionValue(action.shared[field.id])}</td><td><select aria-label={`${field.id}本场操作`} value={mode} onChange={e => {const raw = action.effective[field.id]; change(field.id, e.target.value, raw === undefined ? field.kind === 'number' ? 0 : field.kind === 'boolean' ? false : '' : raw)}}><option value="inherit">继承当前共享</option><option value="set">固定本场值</option><option value="remove">省略Runtime字段</option></select>{mode === 'set' && (field.kind === 'boolean' ? <select aria-label={`${field.id}本场值`} value={String(value)} onChange={e => change(field.id, 'set', e.target.value === 'true')}><option value="true">true</option><option value="false">false</option></select> : <input aria-label={`${field.id}本场值`} type={field.kind === 'number' ? 'number' : 'text'} step="any" value={typeof value === 'number' || typeof value === 'string' ? value : ''} onChange={e => {if (field.kind === 'number') {if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) change(field.id, 'set', e.target.valueAsNumber)} else change(field.id, 'set', e.target.value)}} />)}</td><td data-value="effective">{loading ? '…' : error ? '当前解析失败' : actionValue(action.effective[field.id])}</td></tr>})}</tbody></table><p className="field-hint">修改普通技能页是共享编辑；这里仅改变当前遭遇的typed覆盖。非等价外来导入仍会拒绝。</p><p className="skill-sentence">{loading ? '等待核心解析本场技能读法…' : error ? '当前配置未获核心有效解析，不把旧快照当作本次实际值。' : skillSentence(action.effective)}</p></> : !loading && <p className="field-hint">绑定试炼并选择来源后显示服务端实际技能；不在前端猜测合并结果。</p>}</details>
}
