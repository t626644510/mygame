import { useEffect, useMemo, useState } from 'react'
import { Package, Search } from 'lucide-react'
import { api } from '../api'
import { useEditorStore } from '../store'
import { mapLimited } from '../lib/utils'
import { Modal } from './ui/modal'

interface Entry {id: string; name: string; aliases: string[]; type: string; label: string; editable: boolean; draft?: boolean}
export function EntitySearch({open, onClose, onSelect}: {open: boolean; onClose: () => void; onSelect: (id: string, type?: string) => void}) {
  const {items, capabilities, notify} = useEditorStore()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [other, setOther] = useState<Entry[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    setQuery(''); setIndex(0); setError('')
    let cancelled = false
    const types = capabilities?.contentTypes.filter(type => type.id !== 'item') || []
    void mapLimited(types, 2, async type => {
      const list = await api.list(type.id)
      return mapLimited(list, 4, async ({id}) => {
        const entity = await api.getAny(type.id, id)
        return {id, name: entity.name || entity.displayName || entity.title || id, aliases: entity.aliases || [], type: type.id, label: type.label, editable: type.editable || type.id === 'rule'}
      })
    }).then(groups => {if (!cancelled) setOther(groups.flat())}).catch(error => {if (!cancelled) setError(error instanceof Error ? error.message : '其他实体索引加载失败')})
    return () => {cancelled = true}
  }, [open, capabilities])
  const entries = useMemo<Entry[]>(() => [...items.map(item => ({...item, type: 'item', label: '物品', editable: true})), ...other], [items, other])
  const results = entries.filter(entry => [entry.id, entry.name, ...entry.aliases].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 30)
  const select = (entry: Entry) => {
    if (entry.editable) onSelect(entry.id, entry.type)
    else notify('该实体所属模块尚未开放，请等待对应阶段。')
  }
  return <Modal open={open} onOpenChange={value => {if (!value) onClose()}} title="全局实体搜索" description="按 ID、旧别名或名称搜索所有实体。可打开的类型以本地模拟器能力为准。" className="search-modal">
    <div className="command-search"><Search size={17} /><input aria-label="全局实体搜索" autoFocus value={query} onChange={e => {setQuery(e.target.value); setIndex(0)}} onKeyDown={event => {if (event.key === 'ArrowDown') {event.preventDefault(); setIndex(value => Math.min(results.length - 1, value + 1))} else if (event.key === 'ArrowUp') {event.preventDefault(); setIndex(value => Math.max(0, value - 1))} else if (event.key === 'Enter' && results[index]) {event.preventDefault(); select(results[index])}}} placeholder="输入 ID、别名、名称…" /></div>
    {error && <p className="field-error px-4">{error}</p>}
    <div className="search-results" role="listbox" aria-label="搜索结果">{results.map((entry, i) => <button className={index === i ? 'selected' : ''} role="option" aria-selected={index === i} aria-disabled={!entry.editable} key={`${entry.type}:${entry.id}`} onClick={() => select(entry)}><Package size={15} /><span><strong>{entry.name}</strong><code>{entry.id}{entry.aliases.length > 0 ? ` · ${entry.aliases.join(', ')}` : ''}</code></span>{!entry.editable ? <span className="badge">{entry.label} · 未开放</span> : entry.draft && <span className="badge pending">待实现</span>}</button>)}{!results.length && <p className="p-5 text-sm text-muted-foreground">没有匹配的实体。</p>}</div>
    <div className="command-hint"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></div>
  </Modal>
}
