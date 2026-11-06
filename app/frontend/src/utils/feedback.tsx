import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { t } from '@lingui/macro'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/**
 * 全局确认对话框
 * 用法：
 *   const confirm = useConfirm()
 *   if (!(await confirm({ title: t`Delete index`, content: name, type: 'error' }))) return
 */
export interface ConfirmOptions {
  title?: string
  content?: string
  type?: string
}

export type ConfirmFn = (options?: ConfirmOptions) => Promise<boolean>

// { title, content, type, resolve }
interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void
}

const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(true))

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null)

  const confirm = useCallback<ConfirmFn>((options = {}) => {
    return new Promise<boolean>((resolve) => {
      // 连续调用时先把上一次的 promise 以「取消」收尾，否则它会永远 pending，
      // 调用方的 await 会永久挂起
      setState((prev) => {
        prev?.resolve?.(false)
        return { ...options, resolve }
      })
    })
  }, [])

  const close = (result: boolean) => {
    state?.resolve?.(result)
    setState(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={!!state} onOpenChange={(v) => { if (!v) close(false) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{state?.title || t`Warning`}</DialogTitle>
            {state?.content && (
              <DialogDescription className="whitespace-pre-wrap break-all">
                {state.content}
              </DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)}>{t`Cancel`}</Button>
            <Button
              autoFocus
              variant={state?.type === 'error' ? 'destructive' : 'default'}
              onClick={() => close(true)}
            >
              {t`Confirm`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  return useContext(ConfirmContext)
}
