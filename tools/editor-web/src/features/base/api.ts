import {apiCall} from '../../api'
import type {RequestDraft, Validation} from '../../types'
import type {BaseEntity, BaseType, ChainAnalysis, Layout, LayoutCheck, LayoutDistance, Point} from './types'

const post = async <T,>(path: string, body: unknown, signal?: AbortSignal) => (await apiCall<T>(path, {method: 'POST', body: JSON.stringify(body), signal})).value
export const baseApi = {
 get: (type: BaseType, id: string) => apiCall<BaseEntity>(`/content/${type}/${encodeURIComponent(id)}`),
 save: async (type: BaseType, entity: BaseEntity, etag: string, isNew: boolean, requests: RequestDraft[]) => {
  const result = await apiCall<BaseEntity | {entity: BaseEntity}>(`/content/${type}/${encodeURIComponent(entity.id)}`, {method: 'PUT', headers: isNew ? {'If-None-Match': '*'} : {'If-Match': etag}, body: JSON.stringify({entity, requests})})
  return {value: 'entity' in result.value ? result.value.entity : result.value, etag: result.etag}
 },
 validate: (type: BaseType, entity: BaseEntity, mode: 'create' | 'update', requests: RequestDraft[], signal?: AbortSignal) => post<Validation>('/validate-entity', {type, mode, entity, requests}, signal),
 delete: (type: BaseType, id: string, etag: string) => apiCall<{ok: boolean}>(`/content/${type}/${encodeURIComponent(id)}`, {method: 'DELETE', headers: {'If-Match': etag}}),
 check: (layout: Layout, signal?: AbortSignal) => post<LayoutCheck>('/layout/check', {layout}, signal),
 distance: (layout: Layout, from: {instanceId: string} | Point, signal?: AbortSignal) => post<LayoutDistance>('/layout/distance', {layout, from}, signal),
 chain: async (signal?: AbortSignal) => (await apiCall<ChainAnalysis>('/chain', {signal})).value,
 importFirstMeal: () => post<{created: {type: string; id: string; path: string}[]; reused: {type: string; id: string; path: string}[]; source: {path: string; sha256: string}; layoutIds: string[]}>('/import-first-meal', {}, AbortSignal.timeout(30000)),
}
