import {useEffect, useRef} from 'react'
import {useVirtualizer} from '@tanstack/react-virtual'
import type {Step} from './types'

export function RunTimeline({steps, selected, onSelect}: {steps: Step[]; selected: number; onSelect: (index: number) => void}) {
 const actors = [...new Map(steps.filter(s => s.actorId).map(s => [s.actorId, s.actorName || s.actorId])).entries()]
 const maxTime = Math.max(1, ...steps.map(step => step.time)), height = 42 + actors.length * 30
 return <div className="run-timeline" aria-label="WAIT 时间轴"><svg viewBox={`0 0 1000 ${height}`} role="img" aria-label="每个单位一条泳道，事件位置取核心 WAIT"><text x="105" y="13">WAIT 0</text><text x="950" y="13" textAnchor="end">{maxTime}</text>{actors.map(([id, name], index) => <g key={id}><text x="100" y={40 + index * 30} textAnchor="end">{name}</text><line x1="116" x2="970" y1={36 + index * 30} y2={36 + index * 30} /></g>)}{steps.map((step, index) => {const actor = actors.findIndex(([id]) => id === step.actorId); if (actor < 0) return null; return <circle key={index} cx={116 + step.time / maxTime * 854} cy={36 + actor * 30} r={index === selected ? 7 : 4} className={`${step.status.toLowerCase().includes('expir') ? 'expired' : step.status === 'Executed' ? 'executed' : 'skipped'} ${index === selected ? 'selected' : ''}`} onClick={() => onSelect(index)} tabIndex={0} role="button" aria-label={`WAIT ${step.time} ${step.actorName} ${step.actionName || step.status}`} onKeyDown={event => {if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); onSelect(index)}}}><title>{step.time} · {step.message}</title></circle>})}</svg></div>
}
export function StepList({steps, selected, onSelect}: {steps: Step[]; selected: number; onSelect: (index: number) => void}) {
 const ref = useRef<HTMLDivElement>(null)
 const virtual = useVirtualizer({count: steps.length, getScrollElement: () => ref.current, estimateSize: () => 42, overscan: 6})
 // Selection is an explicit local action; scrolling never requests another simulation.
 useEffect(() => {if (steps.length) {const frame = requestAnimationFrame(() => virtual.scrollToIndex(selected, {align: 'auto'})); return () => cancelAnimationFrame(frame)}}, [selected, steps.length, virtual])
 return <div className="combat-steps" ref={ref} aria-label="战斗步骤列表"><div style={{height: virtual.getTotalSize(), position: 'relative'}}>{virtual.getVirtualItems().map(row => {const step = steps[row.index]; return <button key={row.key} data-step-index={step.index} className={`combat-step ${selected === row.index ? 'selected' : ''}`} style={{transform: `translateY(${row.start}px)`, height: row.size}} onClick={() => onSelect(row.index)}><span className="mono">{step.time}</span><span><strong>{step.actorName || '系统'}</strong><small>{step.actionName || step.status}</small></span><span>{step.message}</span><code>#{step.index}</code></button>})}</div></div>
}
