import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Box, CheckCircle2, ClipboardCopy, Command, FileCheck2, FileDown, FlaskConical, Map, MessageSquare, Moon, Package, PanelBottomClose, Search, Settings2, Sun, Wifi, WifiOff, X } from 'lucide-react'
import { api } from './api'
import { useEditorStore, isDirty } from './store'
import { copyText } from './lib/utils'
import { type RequestDraft } from './types'
import { ItemTable } from './components/ItemTable'
import { ItemDetail } from './components/ItemDetail'
import { BatchImport } from './components/BatchImport'
import { RequestForm } from './components/RequestForm'
import { ConflictDialog } from './components/ConflictDialog'
import { EntitySearch } from './components/EntitySearch'
import { Button } from './components/ui/button'
import { Modal } from './components/ui/modal'
import {CombatWorkspace} from './features/combat/CombatWorkspace'
import {combatNavigate} from './features/combat/routing'
import {useCombatStore, sessionDirty} from './features/combat/store'
import {combatTypes, type CombatType} from './features/combat/types'

type Destination = string | null
const currentRoute = () => {
  const value = window.location.hash.replace(/^#\/?/, '').split('/')
  return value[0] === 'items' && value[1] ? decodeURIComponent(value[1]) : null
}
const sessionRoute = () => {const session = useEditorStore.getState().current; return session ? session.isNew ? '_new' : session.item.id : null}
const routeHash = (id: Destination) => `#/items${id ? `/${encodeURIComponent(id)}` : ''}`
function performNavigation(id: Destination, push = true) {
  const state = useEditorStore.getState()
  window.history[push ? 'pushState' : 'replaceState'](null, '', routeHash(id))
  if (id === '_new') state.newItem(state.category === 'all' ? 'material' : state.category)
  else if (id) void state.open(id)
  else state.close()
}
interface Composer {field: string; capability?: 'effect' | 'bonus'}
function focusField(pointer: string) {
  const name = pointer.replace(/^\//, '').split('/').map(value => value.replaceAll('~1', '/').replaceAll('~0', '~')).join('.')
  const fields = Array.from(document.querySelectorAll<HTMLElement>('[data-field]')).sort((a, b) => (b.dataset.field?.length || 0) - (a.dataset.field?.length || 0))
  const field = fields.find(element => name === element.dataset.field || name.startsWith(`${element.dataset.field}.`))
  const input = field?.querySelector<HTMLElement>('input,select,textarea') || field?.querySelector<HTMLElement>('button')
  if (!input && field?.matches('input,select,textarea,button')) {field.focus(); field.scrollIntoView({block: 'center'}); return true}
  if (input) {input.focus(); input.scrollIntoView({block: 'center'}); return true}
  return false
}
export function App() {
  const state = useEditorStore()
  const [module, setModule] = useState<'items' | 'combat'>(() => location.hash.startsWith('#/combat') ? 'combat' : 'items')
  const currentItemId = state.current?.item.id
  const combatCurrentId = useCombatStore(s => s.sessions[s.current]?.entity.id)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('helper-theme')
    return saved === 'light' || saved === 'dark' ? saved : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [pasteOpen, setPasteOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [requestsOpen, setRequestsOpen] = useState(false)
  const [composer, setComposer] = useState<Composer | null>(null)
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [issueFocus, setIssueFocus] = useState<{id: string; field: string; type?: string} | null>(null)
  const initialRoute = useRef(false)
  useEffect(() => {document.documentElement.classList.toggle('dark', theme === 'dark'); document.documentElement.dataset.theme = theme}, [theme])
  useEffect(() => {
    if (localStorage.getItem('helper-theme')) return
    const media = matchMedia('(prefers-color-scheme: dark)')
    const listener = () => setTheme(media.matches ? 'dark' : 'light')
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [])
  useEffect(() => {
    let active = true; let connected = false; let busy = false
    const ping = async () => {
      if (busy) return
      busy = true
      try {
        const health = await api.health(AbortSignal.timeout(1200))
        if (!active) return
        useEditorStore.getState().setOnline(true, health.version)
        if (!connected) {void useEditorStore.getState().load(); if (useCombatStore.getState().loaded) void useCombatStore.getState().load()}
        connected = true
      } catch {if (active) useEditorStore.getState().setOnline(false); connected = false}
      finally {busy = false}
    }
    void ping(); const timer = window.setInterval(() => {void ping()}, 1500)
    return () => {active = false; clearInterval(timer)}
  }, [])
  useEffect(() => {
    if (!state.loaded || initialRoute.current) return
    initialRoute.current = true
    if (location.hash.startsWith('#/combat')) {setModule('combat'); return}
    performNavigation(currentRoute(), false)
  }, [state.loaded])
  const navigate = useCallback((id: Destination) => {
    if (id === sessionRoute()) return
    const action = () => {setModule('items'); performNavigation(id)}
    if (isDirty(useEditorStore.getState().current)) setPendingNav(() => action)
    else action()
  }, [])
  useEffect(() => {
    const onRoute = () => {
      if (location.hash.startsWith('#/combat')) {setModule('combat'); return}
      setModule('items')
      const requested = currentRoute(); const previous = sessionRoute()
      if (requested === previous) return
      if (isDirty(useEditorStore.getState().current)) {
        window.history.replaceState(null, '', routeHash(previous))
        setPendingNav(() => () => performNavigation(requested))
      } else performNavigation(requested, false)
    }
    window.addEventListener('hashchange', onRoute); window.addEventListener('popstate', onRoute)
    return () => {window.removeEventListener('hashchange', onRoute); window.removeEventListener('popstate', onRoute)}
  }, [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!document.querySelector('[role="dialog"]')) {if (module === 'combat') void useCombatStore.getState().save(); else void useEditorStore.getState().save()}
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {event.preventDefault(); setSearchOpen(value => !value)}
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"]')) {if (module === 'combat') {const combat = useCombatStore.getState(); if (combat.current) combatNavigate(combat.type)} else if (useEditorStore.getState().current) navigate(null)}
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [navigate, module])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {if (isDirty(useEditorStore.getState().current) || Object.values(useCombatStore.getState().sessions).some(sessionDirty)) event.preventDefault()}
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
  useEffect(() => {
    if (!state.toast) return
    const timer = setTimeout(() => useEditorStore.getState().notify(''), 4500)
    return () => clearTimeout(timer)
  }, [state.toast])
  useEffect(() => {
    if (!issueFocus || (issueFocus.type && issueFocus.type !== 'item' ? combatCurrentId : currentItemId) !== issueFocus.id) return
    const frame = requestAnimationFrame(() => {if (focusField(issueFocus.field)) setIssueFocus(null)})
    return () => cancelAnimationFrame(frame)
  }, [issueFocus, currentItemId, combatCurrentId, module])
  const submitRequest = async (request: RequestDraft, capabilityId: string) => {
    if (!composer || !state.current) return
    if (composer.capability) {
      state.edit(item => {
        if (composer.capability === 'effect') item.consumable.effects.push({kind: capabilityId, note: request.body})
        else {
          const index = Number(composer.field.split('.').at(-1))
          if (Number.isInteger(index) && item.equipment.combatBonus[index]) item.equipment.combatBonus[index].id = capabilityId
          else item.equipment.combatBonus.push({id: capabilityId, value: 0})
        }
        item.draft = true
      })
      state.addPendingRequest(request)
      state.notify('需求已附上，将随草稿一起保存')
    } else if (state.current.isNew || isDirty(state.current)) {
      state.addPendingRequest(request); state.notify('备注已附上，将随物品一起保存')
    } else {
      await api.request(request); await state.load(); state.notify('已创建备注 / 需求')
    }
  }
  const deleteCurrent = async () => {
    if (!state.current) return
    setDeleting(true)
    try {await api.delete(state.current.item.id, state.current.etag); performNavigation(null); await state.load(); state.notify('已删除物品'); setDeleteOpen(false)}
    catch (error) {state.notify(error instanceof Error ? error.message : '删除失败'); await state.load()}
    finally {setDeleting(false)}
  }
  const exportContent = async () => {
    setExporting(true)
    try {const result = await api.export(); state.notify(`已导出 · ${result.contentHash.slice(0, 12)}`); await state.validate()}
    catch (error) {state.notify(error instanceof Error ? error.message : '导出失败'); await state.validate()}
    finally {setExporting(false)}
  }
  const problems = [...state.errors, ...(state.validation?.errors || [])]
  const openCombat = (type: CombatType = 'skill', id?: string) => {
    const action = () => {setModule('combat'); combatNavigate(type, id)}
    if (module === 'items' && isDirty(useEditorStore.getState().current)) setPendingNav(() => action)
    else action()
  }
  return <div className="editor-shell">
    <header className="topbar"><a href="#/items" className="brand" onClick={e => {e.preventDefault(); navigate(null)}}><Box size={19} /><strong>Helper</strong><span>内容编辑器</span></a><Button variant="ghost" className="global-search" onClick={() => setSearchOpen(true)} aria-label="全局搜索"><Search size={14} /><span>搜索 ID、别名、名称</span><kbd>Ctrl K</kbd></Button><div className={`connection ${state.online ? '' : 'offline'}`} title={state.version}>{state.online ? <Wifi size={13} /> : <WifiOff size={13} />}<span>{state.online ? 'sim-cli 已连接' : '未连接'}</span><i /></div><Button variant="ghost" size="sm" onClick={() => setRequestsOpen(true)} aria-label="查看需求单"><MessageSquare size={14} /><span className="top-label">需求单</span><span className="mono">{state.requests.filter(request => !['done', 'rejected'].includes(request.status)).length}</span></Button><Button variant="ghost" size="sm" disabled={!state.online} onClick={() => void state.validate()}><FileCheck2 size={14} /><span className="top-label">{problems.length ? `${problems.length} 个问题` : state.validation?.ok ? '校验通过' : '校验内容'}</span></Button><Button variant="ghost" size="icon" aria-label={theme === 'light' ? '切换暗色主题' : '切换亮色主题'} onClick={() => setTheme(value => {const next = value === 'dark' ? 'light' : 'dark'; localStorage.setItem('helper-theme', next); return next})}>{theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}</Button></header>
    {!state.online && <div className="offline-banner" role="status"><WifiOff size={14} /><strong>本地模拟器未连接</strong><span>编辑内容保留，恢复后可继续保存。</span><Button size="sm" variant="ghost" onClick={() => {void copyText('dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll serve --content content --port 5185').then(() => state.notify('已复制 sim-cli 启动命令')).catch(() => state.notify('浏览器未允许复制'))}}><ClipboardCopy size={13} />复制启动命令</Button></div>}
    <div className="workspace"><nav className="module-nav" aria-label="编辑器模块"><button className={module === 'items' ? 'active' : ''} aria-current={module === 'items' ? 'page' : undefined} title="物品" onClick={() => navigate(null)}><Package size={19} /><span>物品</span></button><button className={module === 'combat' ? 'active' : ''} aria-current={module === 'combat' ? 'page' : undefined} title="战斗" onClick={() => openCombat()}><FlaskConical size={18} /><span>战斗</span></button><button disabled title="地图模块 · P3"><Map size={18} /><span>地图</span><small>P3</small></button><button disabled title="生产模块 · P3"><Settings2 size={18} /><span>生产</span><small>P3</small></button><span className="nav-bottom" title="本地编辑器"><Command size={16} /></span></nav>{module === 'combat' ? <CombatWorkspace /> : <main className={`content-area ${state.current ? 'has-detail' : ''}`}><ItemTable onSelect={navigate} onNew={() => navigate('_new')} onPaste={() => setPasteOpen(true)} />{state.current && <ItemDetail onClose={() => navigate(null)} onSave={() => void state.save()} onDelete={() => setDeleteOpen(true)} onRequest={(field, capability) => setComposer({field, capability})} />}</main>}</div>
    <div className="bottom-status"><button onClick={() => state.showProblems(!state.problemsOpen)}>{problems.length ? <AlertCircle size={12} /> : <CheckCircle2 size={12} />}{problems.length ? `${problems.length} 个校验问题` : state.validation?.ok ? '内容校验通过' : '问题面板'}<span>{state.problemsOpen ? '收起' : '展开'}</span></button><span>本地文件 · 一实体一文件</span>{state.items.some(item => item.draft) && <small>导出将排除 {state.items.filter(item => item.draft).length} 个草稿</small>}<Button variant="ghost" size="sm" disabled={!state.online || exporting || isDirty(state.current)} onClick={() => void exportContent()} title={isDirty(state.current) ? '请先保存修改' : '仅导出已保存的可用定义；草稿不包含，活动引用草稿时拒绝导出'}><FileDown size={12} />{exporting ? '导出中…' : '导出可用内容'}</Button></div>
    {state.problemsOpen && <section className="problems-panel" aria-label="校验问题"><header><h2>校验问题 <span className="mono">{problems.length}</span></h2><Button variant="ghost" size="icon" aria-label="收起问题面板" onClick={() => state.showProblems(false)}><PanelBottomClose size={15} /></Button></header><div>{!problems.length ? <p className="text-muted-foreground">{state.validation?.ok ? '内容校验通过。' : '点击顶部“校验内容”检查已保存的数据。'}</p> : problems.map((error, index) => <button key={`${error.path}-${error.code}-${index}`} onClick={() => {const match = error.path.match(/(items|skills|characters|encounters|trials|rules)\/([a-z][a-z0-9_]*)\.json/); if (match) {const type = match[1].slice(0, -1), id = match[2]; setIssueFocus({id, field: error.field || error.code, type}); if (type === 'item') {if (state.current?.item.id !== id) navigate(id)} else openCombat(type as CombatType, id)}}}><AlertCircle size={13} /><code>{error.path}</code><span>{error.message}</span></button>)}{state.validation?.warnings.map((warning, index) => <p className="text-warning" key={index}>{warning}</p>)}</div></section>}
    {state.toast && <div className="toast" role="status"><CheckCircle2 size={15} /><span>{state.toast}</span><button onClick={() => state.notify('')} aria-label="关闭提示"><X size={13} /></button></div>}
    {pasteOpen && <BatchImport onClose={() => setPasteOpen(false)} />}
    {composer && state.current && <RequestForm open onClose={() => setComposer(null)} target={`item:${state.current.item.id}`} field={composer.field} mandatory={!!composer.capability} capability={composer.capability} onSubmit={submitRequest} />}
    <ConflictDialog />
    <Modal open={!!pendingNav} onOpenChange={value => {if (!value) setPendingNav(null)}} title="有未保存的修改" description="离开前请选择保存修改，或放弃当前修改。" footer={<><Button className="mr-auto" onClick={() => setPendingNav(null)}>继续编辑</Button><Button onClick={() => {pendingNav?.(); setPendingNav(null)}}>放弃并离开</Button><Button variant="default" disabled={!state.online || state.saving} onClick={() => {void state.save().then(saved => {if (saved) {pendingNav?.(); setPendingNav(null)}})}}>保存并离开</Button></>}><p>{state.current?.item.name || state.current?.item.id} 的修改仍在内存中。</p></Modal>
    <Modal open={deleteOpen} onOpenChange={setDeleteOpen} title="删除物品定义" description="仅无引用的物品可以删除。该操作会删除对应源 JSON 文件。" footer={<><Button onClick={() => setDeleteOpen(false)} disabled={deleting}>取消</Button><Button variant="danger" onClick={() => void deleteCurrent()} disabled={deleting || !state.online}>确认删除</Button></>}><p className="mono">{state.current?.item.id}</p></Modal>
    <EntitySearch open={searchOpen} onClose={() => setSearchOpen(false)} onSelect={(id, type) => {setSearchOpen(false); if (type && combatTypes.includes(type as CombatType)) openCombat(type as CombatType, id); else navigate(id)}} />
    <Modal open={requestsOpen} onOpenChange={setRequestsOpen} title="备注与需求单" description="状态按源文件显示。样例的 triaged / in_progress 不代表真实任务已派发。" className="requests-modal"><div className="request-list">{state.requests.map(request => <article className="request-entry" key={request.id}><div className="flex items-center gap-2"><code>{request.id}</code><span className="badge">{request.status}</span><span className="text-xs text-muted-foreground">{request.owner}</span></div><h3>{request.title}</h3><p>{request.body}</p><code>{request.target}</code></article>)}{!state.requests.length && <p className="text-muted-foreground">暂无备注与需求。可从物品详情添加。</p>}</div></Modal>
  </div>
}
