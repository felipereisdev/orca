import * as React from 'react'
import * as ProgressPrimitive from 'radix-ui/progress'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/class-names'

const progressVariants = cva('relative w-full overflow-hidden rounded-full', {
  variants: {
    size: { default: 'h-2', thin: 'h-1' },
    tone: {
      default: 'bg-primary/20',
      working: 'bg-foreground/10',
      attention: 'bg-agent-question/20',
      success: 'bg-foreground/10',
      muted: 'bg-foreground/10',
      destructive: 'bg-foreground/10'
    }
  },
  defaultVariants: { size: 'default', tone: 'default' }
})

const progressIndicatorVariants = cva(
  'h-full w-full flex-1 transition-all duration-300 ease-out motion-reduce:transition-none',
  {
    variants: {
      tone: {
        default: 'bg-primary',
        // Agent state colors, as the sidebar's agent rows use them.
        working: 'bg-agent-working',
        attention: 'bg-agent-question',
        success: 'bg-status-success',
        muted: 'bg-muted-foreground/50',
        destructive: 'bg-destructive'
      }
    },
    defaultVariants: { tone: 'default' }
  }
)

function Progress({
  className,
  value,
  size,
  tone,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & VariantProps<typeof progressVariants>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      data-tone={tone ?? 'default'}
      value={value}
      className={cn(progressVariants({ size, tone }), className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={progressIndicatorVariants({ tone })}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
