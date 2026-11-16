import {Field} from '../../components/Field'
import type {ContentError} from '../../types'

interface Base {name: string; label: string; hint?: string; errors?: ContentError[]; disabled?: boolean}
export function TextField({name, label, value, onChange, hint, errors, disabled, multiline}: Base & {value?: string; onChange: (value: string) => void; multiline?: boolean}) {
 const props = {id: `field-${name}`, value: value ?? '', disabled, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value)}
 return <Field name={name} label={label} hint={hint} errors={errors}>{multiline ? <textarea {...props} rows={3} /> : <input {...props} />}</Field>
}
export function NumberField({name, label, value, onChange, hint, errors, disabled, integer, min}: Base & {value?: number; onChange: (value: number) => void; integer?: boolean; min?: number}) {
 return <Field name={name} label={label} hint={hint} errors={errors}><input id={`field-${name}`} type="number" value={value ?? ''} disabled={disabled} step={integer ? 1 : 'any'} min={min} onChange={e => {if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) onChange(e.target.valueAsNumber)}} placeholder={value === undefined ? '未写入 · 保留原缺省' : undefined} /></Field>
}
export function SelectField({name, label, value, options, onChange, hint, errors, disabled}: Base & {value?: string; options: {id: string; label: string}[]; onChange: (value: string) => void}) {
 return <Field name={name} label={label} hint={hint} errors={errors}><select id={`field-${name}`} value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled}>{!options.some(o => o.id === value) && <option value={value || ''}>{value ? `${value} · 原值` : '未写入 · 保留原缺省'}</option>}{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></Field>
}
