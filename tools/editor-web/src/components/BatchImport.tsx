import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { api, ApiError } from '../api'
import { copyText } from '../lib/utils'
import { categories, categoryLabels, emptyItem, type Item } from '../types'
import { useEditorStore } from '../store'
import { Button } from './ui/button'
import { Modal } from './ui/modal'

const fields = ['id', 'name', 'category', 'stackLimit', 'baseValue', 'tags'] as const
type ImportField = typeof fields[number]
const labels: Record<ImportField, string> = {id: 'ID', name: '名称', category: '类型', stackLimit: '堆叠', baseValue: '参考价', tags: '标签'}
const aliases: Record<ImportField, string[]> = {id: ['id', '物品id'], name: ['name', '名称', '物品名称'], category: ['category', 'type', '类型'], stackLimit: ['stacklimit', '堆叠', '堆叠上限'], baseValue: ['basevalue', '参考价', '价格'], tags: ['tags', '标签']}
type Mapping = Record<ImportField, number>
interface Parsed { rows: string[][]; error: string }
interface ImportRow { readonly item: Item; readonly row: readonly string[]; readonly line: number; readonly errors: readonly string[] }
interface BatchSnapshot { readonly header: readonly string[]; readonly rows: readonly ImportRow[] }
// CSV/TSV parser keeps quoted separators, escaped quotes and embedded newlines.
function parse(text: string): Parsed {
  const separator = text.split(/\r?\n/)[0]?.includes('\t') ? '\t' : ','
  const rows: string[][] = []; let row: string[] = []; let value = ''; let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {value += '"'; i++} else quoted = !quoted
    } else if (!quoted && char === separator) {row.push(value); value = ''}
    else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(value); if (row.some(cell => cell.trim())) rows.push(row); row = []; value = ''
    } else value += char
  }
  row.push(value); if (row.some(cell => cell.trim())) rows.push(row)
  return {rows, error: quoted ? '引号未闭合，请检查 CSV 内容。' : ''}
}
function autoMap(header: string[]): Mapping {
  return Object.fromEntries(fields.map(field => [field, header.findIndex(value => aliases[field].includes(value.trim().toLocaleLowerCase().replaceAll(' ', '')))])) as Mapping
}
interface Props { onClose: () => void }
export function BatchImport({onClose}: Props) {
  const {online, load, notify} = useEditorStore()
  const [text, setText] = useState('')
  const parsed = useMemo(() => parse(text), [text])
  const [mapping, setMapping] = useState<Mapping>(autoMap([]))
  const [checked, setChecked] = useState<Record<string, string>>({})
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Record<number, string>>({})
  const [summary, setSummary] = useState('')
  const [batch, setBatch] = useState<BatchSnapshot | null>(null)
  const previewContainer = useRef<HTMLDivElement>(null)
  const changeText = (value: string) => {
    if (busy) return
    setText(value); setMapping(autoMap(parse(value).rows[0] || [])); setBatch(null); setResults({}); setSummary(''); setChecked({}); setChecking(true)
  }
  const preview = useMemo(() => {
    const seen = new Set<string>()
    return parsed.rows.slice(1).map((row, index) => {
      const get = (field: ImportField) => row[mapping[field]]?.trim() || ''
      const rawType = get('category')
      const category = categories.find(category => category === rawType || categoryLabels[category] === rawType)
      const item = emptyItem(category || 'material'); const errors: string[] = []
      item.id = get('id'); item.name = get('name')
      item.stackLimit = get('stackLimit') ? Number(get('stackLimit')) : category === 'equipment' ? 1 : 99
      item.baseValue = get('baseValue') ? Number(get('baseValue')) : 0
      item.tags = get('tags').split(/[;；|]/).map(value => value.trim()).filter(Boolean)
      if (!/^[a-z][a-z0-9_]*$/.test(item.id)) errors.push('ID 格式不合规')
      if (seen.has(item.id)) errors.push('ID 与本次粘贴的其他行重复')
      seen.add(item.id)
      if (!item.name) errors.push('名称不能为空')
      if (!category) errors.push(`类型非法：${rawType || '未填写'}`)
      if (!Number.isInteger(item.stackLimit) || item.stackLimit < 1) errors.push('堆叠必须为 ≥ 1 的整数')
      if (category === 'equipment' && item.stackLimit !== 1) errors.push('装备堆叠必须为 1')
      if (!Number.isInteger(item.baseValue) || item.baseValue < 0) errors.push('参考价必须为 ≥ 0 的整数')
      return {item, row, line: index + 2, errors}
    })
  }, [parsed, mapping])
  useEffect(() => {
    if (!online || !preview.length) {setChecking(false); return}
    let cancelled = false
    setChecking(true); setChecked({})
    const timeout = setTimeout(() => {
      const ids = [...new Set(preview.map(row => row.item.id).filter(id => /^[a-z][a-z0-9_]*$/.test(id)))]
      void Promise.all(ids.map(async id => {
        try {const result = await api.ids(id); return [id, result.exists ? (result.viaAlias ? `ID 与 ${result.canonicalId} 的别名冲突` : `ID 已存在：${result.canonicalId}`) : '']}
        catch {return [id, 'ID 检查未完成，请恢复连接后重试']}
      })).then(values => {if (!cancelled) {setChecked(Object.fromEntries(values)); setChecking(false)}})
    }, 300)
    return () => {cancelled = true; clearTimeout(timeout)}
  }, [preview, online])
  const errorsFor = (row: ImportRow) => [...row.errors, ...(checked[row.item.id] ? [checked[row.item.id]] : [])]
  const valid = preview.filter(row => !errorsFor(row).length)
  const allIdsChecked = preview.every(row => !/^[a-z][a-z0-9_]*$/.test(row.item.id) || Object.hasOwn(checked, row.item.id))
  const displayed = batch?.rows || preview
  const displayedErrors = (row: ImportRow) => batch ? row.errors : errorsFor(row)
  useEffect(() => {
    if (!batch || !summary) return
    const first = batch.rows.find(row => results[row.line] !== '已导入')
    if (!first) return
    const frame = requestAnimationFrame(() => previewContainer.current?.querySelector(`[data-line="${first.line}"]`)?.scrollIntoView({block: 'nearest'}))
    return () => cancelAnimationFrame(frame)
  }, [batch, summary, results])
  const importRows = async () => {
    if (busy || checking || !online || !allIdsChecked) return
    const snapshot: BatchSnapshot = Object.freeze({header: Object.freeze([...(parsed.rows[0] || [])]), rows: Object.freeze(preview.map(row => Object.freeze({item: structuredClone(row.item), row: Object.freeze([...row.row]), line: row.line, errors: Object.freeze(errorsFor(row))})))})
    setBatch(snapshot)
    setBusy(true); let imported = 0; let skipped = 0
    const next: Record<number, string> = {}
    for (const row of snapshot.rows) {
      if (row.errors.length) {next[row.line] = row.errors.join('；'); skipped++; continue}
      try {await api.save(row.item, '', true); next[row.line] = '已导入'; imported++}
      catch (error) {next[row.line] = error instanceof ApiError ? error.body.errors?.map(error => error.message).join('；') || error.message : error instanceof Error ? error.message : '导入失败'; skipped++}
    }
    setResults(next); setSummary(`已导入 ${imported} 条，跳过 ${skipped} 条`); setBusy(false)
    await load()
  }
  const skippedRows = displayed.filter(row => results[row.line] ? results[row.line] !== '已导入' : displayedErrors(row).length > 0)
  const copySkipped = async () => {
    const escape = (value: string) => /[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
    await copyText([batch?.header || parsed.rows[0] || [], ...skippedRows.map(row => row.row)].map(row => row.map(escape).join('\t')).join('\n'))
    notify('已复制跳过的行，含表头')
  }
  return <Modal open onOpenChange={value => {if (!value && !busy) onClose()}} title="从表格粘贴物品" description="第一行为表头。支持 TSV / CSV；只创建新 ID，不覆盖任何已有物品。" className="batch-modal" footer={<><span className="mr-auto text-xs text-muted-foreground">{summary || (checking ? '正在检查全局 ID…' : `${valid.length} 行可导入 · ${preview.length - valid.length} 行需修改`)}</span>{skippedRows.length > 0 && <Button disabled={busy} onClick={() => {void copySkipped().catch(() => notify('浏览器未允许复制'))}}><Copy size={13} />复制错误行</Button>}<Button onClick={onClose} disabled={busy}>关闭</Button><Button variant="default" disabled={busy || checking || !allIdsChecked || !online || !!parsed.error || valid.length === 0 || !!summary} onClick={() => void importRows()} data-testid="import-valid">{busy ? '导入中…' : `导入合格行 (${valid.length})`}</Button></>}>
    <label className="block text-xs">粘贴内容<textarea aria-label="粘贴表格内容" className="mono mt-1" rows={5} value={text} disabled={busy} onChange={e => changeText(e.target.value)} placeholder={'ID\t名称\t类型\t堆叠\t参考价\t标签\nmat_example\t示例材料\tmaterial\t99\t0\t测试'} /></label>
    {parsed.error && <p role="alert" className="field-error">{parsed.error}</p>}
    {preview.length > 0 && <><div className="column-mapping">{fields.map(field => <label key={field}>{labels[field]}<select aria-label={`匹配${labels[field]}列`} value={mapping[field]} disabled={busy} onChange={e => {if (busy) return; setBatch(null); setChecked({}); setChecking(true); setMapping(value => ({...value, [field]: Number(e.target.value)})); setResults({}); setSummary('')}}><option value={-1}>不导入</option>{parsed.rows[0]?.map((header, index) => <option value={index} key={index}>{header || `第 ${index + 1} 列`}</option>)}</select></label>)}</div><div className="batch-preview" ref={previewContainer}><table><thead><tr><th>行</th><th>ID</th><th>名称</th><th>类型</th><th>结果 / 原因</th></tr></thead><tbody>{displayed.map(row => {const errors = displayedErrors(row); const success = results[row.line] === '已导入'; return <tr key={row.line} data-line={row.line}><td className="mono">{row.line}</td><td className="mono">{row.item.id}</td><td>{row.item.name}</td><td>{row.item.category}</td><td className={success ? 'text-success' : errors.length || results[row.line] ? 'field-error' : ''}>{success && <Check size={12} className="inline mr-1" />}{results[row.line] || (errors.length ? errors.join('；') : checking ? '检查中…' : '新建')}</td></tr>})}</tbody></table></div></>}
  </Modal>
}
