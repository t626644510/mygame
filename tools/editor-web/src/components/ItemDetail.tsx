import { useEffect, useState, type ReactNode } from 'react'
import { Check, Copy, LockKeyhole, Plus, Save, Trash2, X } from 'lucide-react'
import { api, ApiError } from '../api'
import { useEditorStore, isDirty } from '../store'
import { categories, categoryLabels, categoryPrefixes, needsCapability, type Category, type Item, type Reference } from '../types'
import { copyText } from '../lib/utils'
import { Button } from './ui/button'
import { Modal } from './ui/modal'
import { Field } from './Field'

interface Props { onClose: () => void; onSave: () => void; onDelete: () => void; onRequest: (field: string, capability?: 'effect' | 'bonus') => void }
function ReferenceList({refs}: {refs: Reference[]}) {
  const notify = useEditorStore(state => state.notify)
  const groups = new Map<string, Reference[]>()
  refs.forEach(ref => {const key = `${ref.sourceType}: ${ref.sourceId}`; groups.set(key, [...(groups.get(key) || []), ref])})
  return <div className="refs-list">{Array.from(groups).map(([group, records]) => <div key={group} className="ref-group"><strong>{group}</strong>{records.map((ref, index) => <div key={`${ref.path}-${ref.jsonPointer}-${index}`}><div className="flex items-center gap-1">{ref.legacy && <span className="badge legacy">旧配置 · 只读</span>}<span className="mono text-xs">{ref.quantity !== null ? `×${ref.quantity}` : '数量未知'}</span><button type="button" title="复制引用路径" aria-label={`复制 ${ref.path}`} className="icon-inline" onClick={() => {void copyText(`${ref.path}${ref.jsonPointer}`).then(() => notify('已复制引用路径')).catch(() => notify('浏览器未允许复制'))}}><Copy size={12} /></button></div><code title={`${ref.path}#${ref.jsonPointer}`}>{ref.path}#{ref.jsonPointer}</code></div>)}</div>)}</div>
}
export function ItemDetail({onClose, onSave, onDelete, onRequest}: Props) {
  const {current, edit, errors, catalog, references, requests, online, saving, notify} = useEditorStore()
  const [tab, setTab] = useState<'details' | 'notes'>('details')
  const [tag, setTag] = useState('')
  const [aliasText, setAliasText] = useState('')
  const [typeConfirm, setTypeConfirm] = useState<Category | null>(null)
  const [idState, setIdState] = useState<{state: string; message: string}>({state: '', message: ''})
  const item = current?.item
  const id = item?.id
  useEffect(() => {setTab('details'); setTag('')}, [current?.base.id])
  useEffect(() => {setAliasText(current?.base.aliases.join(', ') || '')}, [current?.base])
  useEffect(() => {
    if (!current?.isNew || !id) {setIdState({state: '', message: ''}); return}
    if (!/^[a-z][a-z0-9_]*$/.test(id)) {setIdState({state: 'error', message: 'ID must match ^[a-z][a-z0-9_]*$.'}); return}
    let cancelled = false
    setIdState({state: 'checking', message: '检查 ID…'})
    const timeout = window.setTimeout(() => {
      void api.ids(id).then(result => {if (!cancelled) setIdState(result.exists ? {state: 'error', message: result.viaAlias ? `ID 与 ${result.canonicalId} 的别名重复。` : `ID 已被 ${result.canonicalId} 使用。`} : {state: 'ok', message: 'ID 可用'})}).catch(() => {if (!cancelled) setIdState({state: '', message: '连接恢复后会重新检查 ID'})})
    }, 250)
    return () => {cancelled = true; clearTimeout(timeout)}
  }, [current?.isNew, id, online])
  useEffect(() => {
    if (!current || !online) return
    let cancelled = false
    const timer = setTimeout(() => {
      void api.validateItem(current.item, current.isNew ? 'create' : 'update', current.pendingRequests).then(result => {if (!cancelled) useEditorStore.setState({errors: result.errors})}).catch(error => {if (!cancelled && error instanceof ApiError && error.body.errors) useEditorStore.setState({errors: error.body.errors})})
    }, 300)
    return () => {cancelled = true; clearTimeout(timer)}
  }, [current, online])
  if (!current || !item) return null
  const refs = references[item.id] || []
  const itemRequests = requests.filter(request => request.target === `item:${item.id}` || item.aliases.some(alias => request.target === `item:${alias}`))
  const noteCount = itemRequests.length + current.pendingRequests.length
  const applyType = (category: Category) => edit(value => {
    const oldPrefix = categoryPrefixes[value.category]
    if (current.isNew && value.id.startsWith(oldPrefix)) value.id = categoryPrefixes[category] + value.id.slice(oldPrefix.length)
    value.category = category
    value.equipment = {slot: category === 'equipment' ? 'weapon' : '', combatBonus: [], enhancement: []}
    value.consumable = {effects: []}
    if (category === 'equipment') value.stackLimit = 1
  })
  const changeType = (category: Category) => {
    if (item.equipment.combatBonus.length || item.equipment.enhancement.length || item.consumable.effects.length) setTypeConfirm(category)
    else applyType(category)
  }
  const update = <K extends keyof Item,>(key: K, value: Item[K]) => edit(item => {item[key] = value})
  const field = (name: string, label: string, children: ReactNode, hint?: string) => <Field name={name} label={label} errors={errors} onNote={name => onRequest(name)} hint={hint}>{children}</Field>
  const extensionErrors = (prefix: string) => errors.filter(error => error.field?.startsWith(prefix)).map((error, i) => <p key={`${error.field}-${i}`} className="field-error" role="alert">{error.message}</p>)
  const categoryControl = field('category', '类型', <select autoFocus={current.isNew} id="field-category" value={item.category} onChange={e => changeType(e.target.value as Category)}>{categories.map(value => <option value={value} key={value}>{categoryLabels[value]}</option>)}</select>)
  return <aside className="detail-panel" aria-label="物品详情" data-testid="item-detail">
    <header className="detail-header"><div className="min-w-0"><div className="panel-title">{current.isNew ? '新建物品' : '物品详情'}{isDirty(current) && <span className="dirty-dot" title="未保存" />}</div><h2 className="truncate">{item.name || '未命名物品'}</h2></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭物品详情"><X size={17} /></Button></header>
    <div className="detail-tabs" role="tablist" aria-label="详情标签"><button role="tab" aria-selected={tab === 'details'} className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}>基本信息</button><button role="tab" aria-selected={tab === 'notes'} className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>备注 <span className="mono">({noteCount})</span></button></div>
    <div className="detail-scroll">
      {tab === 'details' ? <form onSubmit={e => {e.preventDefault(); onSave()}} className="detail-form"><fieldset className="editable-fields" disabled={saving}>
        {item.draft && <div className="pending-note"><span className="badge pending">待实现 · 草稿</span><p>此物品不会进入导出与试跑。需求完成后再确认运行时能力。</p></div>}
        {current.isNew && categoryControl}
        {field('id', 'ID', <div className="input-icon" title={current.isNew ? undefined : 'ID 已锁定，如需更改请联系工程（迁移功能后续提供）'}><input id="field-id" className="mono" value={item.id} readOnly={!current.isNew} aria-invalid={idState.state === 'error'} onChange={e => update('id', e.target.value)} />{!current.isNew && <LockKeyhole size={14} />}</div>, current.isNew ? undefined : '首次保存后锁定，改名请修改显示名称。')}
        {current.isNew && idState.message && <p className={`id-state ${idState.state === 'error' ? 'field-error' : idState.state === 'ok' ? 'text-success' : 'text-muted-foreground'}`} role="status">{idState.state === 'ok' && <Check size={12} />}{idState.message}</p>}
        {field('name', '名称', <input id="field-name" value={item.name} onChange={e => update('name', e.target.value)} placeholder="物品的显示名称" />)}
        {!current.isNew && categoryControl}
        {field('description', '描述', <textarea id="field-description" rows={3} value={item.description} onChange={e => update('description', e.target.value)} />, item.id === 'expedition_ore' || item.id === 'eq_patrol_sword' ? '参考价为占位值，尚待确认。' : undefined)}
        <div className="form-grid">{field('stackLimit', '堆叠上限', <input id="field-stackLimit" className="mono" type="number" min={1} step={1} readOnly={item.category === 'equipment'} value={item.stackLimit} onChange={e => update('stackLimit', Number(e.target.value))} />)}{field('baseValue', '参考价', <input id="field-baseValue" className="mono" type="number" min={0} step={1} value={item.baseValue} onChange={e => update('baseValue', Number(e.target.value))} />)}</div>
        {field('aliases', '旧 ID 别名', <input id="field-aliases" className="mono" value={aliasText} onChange={e => {setAliasText(e.target.value); update('aliases', e.target.value.split(',').map(value => value.trim()).filter(Boolean))}} placeholder="多个别名用英文逗号分隔" />, '兼容旧配置；别名与所有定义 ID 全局唯一。')}
        {field('tags', '标签', <div className="tag-editor">{item.tags.map((value, index) => <span className="tag" key={`${value}-${index}`}>{value}<button type="button" aria-label={`移除标签 ${value}`} onClick={() => update('tags', item.tags.filter((_, i) => i !== index))}><X size={10} /></button></span>)}<input id="field-tags" value={tag} placeholder="输入标签后按回车" onChange={e => setTag(e.target.value)} onKeyDown={e => {if (e.key === 'Enter') {e.preventDefault(); if (tag.trim() && !item.tags.includes(tag.trim())) update('tags', [...item.tags, tag.trim()]); setTag('')}}} /></div>)}
        {field('icon', '图标路径', <input id="field-icon" className="mono" placeholder="可留空" value={item.icon} onChange={e => update('icon', e.target.value)} />)}
        {item.category === 'equipment' && <>
          <div className="section-heading"><h3>装备定义</h3><span className="text-xs text-muted-foreground">不是装备实例</span></div>
          {field('equipment.slot', '槽位', <select id="field-equipment.slot" value={item.equipment.slot} onChange={e => edit(item => {item.equipment.slot = e.target.value})}><option value="weapon">武器</option><option value="armor">护甲</option><option value="accessory">饰品</option></select>)}
          <div className="section-heading"><h3>战斗加成</h3><Button size="sm" variant="ghost" aria-label="添加战斗加成" onClick={() => edit(item => {item.equipment.combatBonus.push({id: catalog?.combatBonusFields[0]?.id || 'equipmentDamageBonus', value: 0})})}><Plus size={13} />添加</Button></div>
          {!item.equipment.combatBonus.length && <p className="field-hint">尚无加成，仅可使用已接入的运行时字段。</p>}
          {item.equipment.combatBonus.map((bonus, index) => <div className="bonus-row" key={index} data-field={`equipment.combatBonus.${index}`}><select aria-label={`战斗加成字段 ${index + 1}`} value={catalog?.combatBonusFields.some(f => f.id === bonus.id) ? bonus.id : '__other'} onChange={e => {if (e.target.value === '__other') onRequest(`equipment.combatBonus.${index}`, 'bonus'); else edit(item => {item.equipment.combatBonus[index].id = e.target.value})}}>{catalog?.combatBonusFields.map(field => <option key={field.id} value={field.id}>{field.label}</option>)}<option value="__other">其他（未实现）</option></select><input aria-label={`战斗加成值 ${index + 1}`} className="mono" type="number" value={bonus.value} onChange={e => edit(item => {item.equipment.combatBonus[index].value = Number(e.target.value)})} /><Button size="icon" variant="ghost" aria-label={`删除战斗加成 ${index + 1}`} onClick={() => edit(item => {item.equipment.combatBonus.splice(index, 1)})}><X size={13} /></Button>{needsCapability({...item, consumable: {effects: []}, equipment: {...item.equipment, combatBonus: [bonus]}}, catalog) && <span className="badge pending col-span-full">{bonus.id} · 待实现</span>}<div className="col-span-full">{extensionErrors(`/equipment/combatBonus/${index}`)}</div></div>)}
          <div className="section-heading"><h3>强化表</h3><Button size="sm" variant="ghost" onClick={() => edit(item => {item.equipment.enhancement.push({level: item.equipment.enhancement.length + 1, cash: 0, attackBonusDelta: 0, materials: []})})}><Plus size={13} />添加等级</Button></div>
          <p className="field-hint">强化消耗与增量为可替换测试参数，不代表永久物品属性。</p>
          {item.equipment.enhancement.map((level, index) => <fieldset key={index} className="enhancement" data-field={`equipment.enhancement.${index}`}><legend>等级 {level.level}</legend><Button size="icon" variant="ghost" className="enhancement-remove" aria-label={`删除强化等级 ${level.level}`} onClick={() => edit(item => {item.equipment.enhancement.splice(index, 1); item.equipment.enhancement.forEach((entry, i) => {entry.level = i + 1})})}><X size={12} /></Button><div className="form-grid"><label>现金<input aria-label={`强化 ${level.level} 现金`} className="mono" type="number" min={0} value={level.cash} onChange={e => edit(item => {item.equipment.enhancement[index].cash = Number(e.target.value)})} /></label><label>攻击增量<input aria-label={`强化 ${level.level} 攻击增量`} className="mono" type="number" value={level.attackBonusDelta} onChange={e => edit(item => {item.equipment.enhancement[index].attackBonusDelta = Number(e.target.value)})} /></label></div><div className="section-heading"><span className="text-xs">消耗材料</span><Button size="sm" variant="ghost" onClick={() => edit(item => {item.equipment.enhancement[index].materials.push({itemId: '', quantity: 1})})}><Plus size={12} />材料</Button></div>{level.materials.map((material, mi) => <div className="material-row" key={mi}><input className="mono" aria-label={`强化 ${level.level} 材料 ${mi + 1}`} list="material-options" placeholder="搜索 ID / 别名" value={material.itemId} onChange={e => edit(item => {item.equipment.enhancement[index].materials[mi].itemId = e.target.value})} /><input aria-label={`强化 ${level.level} 数量 ${mi + 1}`} className="mono" type="number" min={1} step={1} value={material.quantity} onChange={e => edit(item => {item.equipment.enhancement[index].materials[mi].quantity = Number(e.target.value)})} /><Button size="icon" variant="ghost" aria-label={`删除材料 ${mi + 1}`} onClick={() => edit(item => {item.equipment.enhancement[index].materials.splice(mi, 1)})}><X size={12} /></Button></div>)}{extensionErrors(`/equipment/enhancement/${index}`)}</fieldset>)}
          <MaterialOptions />
        </>}
        {item.category === 'consumable' && <><div className="section-heading"><h3>效果</h3><Button variant="ghost" size="sm" onClick={() => onRequest('consumable.effects', 'effect')} data-testid="add-effect"><Plus size={13} />添加效果</Button></div><p className="field-hint">P1 尚无已实现效果。添加效果必须附需求，并转为草稿。</p>{item.consumable.effects.map((effect, index) => <div className="effect-entry" key={index} data-field={`consumable.effects.${index}`}><div className="flex items-center justify-between gap-2"><span className="badge pending">{effect.kind} · 待实现</span><Button variant="ghost" size="icon" aria-label={`删除效果 ${effect.kind}`} onClick={() => edit(item => {item.consumable.effects.splice(index, 1)})}><Trash2 size={13} /></Button></div><textarea aria-label={`效果 ${effect.kind} 说明`} placeholder="效果备注" rows={2} value={effect.note} onChange={e => edit(item => {item.consumable.effects[index].note = e.target.value})} /></div>)}</>}
        <div className="section-heading"><h3>导出状态</h3></div><label className="checkbox-row"><input type="checkbox" checked={item.draft} disabled={needsCapability(item, catalog)} onChange={e => update('draft', e.target.checked)} />保存为草稿</label><p className="field-hint">草稿不会进入运行时 JSON。未实现能力必须保持草稿。</p>
        <div className="section-heading"><h3>被引用 <span className="mono">{refs.length}</span> 处</h3></div>{refs.length ? <ReferenceList refs={refs} /> : <p className="field-hint">尚无引用。</p>}
        <button type="submit" hidden />
      </fieldset></form> : <div className="notes-panel"><Button disabled={saving} onClick={() => onRequest('')}><Plus size={14} />新建备注 / 需求</Button>{!noteCount && <p className="field-hint">为此物品记录说明，或登记需要实现的能力。</p>}{current.pendingRequests.map((request, index) => <article className="request-entry" key={index}><span className="badge">随物品保存</span><h3>{request.title}</h3><p>{request.body}</p><code>{request.field}</code></article>)}{itemRequests.map(request => <article className="request-entry" key={request.id}><div className="flex gap-2 items-center"><code>{request.id}</code><span className="badge">{request.status}</span><span className="text-xs text-muted-foreground">{request.owner}</span></div><h3>{request.title}</h3><p>{request.body}</p>{request.expected && <p>预期：{request.expected}</p>}<code>{request.field}</code></article>)}</div>}
    </div>
    <footer className="detail-footer"><div title={refs.length ? `被 ${refs.length} 处引用` : '删除物品'}><Button variant="danger" size="icon" disabled={!!refs.length || current.isNew || !online} onClick={onDelete} aria-label="删除物品"><Trash2 size={15} /></Button></div><span className="save-status">{saving ? '保存中…' : isDirty(current) ? '未保存修改' : '已保存'}{current.pendingRequests.length > 0 && <small>含 {current.pendingRequests.length} 条需求</small>}</span><Button variant="default" onClick={onSave} disabled={!online || saving || (current.isNew && idState.state === 'error')} data-testid="save-item"><Save size={14} />保存 <kbd>Ctrl S</kbd></Button></footer>
    <Modal open={!!typeConfirm} onOpenChange={value => {if (!value) setTypeConfirm(null)}} title="切换物品类型" description="切换后会清空当前装备或消耗品扩展数据。" footer={<><Button onClick={() => setTypeConfirm(null)}>取消</Button><Button variant="default" onClick={() => {if (typeConfirm) applyType(typeConfirm); setTypeConfirm(null); notify('已清空类型扩展，请保存确认')}}>切换并清空</Button></>}><p>基础字段将保留，强化表、战斗加成与消耗品效果会清空。</p></Modal>
  </aside>
}
function MaterialOptions() {
  const items = useEditorStore(state => state.items)
  return <datalist id="material-options">{items.flatMap(item => [<option value={item.id} key={item.id}>{item.name}</option>, ...item.aliases.map(alias => <option key={alias} value={alias}>{item.name} · {item.id}</option>)])}</datalist>
}
