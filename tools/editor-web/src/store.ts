import { create } from 'zustand'
import { api, ApiError } from './api'
import { clone, same, mapLimited } from './lib/utils'
import { emptyItem, needsCapability, type Capabilities, type Catalog, type Category, type Conflict, type ContentError, type EditorSession, type Item, type Reference, type RequestDraft, type RequestRecord, type Validation } from './types'

interface EditorState {
  online: boolean; loading: boolean; saving: boolean; loaded: boolean; version: string; loadError: string
  items: Item[]; references: Record<string, Reference[]>; requests: RequestRecord[]; catalog: Catalog | null; capabilities: Capabilities | null
  current: EditorSession | null; errors: ContentError[]; validation: Validation | null; conflict: Conflict | null
  toast: string; query: string; category: Category | 'all'; problemsOpen: boolean
  setOnline: (online: boolean, version?: string) => void
  load: () => Promise<void>; open: (id: string) => Promise<void>; newItem: (category?: Category) => void
  edit: (update: (item: Item) => void) => void; close: () => void
  addPendingRequest: (request: RequestDraft) => void
  save: (overrideEtag?: string) => Promise<boolean>; useDisk: () => void; cancelConflict: () => void
  validate: () => Promise<void>; notify: (message: string) => void
  setFilter: (patch: {query?: string; category?: Category | 'all'}) => void
  showProblems: (value: boolean) => void
}
export const isDirty = (session: EditorSession | null) => !!session && (session.isNew || !same(session.item, session.base) || session.pendingRequests.length > 0)
let loadSerial = 0

export const useEditorStore = create<EditorState>((set, get) => ({
  online: false, loading: true, saving: false, loaded: false, version: '', loadError: '',
  items: [], references: {}, requests: [], catalog: null, capabilities: null, current: null, errors: [], validation: null, conflict: null,
  toast: '', query: '', category: 'all', problemsOpen: false,
  setOnline: (online, version) => set({online, ...(version ? {version} : {})}),
  load: async () => {
    const serial = ++loadSerial
    if (!get().loaded) set({loading: true})
    try {
      const [list, catalog, requests, capabilities] = await Promise.all([api.list(), api.catalog(), api.requests(), api.capabilities()])
      const records = await mapLimited(list, 4, async ({id}) => {
        const [entity, refs] = await Promise.all([api.get(id), api.refs(id)])
        return {item: entity.value, refs}
      })
      if (serial === loadSerial) set({items: records.map(record => record.item), references: Object.fromEntries(records.map(record => [record.item.id, record.refs])), catalog, requests, capabilities, loaded: true, loading: false, loadError: ''})
    } catch (error) { if (serial === loadSerial) set({loading: false, loadError: error instanceof Error ? error.message : '加载失败'}) }
  },
  open: async id => {
    try {
      const entity = await api.get(id)
      set({current: {item: clone(entity.value), base: clone(entity.value), etag: entity.etag, isNew: false, pendingRequests: []}, errors: [], conflict: null})
    } catch (error) { get().notify(error instanceof Error ? error.message : '物品加载失败') }
  },
  newItem: category => {
    const item = emptyItem(category)
    set({current: {item, base: clone(item), etag: '', isNew: true, pendingRequests: []}, errors: [], conflict: null})
  },
  edit: update => {
    const session = get().current
    if (!session) return
    const item = clone(session.item)
    update(item)
    if (needsCapability(item, get().catalog)) item.draft = true
    set({current: {...session, item}, errors: []})
  },
  close: () => set({current: null, errors: [], conflict: null}),
  addPendingRequest: request => {
    const current = get().current
    if (current) set({current: {...current, pendingRequests: [...current.pendingRequests, request]}})
  },
  save: async overrideEtag => {
    const session = get().current
    if (!session || !get().online || get().saving) return false
    set({saving: true, errors: []})
    try {
      // Pure validation distinguishes ID/field errors (422) from the final
      // resource precondition (409). PUT still repeats validation atomically.
      await api.validateItem(session.item, session.isNew ? 'create' : 'update', session.pendingRequests)
      const result = await api.save(session.item, overrideEtag || session.etag, session.isNew, session.pendingRequests.map(request => ({...request, target: `item:${session.item.id}`})))
      ++loadSerial
      const items = get().items.some(item => item.id === result.value.id) ? get().items.map(item => item.id === result.value.id ? result.value : item) : [...get().items, result.value]
      set({items})
      if (get().current?.base === session.base) {
        set({current: {item: clone(result.value), base: clone(result.value), etag: result.etag, isNew: false, pendingRequests: []}, conflict: null})
        window.history.replaceState(null, '', `#/items/${result.value.id}`)
      }
      get().notify('已保存')
      await get().load()
      return true
    } catch (error) {
      if (get().current?.base !== session.base) get().notify(error instanceof Error ? error.message : '保存失败')
      else if (error instanceof ApiError && error.status === 409 && error.body.current) set({conflict: {disk: error.body.current, etag: error.etag || error.body.etag || ''}})
      else if (error instanceof ApiError && error.body.errors) set({errors: error.body.errors, problemsOpen: true})
      else get().notify(error instanceof Error ? error.message : '保存失败')
      return false
    } finally { set({saving: false}) }
  },
  useDisk: () => {
    const conflict = get().conflict
    if (!conflict) return
    set({current: {item: clone(conflict.disk), base: clone(conflict.disk), etag: conflict.etag, isNew: false, pendingRequests: []}, conflict: null, errors: []})
    get().notify('已载入磁盘上的版本')
    void get().load()
  },
  cancelConflict: () => set({conflict: null}),
  validate: async () => {
    try { set({validation: await api.validate(), problemsOpen: true}) }
    catch (error) {
      if (error instanceof ApiError && error.body.errors) set({validation: {ok: false, errors: error.body.errors, warnings: []}, problemsOpen: true})
      else get().notify(error instanceof Error ? error.message : '校验失败')
    }
  },
  notify: toast => set({toast}),
  setFilter: patch => set(patch),
  showProblems: problemsOpen => set({problemsOpen}),
}))
