import type {CombatCatalog, Condition, Option, Term} from './types'

const rowNames = ['前排', '中排', '后排']
function termSentence(term: Term, options: Option[]): string {
 const option = options.find(option => option.id === term.kind)
 const subject = term.subject === 'actor' ? '自身' : '目标'
 if (!option) return `${subject} · ${term.kind}（未实现）`
 const threshold = option.usesThreshold ? option.thresholdUnit === 'ratio' ? `${Number(((term.threshold ?? 0) * 100).toFixed(8))}%` : option.thresholdUnit === 'row' ? rowNames[term.threshold ?? 0] ?? String(term.threshold) : `${term.threshold ?? 0}${option.thresholdUnit === 'wait' ? ' WAIT' : ''}` : ''
 return `${subject} ${option.label}${threshold}${option.usesValue ? ` ${term.value ?? ''}` : ''}`
}
export function conditionSentence(condition: Condition, catalog: CombatCatalog): string {
 const terms = condition.terms.map(term => termSentence(term, catalog.conditions))
 if (condition.operation === 'mixed' && terms.length === 3) {const operators = condition.operators?.map(value => value === 'and' ? '且' : '或') || []; return condition.grouping === 'right' ? `${terms[0]} ${operators[0]} (${terms[1]} ${operators[1]} ${terms[2]})` : `(${terms[0]} ${operators[0]} ${terms[1]}) ${operators[1]} ${terms[2]}`}
 return terms.join(condition.operation === 'any' ? ' 或 ' : ' 且 ')
}
