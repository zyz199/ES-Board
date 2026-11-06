import type { ComponentProps } from 'react'
import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'

/** 替代 MUI CircularProgress 的加载指示器 */
function Spinner({ className, size = 24, ...props }: ComponentProps<typeof Loader2>) {
  return (
    <Loader2
      className={cn('animate-spin text-primary', className)}
      style={{ width: size, height: size }}
      {...props}
    />
  )
}

export { Spinner }
