import type { ReactNode } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import type { ContentError } from '../types'

interface Props { name: string; label: string; children: ReactNode; errors?: ContentError[]; hint?: string; onNote?: (field: string) => void; className?: string }
export function Field({name, label, children, errors = [], hint, onNote, className = ''}: Props) {
  const pointer = `/${name.replaceAll('.', '/')}`
  const matches = errors.filter(error => error.field === pointer || error.field?.startsWith(`${pointer}/`) || error.path.endsWith(pointer) || error.code === name || error.message.startsWith(`${name} `))
  return <div className={`field ${className}`} data-field={name}>
    <div className="field-label-row"><label htmlFor={`field-${name}`}>{label}</label>{onNote && <button type="button" className="field-note" title={`为${label}添加备注`} aria-label={`为${label}添加备注`} onClick={() => onNote(name)}><MessageSquarePlus size={13} /></button>}</div>
    {children}
    {hint && <p className="field-hint">{hint}</p>}
    {matches.map((error, index) => <p className="field-error" role="alert" key={`${error.code}-${index}`}>{error.message}</p>)}
  </div>
}
