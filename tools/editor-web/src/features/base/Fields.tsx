import type {ReactNode} from 'react'
import {Plus, Trash2} from 'lucide-react'
import {Button} from '../../components/ui/button'
import {useEditorStore} from '../../store'
import type {ContentError} from '../../types'
import type {Material} from './types'

export function Field({name, label, hint, errors = [], children}: {name: string; label: string; hint?: string; errors?: ContentError[]; children: ReactNode}) {
 const issues = errors.filter(error => error.field === '/' + name.replaceAll('.', '/'))
 return <label className={`base-field ${issues.length ? 'invalid' : ''}`} data-field={name}><span>{label}</span>{children}{hint && <small>{hint}</small>}{issues.map((error, index) => <small className="field-error" key={index}>{error.message}</small>)}</label>
}
export function TextField({name, label, value, onChange, multiline, hint, errors}: {name: string; label: string; value?: string; onChange: (value: string) => void; multiline?: boolean; hint?: string; errors?: ContentError[]}) {
 return <Field name={name} label={label} hint={hint} errors={errors}>{multiline ? <textarea id={`base-field-${name}`} rows={3} value={value ?? ''} onChange={e => onChange(e.target.value)} /> : <input id={`base-field-${name}`} value={value ?? ''} onChange={e => onChange(e.target.value)} />}</Field>
}
export function NumberField({name, label, value, onChange, min, max, hint, errors}: {name: string; label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; hint?: string; errors?: ContentError[]}) {
 return <Field name={name} label={label} hint={hint} errors={errors}><input id={`base-field-${name}`} type="number" step="1" min={min} max={max} value={value} onChange={e => {if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) onChange(e.target.valueAsNumber)}} /></Field>
}
export function ItemSelect({value, onChange, label}: {value: string; onChange: (value: string) => void; label: string}) {
 const items = useEditorStore(s => s.items), exact = items.some(item => item.id === value), alias = items.find(item => item.aliases.includes(value))
 return <select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>{!exact && <option value={value}>{alias ? `${alias.name} · ${value} → ${alias.id}` : value ? `${value} · 未登记引用` : '选择物品'}</option>}{items.map(item => <option key={item.id} value={item.id}>{item.name} · {item.id}{item.draft ? ' · 草稿' : ''}</option>)}</select>
}
export function Materials({name, label, rows, onChange}: {name: string; label: string; rows: Material[]; onChange: (rows: Material[]) => void}) {
 return <section className="base-materials" data-field={name}><div className="base-section-title"><h3>{label}</h3><Button size="sm" onClick={() => onChange([...rows, {itemId: '', quantity: 1}])}><Plus size={13} />添加{label}</Button></div>{rows.map((row, index) => <div className="base-material-row" key={index}><div data-field={`${name}.${index}.itemId`}><ItemSelect label={`${label}${index + 1}物品`} value={row.itemId} onChange={itemId => onChange(rows.map((row, i) => i === index ? {...row, itemId} : row))} /></div><input data-field={`${name}.${index}.quantity`} aria-label={`${label}${index + 1}数量`} type="number" min="1" step="1" value={row.quantity} onChange={e => {if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) onChange(rows.map((row, i) => i === index ? {...row, quantity: e.target.valueAsNumber} : row))}} /><Button variant="ghost" size="icon" aria-label={`删除${label}${index + 1}`} onClick={() => onChange(rows.filter((_, i) => i !== index))}><Trash2 size={13} /></Button></div>)}{!rows.length && <p className="field-hint">尚未添加{label}。</p>}</section>
}
