import {useCombatStore} from './store'
import type {CombatType} from './types'

export function combatNavigate(type: CombatType, id?: string, replace = false) {
 window.history[replace ? 'replaceState' : 'pushState'](null, '', `#/combat/${type}${id ? '/' + encodeURIComponent(id) : ''}`)
 const state = useCombatStore.getState()
 if (id === '_new') {if (state.current !== `${type}:_new`) state.create(type)}
 else if (id) void state.open(type, id)
 else useCombatStore.setState({type, current: '', errors: [], refs: []})
}
