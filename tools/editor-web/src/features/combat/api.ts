import {apiCall} from '../../api'
import type {ContentError, Reference, RequestDraft, Validation} from '../../types'
import type {Assembly, AssemblyBody, Character, CharacterValidation, CombatEntity, CombatType, Comparison, ContextChoice, EditIntent, OverrideSet, TrialRun} from './types'

const post = async <T,>(path: string, body: unknown, signal?: AbortSignal) => (await apiCall<T>(path, {method: 'POST', body: JSON.stringify(body), signal})).value
export const combatApi = {
 get: (type: CombatType, id: string) => apiCall<CombatEntity>(`/content/${type}/${encodeURIComponent(id)}`),
 refs: async (id: string) => (await apiCall<Reference[]>(`/refs/${encodeURIComponent(id)}`)).value,
 save: async (type: CombatType, entity: CombatEntity, etag: string, isNew: boolean, requests: RequestDraft[], editIntent: EditIntent[]) => {
  const response = await apiCall<CombatEntity | {entity: CombatEntity; createdRequests: unknown[]}>(`/content/${type}/${encodeURIComponent(entity.id)}`, {method: 'PUT', headers: isNew ? {'If-None-Match': '*'} : {'If-Match': etag}, body: JSON.stringify({entity, requests, editIntent})})
  return {value: 'entity' in response.value ? response.value.entity : response.value, etag: response.etag}
 },
 validateEntity: (type: CombatType, entity: CombatEntity, mode: 'create' | 'update', requests: RequestDraft[], editIntent: EditIntent[], signal?: AbortSignal) => post<Validation>('/validate-entity', {type, entity, mode, requests, editIntent}, signal),
 delete: (type: CombatType, id: string, etag: string) => apiCall<{ok: boolean}>(`/content/${type}/${encodeURIComponent(id)}`, {method: 'DELETE', headers: {'If-Match': etag}}),
 character: (character: Character, overrides: OverrideSet, context: ContextChoice, signal: AbortSignal) => post<CharacterValidation>('/character/validate', {character, overrides, ...(context ? {context} : {})}, signal),
 assemble: (body: AssemblyBody) => post<Assembly>('/assemble', body),
 run: (body: AssemblyBody) => post<TrialRun>('/trial/run', body, AbortSignal.timeout(30000)),
 compare: (trialId: string, variant: AssemblyBody) => post<Comparison>('/trial/compare', {baseline: {trialId}, variant}, AbortSignal.timeout(30000)),
 import: (kind: 'scenario' | 'expedition', sourceName: string, jsonText: string, prefix: string) => post<{ok: boolean; trialId: string; created: {type: string; id: string; path: string}[]; reused: {type: string; id: string; path: string}[]; source: {kind: string; name: string; sha256: string}}>(`/import-${kind}`, {sourceName, jsonText, ...(prefix ? {prefix} : {})}, AbortSignal.timeout(30000)),
 exportScenario: (trialId: string) => post<{ok: boolean; path: string; sha256: string; kind: string}>('/export-scenario', {trialId}),
}
export function errorsFrom(error: unknown): ContentError[] {
 if (typeof error === 'object' && error && 'body' in error) {const body = error.body as {errors?: ContentError[]}; if (body.errors) return body.errors}
 return []
}
