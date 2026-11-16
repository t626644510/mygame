import {create} from 'zustand'
import {api, ApiError} from '../../api'
import {clone, mapLimited, same} from '../../lib/utils'
import {useEditorStore} from '../../store'
import type {ContentError, Reference, RequestDraft} from '../../types'
import {baseApi} from './api'
import {baseRoute, parseBaseRoute} from './routing'
import {baseTypes, flowRuleId, newBaseEntity, type BaseEntity, type BaseSession, type BaseType} from './types'

export const baseKey = (type: BaseType, id: string) => `${type}:${id}`
export const baseDirty = (session?: BaseSession) => !!session && (session.isNew || !same(session.entity, session.base) || session.requests.length > 0)
interface State {
 data: Record<BaseType, BaseEntity[]>; sessions: Record<string, BaseSession>; current: string; type: BaseType; loading: boolean; loaded: boolean; loadError: string; saving: string; revision: number
 errors: Record<string, ContentError[]>; refs: Reference[]; conflict: {key: string; disk: BaseEntity; etag: string} | null
 load: () => Promise<void>; open: (type: BaseType, id: string) => Promise<void>; create: (type: BaseType) => void
 edit: (change: (entity: BaseEntity) => void) => void; discard: () => void; undo: () => void; redo: () => void
 save: (target?: {key: string; etag: string}) => Promise<boolean>; useDisk: () => void; addRequest: (request: RequestDraft) => void
}
let loadSerial = 0, openSerial = 0
const notify = (message: string) => useEditorStore.getState().notify(message)
export const useBaseStore = create<State>((set, get) => ({
 data: {building: [], recipe: [], layout: [], rule: []}, sessions: {}, current: '', type: 'layout', loading: false, loaded: false, loadError: '', saving: '', revision: 0, errors: {}, refs: [], conflict: null,
 load: async () => {
  const request = ++loadSerial; set({loading: true})
  try {
   const groups = await Promise.all(baseTypes.map(async type => {
    const list = (await api.list(type)).filter(e => type !== 'rule' || e.id === flowRuleId)
    return [type, await mapLimited(list, 4, async ({id}) => (await baseApi.get(type, id)).value)] as const
   }))
   if (request === loadSerial) set(state => ({data: Object.fromEntries(groups) as State['data'], loaded: true, loading: false, loadError: '', revision: state.revision + 1}))
  } catch (error) {if (request === loadSerial) set({loading: false, loadError: error instanceof Error ? error.message : '基地设计内容读取失败'})}
 },
 open: async (type, id) => {
  const request = ++openSerial, key = baseKey(type, id); set({current: key, type, refs: []})
  try {
   const atRequest = get().sessions[key]
   if (!baseDirty(atRequest)) {
    const result = await baseApi.get(type, id)
    if (request !== openSerial) return
    set(state => state.sessions[key] !== atRequest || baseDirty(state.sessions[key]) ? state : ({sessions: {...state.sessions, [key]: {type, entity: clone(result.value), base: clone(result.value), etag: result.etag, isNew: false, requests: [], revision: atRequest?.revision ?? 0, past: same(atRequest?.entity, result.value) ? atRequest?.past || [] : [], future: []}}}))
   }
   const refs = await api.refs(id); if (request === openSerial) set({refs})
  } catch (error) {if (request === openSerial) notify(error instanceof Error ? error.message : '实体读取失败')}
 },
 create: type => {++openSerial; const key = baseKey(type, '_new'); if (get().sessions[key]) {set({type, current: key, refs: []}); return} const entity = newBaseEntity(type); set(state => ({type, current: key, refs: [], errors: {...state.errors, [key]: []}, sessions: {...state.sessions, [key]: {type, entity, base: clone(entity), etag: '', isNew: true, requests: [], revision: 0, past: [], future: []}}}))},
 edit: change => {
  const key = get().current, session = get().sessions[key]; if (!session) return
  const entity = clone(session.entity); change(entity); if (entity.id !== session.entity.id && (!session.isNew || get().saving === key)) {notify('已保存或正在保存的实体 ID 不可修改'); return} if (same(entity, session.entity)) return
  set(state => ({sessions: {...state.sessions, [key]: {...session, entity, revision: session.revision + 1, past: [...session.past, clone(session.entity)].slice(-100), future: []}}, errors: {...state.errors, [key]: []}}))
 },
 discard: () => {const state = get(), key = state.current, session = state.sessions[key]; if (!session) return; if (session.isNew) {const sessions = {...state.sessions}; delete sessions[key]; set({sessions, current: '', errors: {...state.errors, [key]: []}}); window.history.replaceState(null, '', baseRoute(session.type)); return} set({sessions: {...state.sessions, [key]: {...session, entity: clone(session.base), requests: [], revision: session.revision + 1, past: [], future: []}}, errors: {...state.errors, [key]: []}})},
 undo: () => {const state = get(), key = state.current, session = state.sessions[key]; if (!session?.past.length) return; const entity = clone(session.past.at(-1)!); if (!session.isNew) entity.id = session.entity.id; set({sessions: {...state.sessions, [key]: {...session, entity, past: session.past.slice(0, -1), future: [clone(session.entity), ...session.future], revision: session.revision + 1}}, errors: {...state.errors, [key]: []}})},
 redo: () => {const state = get(), key = state.current, session = state.sessions[key]; if (!session?.future.length) return; const entity = clone(session.future[0]); if (!session.isNew) entity.id = session.entity.id; set({sessions: {...state.sessions, [key]: {...session, entity, future: session.future.slice(1), past: [...session.past, clone(session.entity)].slice(-100), revision: session.revision + 1}}, errors: {...state.errors, [key]: []}})},
 addRequest: request => {const state = get(), key = state.current, session = state.sessions[key]; if (session) set({sessions: {...state.sessions, [key]: {...session, requests: [...session.requests, request], revision: session.revision + 1}}})},
 save: async target => {
  const key = target?.key ?? get().current, session = get().sessions[key]
  if (!session || get().saving || !useEditorStore.getState().online) return false
  const route = parseBaseRoute(), routeAtSave = route && route.type !== 'chain' && baseKey(route.type, route.id || '') === key ? route : null
  set(state => ({saving: key, errors: {...state.errors, [key]: []}}))
  try {
   const requests = session.requests.map(r => ({...r, target: `${session.type}:${session.entity.id}`}))
   await baseApi.validate(session.type, session.entity, session.isNew ? 'create' : 'update', requests)
   const result = await baseApi.save(session.type, session.entity, target?.etag ?? session.etag, session.isNew, requests), nextKey = baseKey(session.type, result.value.id)
   set(state => {
    const sessions = {...state.sessions}, latest = sessions[key]
    const committed: BaseSession = {...session, entity: clone(result.value), base: clone(result.value), etag: result.etag, isNew: false, requests: [], revision: session.revision + 1}
    let mayFollow = false
    if (latest?.base === session.base && latest.entity.id === session.entity.id) {
     delete sessions[key]; mayFollow = true
     sessions[nextKey] = {...latest, base: clone(result.value), etag: result.etag, isNew: false, ...(latest.revision === session.revision ? {entity: clone(result.value), requests: [], revision: latest.revision + 1} : {requests: latest.requests.slice(session.requests.length)})}
    } else {
     // A successful create belongs to its submitted identity. A newer local
     // temporary draft keeps its own baseline/isNew/ETag instead of borrowing
     // the committed entity's concurrency token.
     sessions[nextKey] = committed
     if (latest?.base === session.base) sessions[key] = {...latest, requests: latest.requests.slice(session.requests.length)}
    }
    return {sessions, current: mayFollow && state.current === key ? nextKey : state.current, conflict: null}
   })
   const liveRoute = parseBaseRoute()
   if (get().current === nextKey && routeAtSave && liveRoute?.type === routeAtSave.type && liveRoute.id === routeAtSave.id) window.history.replaceState(null, '', baseRoute(session.type, result.value.id))
   notify('设计数据已保存'); await Promise.all([get().load(), useEditorStore.getState().load()]); return true
  } catch (error) {
   if (error instanceof ApiError && error.status === 409 && error.body.current) set({conflict: {key, disk: error.body.current as unknown as BaseEntity, etag: error.etag}})
   else if (error instanceof ApiError && error.body.errors) set(state => ({errors: {...state.errors, [key]: error.body.errors!}}))
   else notify(error instanceof Error ? error.message : '保存失败')
   return false
  } finally {set({saving: ''})}
 },
 useDisk: () => {const state = get(), c = state.conflict, session = c && state.sessions[c.key]; if (!c || !session) return; set({sessions: {...state.sessions, [c.key]: {...session, entity: clone(c.disk), base: clone(c.disk), etag: c.etag, isNew: false, requests: [], revision: session.revision + 1, past: [], future: []}}, conflict: null, errors: {...state.errors, [c.key]: []}}); void get().load()},
}))
