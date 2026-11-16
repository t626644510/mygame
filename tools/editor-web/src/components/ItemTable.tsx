import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Package, Plus, Search, ClipboardPaste } from 'lucide-react'
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEditorStore, isDirty } from '../store'
import { categoryLabels, categories, splitReferences, type Item } from '../types'
import { Button } from './ui/button'

interface Props { onSelect: (id: string) => void; onNew: () => void; onPaste: () => void }
export function ItemTable({onSelect, onNew, onPaste}: Props) {
  const {items, references, current, loading, loadError, category, query, setFilter, load} = useEditorStore()
  const [sorting, setSorting] = useState<SortingState>([{id: 'id', desc: false}])
  const parent = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  const scrolledSelection = useRef<string | null>(null)
  useEffect(() => {
    if (!parent.current) return
    const element = parent.current
    const observer = new ResizeObserver(() => setAvailableWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const surplus = Math.max(0, availableWidth - 848)
  const idExtra = Math.min(120, Math.round(surplus * .25))
  const data = useMemo(() => items.filter(item => (category === 'all' || item.category === category) && [item.id, item.name, ...item.aliases, ...item.tags].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())), [items, category, query])
  const columns = useMemo<ColumnDef<Item>[]>(() => [
    {accessorKey: 'id', header: 'ID', size: 202 + idExtra, cell: ({row}) => <div className="id-cell"><span>{row.original.id}{current?.item.id === row.original.id && isDirty(current) && <span className="dirty-dot" title="未保存" />}</span>{row.original.aliases.length > 0 && <small title={row.original.aliases.join(', ')}>{row.original.aliases.join(', ')}</small>}</div>},
    {accessorKey: 'name', header: '名称', size: 144 + surplus - idExtra},
    {accessorKey: 'category', header: '类型', size: 90, cell: ({getValue}) => categoryLabels[getValue() as Item['category']]},
    {accessorKey: 'stackLimit', header: '堆叠', size: 72, cell: ({getValue}) => <span className="numeric">{getValue<number>()}</span>},
    {accessorKey: 'baseValue', header: '参考价', size: 88, cell: ({getValue}) => <span className="numeric">{getValue<number>()}</span>},
    {id: 'source', header: '来源', size: 86, accessorFn: item => splitReferences(references[item.id] || []).source.length, cell: ({row, getValue}) => getValue<number>() ? <span>{getValue<number>()} 处</span> : row.original.category === 'material' ? <span className="text-warning">无来源</span> : <span className="text-muted-foreground">—</span>},
    {id: 'usage', header: '用途', size: 76, accessorFn: item => splitReferences(references[item.id] || []).usage.length, cell: ({getValue}) => getValue<number>() ? `${getValue<number>()} 处` : <span className="text-muted-foreground">—</span>},
    {accessorKey: 'draft', header: '状态', size: 90, cell: ({getValue}) => getValue<boolean>() ? <span className="badge pending">待实现</span> : <span className="status-ready"><span />可导出</span>},
  ], [references, current, surplus, idExtra])
  const table = useReactTable({data, columns, state: {sorting}, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel()})
  const rows = table.getRowModel().rows
  // TanStack Virtual observes this container; the page itself never scrolls sideways.
  const virtual = useVirtualizer({count: rows.length, getScrollElement: () => parent.current, estimateSize: () => 32, scrollMargin: 32, overscan: 8})
  const selectedId = current?.isNew ? null : current?.base.id
  useEffect(() => {
    if (!selectedId) {scrolledSelection.current = null; return}
    if (scrolledSelection.current === selectedId) return
    const index = rows.findIndex(row => row.original.id === selectedId)
    if (index < 0) return
    const frame = requestAnimationFrame(() => {virtual.scrollToIndex(index, {align: 'center'}); scrolledSelection.current = selectedId})
    return () => cancelAnimationFrame(frame)
  }, [selectedId, rows, virtual])
  return <section className="items-main" aria-label="物品列表">
    <div className="page-heading"><div><div className="eyebrow">内容库 / ITEMS</div><h1>物品 <span className="count">{items.length}</span></h1></div><div className="flex gap-2"><Button onClick={onPaste}><ClipboardPaste size={14} />从表格粘贴</Button><Button variant="default" onClick={onNew} data-testid="new-item"><Plus size={15} />新建物品</Button></div></div>
    <div className="table-tools"><div className="segments" role="group" aria-label="物品类型筛选"><button className={category === 'all' ? 'active' : ''} onClick={() => setFilter({category: 'all'})}>全部 <span>{items.length}</span></button>{categories.map(value => <button key={value} className={category === value ? 'active' : ''} onClick={() => setFilter({category: value})}>{categoryLabels[value]} <span>{items.filter(item => item.category === value).length}</span></button>)}</div><div className="search-input"><Search size={14} /><input aria-label="筛选物品" placeholder="搜索 ID / 名称 / 标签" value={query} onChange={event => setFilter({query: event.target.value})} /></div></div>
    <div className="table-scroll" ref={parent} tabIndex={0} aria-label="物品表格滚动区域">
      {loading ? <div className="skeleton-table" aria-label="加载物品中">{Array.from({length: 12}, (_, i) => <div key={i} className="skeleton-row" />)}</div> : loadError ? <div className="empty-state"><Package size={28} /><h2>暂时无法读取内容</h2><p>{loadError}</p><Button onClick={() => void load()}>重试加载</Button></div> : rows.length === 0 ? <div className="empty-state"><Package size={30} /><h2>{items.length ? '没有匹配的物品' : '在这里建立物品定义'}</h2><p>{items.length ? '调整类型或搜索条件，查看其他物品。' : '登记材料、装备与消耗品，再查看它们的来源和用途。'}</p><div className="flex gap-2"><Button onClick={onNew}>新建物品</Button><Button onClick={onPaste}>从表格粘贴</Button></div></div> : <table className="item-table" style={{width: `max(100%, ${table.getTotalSize()}px)`}} aria-label="物品表">
        <thead>{table.getHeaderGroups().map(group => <tr key={group.id}>{group.headers.map(header => <th key={header.id} style={{width: header.getSize()}} aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : 'none'}><button onClick={header.column.getToggleSortingHandler()} title={`按${String(header.column.columnDef.header)}排序`}>{flexRender(header.column.columnDef.header, header.getContext())}{header.column.getIsSorted() === 'asc' ? <ArrowUp size={11} /> : header.column.getIsSorted() === 'desc' ? <ArrowDown size={11} /> : <ArrowUpDown size={10} className="sort-neutral" />}</button></th>)}</tr>)}</thead>
        <tbody style={{height: virtual.getTotalSize()}}>{virtual.getVirtualItems().map(virtualRow => {
          const row = rows[virtualRow.index]
          return <tr key={row.id} data-testid={`item-row-${row.original.id}`} className={current?.item.id === row.original.id ? 'selected' : ''} style={{transform: `translateY(${virtualRow.start - 32}px)`}} tabIndex={0} aria-selected={current?.item.id === row.original.id} onClick={() => onSelect(row.original.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); onSelect(row.original.id)} }}>{row.getVisibleCells().map(cell => <td key={cell.id} style={{width: cell.column.getSize()}}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>
        })}</tbody>
      </table>}
    </div>
    <footer className="table-footer"><span>{data.length} / {items.length} 项</span><span>参考价用于静态分析 · 不是游戏内售价</span></footer>
  </section>
}
