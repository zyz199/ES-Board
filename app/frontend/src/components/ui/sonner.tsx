import type { CSSProperties } from 'react'
import { Toaster as Sonner, toast } from 'sonner'
import type { ToasterProps } from 'sonner'

/**
 * 替代 notistack 的全局 Toast。
 * 用法：toast.success('...') / toast.error('...') / toast.info('...') / toast.warning('...')
 */
function Toaster({ position = 'top-center', ...props }: ToasterProps) {
  return (
    <Sonner
      position={position}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'text-[13px]',
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
