import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const variants = cva('button inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-45', {
  variants: {
    variant: { default: 'bg-primary text-primary-foreground hover:brightness-95', outline: 'border border-border bg-background hover:bg-secondary', ghost: 'hover:bg-secondary text-foreground', danger: 'text-destructive border border-border hover:bg-secondary' },
    size: { default: 'h-8 px-3', sm: 'h-7 px-2 text-xs', icon: 'h-8 w-8 p-0' },
  }, defaultVariants: { variant: 'outline', size: 'default' },
})
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof variants> { asChild?: boolean }
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({className, variant, size, asChild, type = 'button', ...props}, ref) => {
  const Component = asChild ? Slot : 'button'
  return <Component ref={ref} type={type} className={cn(variants({variant, size}), className)} {...props} />
})
Button.displayName = 'Button'
