import {useState, type ReactNode} from 'react'
import {DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter} from '@dnd-kit/core'
import {SortableContext, useSortable, arrayMove, verticalListSortingStrategy, sortableKeyboardCoordinates} from '@dnd-kit/sortable'
import {CSS} from '@dnd-kit/utilities'
import {GripVertical} from 'lucide-react'

interface Row {id: string}
interface Props<T extends Row> {items: T[]; onReorder: (items: T[]) => void; render: (item: T, index: number) => ReactNode; capacity?: number; capacityLabel?: string; highlighted?: string; disabled?: boolean}
function SortableRow({id, index, children, overCapacity, highlighted, disabled}: {id: string; index: number; children: ReactNode; overCapacity: boolean; highlighted: boolean; disabled?: boolean}) {
 const {attributes, listeners, setNodeRef, transform, transition, isDragging} = useSortable({id, disabled})
 return <article ref={setNodeRef} style={{transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined}} className={`combat-rule ${overCapacity ? 'over-capacity' : ''} ${highlighted ? 'highlighted' : ''} ${isDragging ? 'dragging' : ''}`} data-instruction-id={id}>
  <button className="rule-grip" {...attributes} {...listeners} aria-label={`拖动第 ${index + 1} 条指令`} title="拖动排序，或按空格后用方向键移动，再按空格确认" disabled={disabled}><GripVertical size={16} /></button><span className="rule-number mono">{index + 1}</span><div className="rule-content">{children}</div>
 </article>
}
export function RuleList<T extends Row>({items, onReorder, render, capacity, capacityLabel, highlighted, disabled}: Props<T>) {
 const [announcement, setAnnouncement] = useState('')
 const sensors = useSensors(useSensor(PointerSensor, {activationConstraint: {distance: 5}}), useSensor(KeyboardSensor, {coordinateGetter: sortableKeyboardCoordinates}))
 return <><p className="sr-only" role="status">{announcement}</p><DndContext sensors={sensors} collisionDetection={closestCenter} accessibility={{screenReaderInstructions: {draggable: '按空格或回车拾起，用方向键移动，按空格或回车放下，Esc取消。'}}} onDragEnd={({active, over}) => {if (over && active.id !== over.id) {const from = items.findIndex(item => item.id === active.id), to = items.findIndex(item => item.id === over.id); onReorder(arrayMove(items, from, to)); setAnnouncement(`指令已从第 ${from + 1} 条移至第 ${to + 1} 条`)}}}>
  <SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}><div className="combat-rule-list">{items.map((item, index) => <div key={item.id}>{capacity !== undefined && index === capacity && <div className="capacity-divider" data-testid="capacity-divider">以下超出指令槽{capacityLabel ? `（${capacityLabel}）` : ''}</div>}<SortableRow id={item.id} index={index} overCapacity={capacity !== undefined && index >= capacity} highlighted={highlighted === item.id} disabled={disabled}>{render(item, index)}</SortableRow></div>)}</div></SortableContext>
 </DndContext></>
}
