import {flowRuleId, type BaseModule, type BaseType} from './types'

export function baseRoute(type: BaseType, id?: string) {return `#/${type === 'building' || type === 'layout' ? 'map' : 'production'}/${type === 'rule' ? 'flows' : type}${id ? '/' + encodeURIComponent(id) : ''}`}
export function baseNavigate(type: BaseType | 'chain', id?: string, replace = false) {
 window.history[replace ? 'replaceState' : 'pushState'](null, '', type === 'chain' ? '#/production/chain' : baseRoute(type, id))
 window.dispatchEvent(new PopStateEvent('popstate'))
}
export function parseBaseRoute(): {module: BaseModule; type: BaseType | 'chain'; id?: string} | null {
 const [module, page, rawId] = window.location.hash.replace(/^#\/?/, '').split('/')
 if (module !== 'map' && module !== 'production') return null
 const type = module === 'map' ? page === 'building' ? 'building' : 'layout' : page === 'recipe' ? 'recipe' : page === 'flows' ? 'rule' : 'chain'
 return {module, type, id: rawId ? decodeURIComponent(rawId) : type === 'rule' ? flowRuleId : undefined}
}
