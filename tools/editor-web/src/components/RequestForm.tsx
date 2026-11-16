import { useState } from 'react'
import { Plus } from 'lucide-react'
import { requestKinds, type RequestDraft, type RequestKind } from '../types'
import { Modal } from './ui/modal'
import { Button } from './ui/button'

const kindLabels: Record<RequestKind, string> = {note: '备注', new_item_property: '新物品能力', balance: '数值讨论', bug: '问题', new_effect: '新效果', new_condition: '新条件', new_selector: '新选择器', new_status: '新状态', new_building_function: '新建筑功能'}
const defaultOwner = (kind: RequestKind) => kind === 'balance' || kind === 'note' ? 'planning' : 'engineering'
interface Props { open: boolean; onClose: () => void; target: string; field: string; mandatory?: boolean; capability?: 'effect' | 'bonus'; onSubmit: (request: RequestDraft, capabilityId: string) => Promise<void> | void }
export function RequestForm({open, onClose, target, field, mandatory, capability, onSubmit}: Props) {
  const [kind, setKind] = useState<RequestKind>(mandatory ? 'new_item_property' : 'note')
  const [owner, setOwner] = useState(defaultOwner(kind))
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [expected, setExpected] = useState('')
  const [fieldValue, setField] = useState(field)
  const [capabilityId, setCapabilityId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    if (!title.trim() || (mandatory && !body.trim()) || (capability && !capabilityId.trim())) { setError('请填写标题、能力标识和需求说明。'); return }
    setBusy(true)
    const now = new Date()
    const createdAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    try { await onSubmit({kind, owner, target, title: title.trim(), body, expected, field: fieldValue, createdAt, status: 'open'}, capabilityId.trim()); onClose() }
    catch (error) { setError(error instanceof Error ? error.message : '需求创建失败') }
    finally {setBusy(false)}
  }
  return <Modal open={open} onOpenChange={value => {if (!value && !busy) onClose()}} title={mandatory ? '登记待实现能力' : '新建备注与需求'} description={mandatory ? '该能力尚未接入。填写需求后，物品将保存为草稿，无法导出或试跑。' : '记录会随内容保存，不会自动派发或变更分拣状态。'} footer={<><Button onClick={onClose} disabled={busy}>取消</Button><Button variant="default" onClick={() => void submit()} disabled={busy}><Plus size={14} />{mandatory ? '附需求并添加能力' : '添加记录'}</Button></>}>
    <form className="request-form" onSubmit={event => {event.preventDefault(); void submit()}}>
      <div className="request-target mono">{target}{field && <span> / {field}</span>}</div>
      {capability && <label>能力标识 <span className="required">*</span><input autoFocus value={capabilityId} onChange={e => setCapabilityId(e.target.value)} aria-label="能力标识" placeholder={capability === 'effect' ? '例如 restore_hunger' : '例如 defense_bonus'} /><small>仅登记标识，不会产生运行时效果。</small></label>}
      <div className="form-grid"><label>类型<select value={kind} onChange={e => {const value = e.target.value as RequestKind; setKind(value); setOwner(defaultOwner(value))}} aria-label="需求类型">{requestKinds.filter(value => !mandatory || value !== 'note').map(value => <option key={value} value={value}>{kindLabels[value]}</option>)}</select></label><label>归属<select aria-label="需求归属" value={owner} onChange={e => setOwner(e.target.value)}>{['engineering', 'planning', 'combat', 'base', 'art', 'world'].map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
      <label>标题 <span className="required">*</span><input autoFocus={!capability} aria-label="需求标题" value={title} onChange={e => setTitle(e.target.value)} placeholder="用一句话说明要解决的事" /></label>
      <label>需求说明{mandatory && <span className="required"> *</span>}<textarea aria-label="需求说明" rows={3} value={body} onChange={e => setBody(e.target.value)} /></label>
      <label>预期结果<textarea aria-label="预期结果" rows={2} value={expected} onChange={e => setExpected(e.target.value)} /></label>
      <label>字段<input className="mono" aria-label="需求字段" value={fieldValue} onChange={e => setField(e.target.value)} /></label>
      {error && <p role="alert" className="field-error">{error}</p>}
      <button type="submit" hidden />
    </form>
  </Modal>
}
