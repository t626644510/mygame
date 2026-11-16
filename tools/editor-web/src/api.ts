import type { Capabilities, Catalog, ContentError, EntitySummary, IdResult, Item, Reference, RequestDraft, RequestRecord, Validation } from './types'

export interface ApiFailure { ok?: boolean; error?: string; errors?: ContentError[]; current?: Item; etag?: string; refs?: Reference[] }
export class ApiError extends Error {
  constructor(public status: number, public body: ApiFailure, public etag: string) {
    super(body.error || body.errors?.map(error => error.message).join('\n') || `HTTP ${status}`)
  }
}
async function call<T>(path: string, init?: RequestInit): Promise<{ value: T; etag: string }> {
  const response = await fetch(`/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers }, signal: init?.signal || AbortSignal.timeout(4000) })
  const body = await response.json()
  if (!response.ok) throw new ApiError(response.status, body, response.headers.get('ETag') || body.etag || '')
  return { value: body as T, etag: response.headers.get('ETag') || '' }
}
const json = (value: unknown) => JSON.stringify(value)
export {call as apiCall}
export const api = {
  health: async (signal?: AbortSignal) => (await call<{ok: boolean; version: string; contentRoot: string; gitCommit: string}>('/health', {signal})).value,
  catalog: async () => (await call<Catalog>('/catalog')).value,
  capabilities: async () => (await call<Capabilities>('/capabilities')).value,
  list: async (type = 'item') => (await call<EntitySummary[]>(`/content/${type}`)).value,
  getAny: async (type: string, id: string) => (await call<{id: string; name?: string; title?: string; displayName?: string; aliases?: string[]}>(`/content/${type}/${encodeURIComponent(id)}`)).value,
  get: (id: string) => call<Item>(`/content/item/${encodeURIComponent(id)}`),
  ids: async (id: string) => (await call<IdResult>(`/ids/${encodeURIComponent(id)}`)).value,
  refs: async (id: string) => (await call<Reference[]>(`/refs/${encodeURIComponent(id)}`)).value,
  requests: async () => (await call<RequestRecord[]>('/requests')).value,
  request: async (request: RequestDraft) => (await call<RequestRecord>('/requests', {method: 'POST', body: json(request)})).value,
  save: async (item: Item, etag: string, isNew: boolean, requests: RequestDraft[] = []) => {
    const result = await call<Item | {entity: Item; createdRequests: RequestRecord[]}>(`/content/item/${encodeURIComponent(item.id)}`, {
    method: 'PUT', headers: isNew ? {'If-None-Match': '*'} : {'If-Match': etag}, body: json(requests.length ? {entity: item, requests} : item),
    })
    return {value: 'entity' in result.value ? result.value.entity : result.value, etag: result.etag}
  },
  delete: async (id: string, etag: string) => (await call<{ok: boolean}>(`/content/item/${encodeURIComponent(id)}`, {method: 'DELETE', headers: {'If-Match': etag}})).value,
  validate: async () => (await call<Validation>('/validate-content', {method: 'POST', body: '{}'})).value,
  validateItem: async (entity: Item, mode: 'create' | 'update', requests: RequestDraft[]) => (await call<Validation>('/validate-item', {method: 'POST', body: json({entity, mode, requests: requests.map(request => ({...request, target: `item:${entity.id}`}))})})).value,
  export: async () => (await call<{ok: boolean; contentHash: string; files: {path: string; sha256: string; count: number}[]}>('/export', {method: 'POST', body: '{}'})).value,
}
