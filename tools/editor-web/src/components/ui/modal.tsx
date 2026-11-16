import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Button } from './button'
import { cn } from '../../lib/utils'

interface Props { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; children: ReactNode; className?: string; footer?: ReactNode }
export function Modal({open, onOpenChange, title, description, children, className, footer}: Props) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="modal-overlay" />
      <Dialog.Content className={cn('modal', className)}>
        <header className="modal-header">
          <div><Dialog.Title className="text-base font-medium">{title}</Dialog.Title><Dialog.Description className="mt-1 text-xs text-muted-foreground">{description}</Dialog.Description></div>
          <Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="关闭对话框"><X size={17} /></Button></Dialog.Close>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
