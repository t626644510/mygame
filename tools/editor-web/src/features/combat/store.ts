import {create} from 'zustand'
import {api, ApiError} from '../../api'
import {clone, mapLimited, same} from '../../lib/utils'
import {useEditorStore} from '../../store'
import type {ContentError, Reference, RequestDraft} from '../../types'
import {combatApi, errorsFrom} from './api'
import {combatTypes, newEntity, type AssemblyBody, type Character, type CombatCatalog, type CombatEntity, type CombatType, type ContextChoice, type Encounter, type OverrideSet, type Session, type Skill, type Trial} from './types'
import {apiCall} from '../../api'

const keyOf = (type: CombatType, id: string) => `${type}:${id}`
export const sessionDirty = (s?: Session) => !!s && (s.isNew || !same(s.entity, s.base) || s.intents.length > 0 || s.requests.length > 0)
interface State {
 data: Record<CombatType, CombatEntity[]>; sessions: Record<string, Session>; current: string; type: CombatType; catalog: CombatCatalog | null
 loading: boolean; loaded: boolean; saving: string; loadError: string; errors: ContentError[]; refs: Reference[]
 conflict: {key: string; disk: CombatEntity; etag: string} | null; context: ContextChoice; highlight: string
 load: () => Promise<void>; open: (type: CombatType, id: string) => Promise<void>; create: (type: CombatType) => void
 edit: (path: string, change: (entity: CombatEntity) => void, op?: 'set' | 'remove') => void
 discard: () => void; addRequest: (request: RequestDraft) => void; save: (etag?: string, key?: string) => Promise<boolean>
 useDisk: () => void; setContext: (context: ContextChoice) => void; setHighlight: (id: string) => void
 overrides: (characterId?: string) => OverrideSet; assemblyBody: (trial: Trial) => AssemblyBody
}
let loadSerial = 0, openSerial = 0
const notify = (message: string) => useEditorStore.getState().notify(message)
export const useCombatStore = create<State>((set, get) => ({
 data: {skill: [], character: [], encounter: [], trial: [], rule: []}, sessions: {}, current: '', type: 'skill', catalog: null,
 loading: false, loaded: false, saving: '', loadError: '', errors: [], refs: [], conflict: null, context: undefined, highlight: '',
 load: async () => {
  const serial = ++loadSerial; set({loading: true})
  try {
   const [groups, catalog] = await Promise.all([Promise.all(combatTypes.map(async type => {const list = await api.list(type); return [type, await mapLimited(list, 4, async ({id}) => (await combatApi.get(type, id)).value)] as const})), apiCall<CombatCatalog>('/catalog')])
   if (serial === loadSerial) set({data: Object.fromEntries(groups) as State['data'], catalog: catalog.value, loading: false, loaded: true, loadError: ''})
  } catch (error) {if (serial === loadSerial) set({loading: false, loadError: error instanceof Error ? error.message : '战斗内容加载失败'})}
 },
 open: async (type, id) => {
  const serial = ++openSerial, key = keyOf(type, id); set({current: key, type, errors: [], refs: [], highlight: ''})
  try {
   const session = get().sessions[key]
   if (!sessionDirty(session)) {
    const result = await combatApi.get(type, id)
    if (serial !== openSerial) return
    // A cached session remains editable during the GET. Accept its response
    // only while the exact request-time session (including baseline/ETag) is
    // unchanged; newer local input must keep its original concurrency guard.
    set(state => state.sessions[key] !== session || sessionDirty(state.sessions[key]) ? state : ({sessions: {...state.sessions, [key]: {type, entity: clone(result.value), base: clone(result.value), etag: result.etag, isNew: false, intents: [], requests: [], revision: 0}}}))
   }
   const refs = await combatApi.refs(id); if (serial === openSerial) set({refs})
  } catch (error) {if (serial === openSerial) notify(error instanceof Error ? error.message : '读取失败')}
 },
 create: type => {
  if (type === 'rule') return
  const key = keyOf(type, '_new'), entity = newEntity(type); ++openSerial
  set(state => ({type, current: key, refs: [], errors: [], sessions: {...state.sessions, [key]: {type, entity, base: clone(entity), etag: '', isNew: true, intents: [], requests: [], revision: 0}}}))
 },
 edit: (path, change, op = 'set') => {
  const key = get().current, session = get().sessions[key]; if (!session || session.type === 'rule') return
  const entity = clone(session.entity); change(entity)
  if (session.type === 'skill' && (entity as Skill).effectKind === 'pending') entity.draft = true
  // A new Helper ID identifies the entity being created; it is never a
  // permitted Runtime/source field overlay. Existing IDs are read-only.
  const intents = path === '/id' ? session.intents : [...session.intents.filter(intent => intent.path !== path), {op, path}]
  set(state => ({sessions: {...state.sessions, [key]: {...session, entity, intents, revision: session.revision + 1}}, errors: []}))
 },
 discard: () => {
  const key = get().current, s = get().sessions[key]; if (!s) return
  if (s.isNew) {set(state => {const sessions = {...state.sessions}; delete sessions[key]; return {sessions, current: '', errors: []}}); return}
  set(state => ({sessions: {...state.sessions, [key]: {...s, entity: clone(s.base), intents: [], requests: [], revision: s.revision + 1}}, errors: []}))
 },
 addRequest: request => {const key = get().current, s = get().sessions[key]; if (s) set(state => ({sessions: {...state.sessions, [key]: {...s, requests: [...s.requests, request], revision: s.revision + 1}}}))},
 save: async (overrideEtag, targetKey) => {
  const key = targetKey ?? get().current, s = get().sessions[key]; if (!s || s.type === 'rule' || get().saving || !useEditorStore.getState().online) return false
  set({saving: key, errors: []})
  try {
   const requests = s.requests.map(r => ({...r, target: `${s.type}:${s.entity.id}`}))
   await combatApi.validateEntity(s.type, s.entity, s.isNew ? 'create' : 'update', requests, s.intents)
   const result = await combatApi.save(s.type, s.entity, overrideEtag || s.etag, s.isNew, requests, s.intents)
   const nextKey = keyOf(s.type, result.value.id); ++loadSerial
   set(state => {
    const sessions = {...state.sessions}, latest = sessions[key]
    if (latest?.base === s.base) {
     delete sessions[key]
     sessions[nextKey] = latest.revision === s.revision ? {type: s.type, entity: clone(result.value), base: clone(result.value), etag: result.etag, isNew: false, intents: [], requests: [], revision: latest.revision + 1} : {...latest, base: clone(result.value), etag: result.etag, isNew: false}
    }
    return {sessions, current: state.current === key ? nextKey : state.current, conflict: null}
   })
   if (get().current === nextKey) window.history.replaceState(null, '', `#/combat/${s.type}/${encodeURIComponent(result.value.id)}`)
   notify('已保存'); await get().load(); return true
  } catch (error) {
   if (error instanceof ApiError && error.status === 409 && error.body.current) set({conflict: {key, disk: error.body.current as unknown as CombatEntity, etag: error.etag}})
   else if (errorsFrom(error).length) set({errors: errorsFrom(error)})
   else notify(error instanceof Error ? error.message : '保存失败')
   return false
  } finally {set({saving: ''})}
 },
 useDisk: () => {
  const c = get().conflict; if (!c) return
  const session = get().sessions[c.key]; if (!session) return
  set(state => ({sessions: {...state.sessions, [c.key]: {...session, entity: clone(c.disk), base: clone(c.disk), etag: c.etag, isNew: false, intents: [], requests: [], revision: session.revision + 1}}, conflict: null, errors: []})); void get().load()
 },
 setContext: context => set({context}), setHighlight: highlight => set({highlight}),
 overrides: characterId => {
  const state = get(), dirty = Object.values(state.sessions).filter(sessionDirty)
  const trial = characterId && state.context ? state.sessions[keyOf('trial', state.context.trialId)]?.entity || state.data.trial.find(trial => trial.id === state.context?.trialId) : undefined
  if (trial) return state.assemblyBody(trial as Trial).overrides!
  const character = characterId ? state.sessions[keyOf('character', characterId)]?.entity as Character | undefined || state.data.character.find(c => c.id === characterId) as Character | undefined : undefined
  const skills = character ? new Set([...(character.availableActionIds ?? []), ...character.instructions.map(i => i.actionId)]) : null
  return {characters: dirty.filter(s => s.type === 'character' && (!characterId || s.entity.id === characterId)).map(s => s.entity as Character), skills: dirty.filter(s => s.type === 'skill' && (!skills || skills.has(s.entity.id))).map(s => s.entity as Skill), encounters: characterId ? [] : dirty.filter(s => s.type === 'encounter').map(s => s.entity as Encounter)}
 },
 assemblyBody: trial => {
  const state = get(), dirty = Object.values(state.sessions).filter(sessionDirty), encounterIds = new Set(trial.encounters.map(e => e.encounterId))
  const encounters = state.data.encounter.map(e => state.sessions[keyOf('encounter', e.id)]?.entity || e).filter(e => encounterIds.has(e.id)) as Encounter[]
  const characterIds = new Set([...trial.allies, ...encounters.flatMap(e => e.enemies)].map(s => s.characterId))
  const characters = state.data.character.map(e => state.sessions[keyOf('character', e.id)]?.entity || e).filter(e => characterIds.has(e.id)) as Character[]
  const skillIds = new Set(characters.flatMap(c => [...(c.availableActionIds ?? []), ...c.instructions.map(i => i.actionId)]))
  const relevant = dirty.filter(s => s.type === 'trial' ? s.entity.id === trial.id : s.type === 'encounter' ? encounterIds.has(s.entity.id) : s.type === 'character' ? characterIds.has(s.entity.id) : s.type === 'skill' && skillIds.has(s.entity.id))
  return {trial: clone(trial), overrides: {characters: relevant.filter(s => s.type === 'character').map(s => s.entity as Character), skills: relevant.filter(s => s.type === 'skill').map(s => s.entity as Skill), encounters: relevant.filter(s => s.type === 'encounter').map(s => s.entity as Encounter)}, editIntents: relevant.map(s => ({type: s.type, id: s.entity.id, operations: s.intents}))}
 },
}))
export function visibleEntities<T extends CombatEntity>(type: CombatType): T[] {
 const state = useCombatStore.getState(), entities = state.data[type].map(entity => state.sessions[keyOf(type, entity.id)]?.entity || entity)
 return entities as T[]
}
