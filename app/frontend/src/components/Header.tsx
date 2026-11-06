import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  House, RefreshCw, Minus, X, Square, Copy,
} from 'lucide-react'
import { toast } from '@/components/ui/sonner'
import { t } from '@lingui/macro'
import icon from '../assets/images/appicon.png'
import {
  BrowserOpenURL, Quit, WindowMaximise, WindowMinimise, WindowUnmaximise,
} from '../../wailsjs/runtime'
import { CheckUpdate } from '../../wailsjs/go/system/Update'
import { GetVersion, GetAppName } from '../../wailsjs/go/config/AppConfig'
import { openUrl } from '../utils/common'
import emitter from '../utils/eventBus'

const update_url = 'https://github.com/zyz199/ES-Board/releases'

// 版本更新提示的存活时长：5 秒后自动消失
const UPDATE_TOAST_DURATION = 5000

export default function Header() {
  const [isMaximized, setIsMaximized] = useState(false)
  const [titleTag, setTitleTag] = useState('success')
  const [subtitle, setSubtitle] = useState('')
  const [appName, setAppName] = useState('')
  const [updateLoading, setUpdateLoading] = useState(false)

  const versionRef = useRef('')

  async function checkForUpdates() {
    setUpdateLoading(true)
    try {
      const v = await GetVersion()
      versionRef.current = v
      setSubtitle(`${t`A more user-friendly ES GUI`} ${v}`)
      const resp = await CheckUpdate()
      if (!resp) {
        toast.error(t`Cannot connect to GitHub, check update failed`, {
          duration: UPDATE_TOAST_DURATION,
        })
      } else if (resp.tag_name !== v) {
        const tag = resp.tag_name
        toast.success(t`New version found: ${tag}`, {
          duration: UPDATE_TOAST_DURATION,
          action: {
            label: t`Download Now`,
            onClick: () => BrowserOpenURL(update_url),
          },
        })
      }
    } catch (e) {
      // 按钮 onClick 路径（区别于挂载时的 catch）：避免 unhandled rejection
      const err = e as Error
      toast.error(err?.message || String(err), { duration: UPDATE_TOAST_DURATION })
    } finally {
      setUpdateLoading(false)
    }
  }

  useEffect(() => {
    const selectNode = (node: { name: string }) => {
      const name = node.name
      setSubtitle(t`Current cluster: [${name}]`)
    }
    const changeTitleType = (type: string) => setTitleTag(type)

    emitter.on('selectNode', selectNode)
    emitter.on('changeTitleType', changeTitleType)

    ;(async () => {
      try {
        setAppName(await GetAppName())
        await checkForUpdates()
      } catch {
        // dev 浏览器中无 wails runtime
      }
    })()

    return () => {
      emitter.off('selectNode', selectNode)
      emitter.off('changeTitleType', changeTitleType)
    }
  }, [])

  const resizeWindow = () => {
    if (!isMaximized) {
      WindowMaximise()
    } else {
      WindowUnmaximise()
    }
    setIsMaximized(!isMaximized)
  }

  const status = titleTag

  return (
    <header
      className="h-full flex items-center px-2 border-b bg-panel"
      style={{ '--wails-draggable': 'drag' } as CSSProperties}
    >
      <img src={icon} alt="logo" className="w-8.5 h-8.5 mx-2" />
      <div className="text-lg font-extrabold mr-2">{appName}</div>
      {subtitle && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant={titleTag === 'success' ? 'success' : 'warning'}>{subtitle}</Badge>
          </TooltipTrigger>
          <TooltipContent>{t`Health: ${status}`}</TooltipContent>
        </Tooltip>
      )}
      <div className="flex-1" style={{ '--wails-draggable': 'no-drag' } as CSSProperties} />
      <div className="flex items-center" style={{ '--wails-draggable': 'no-drag' } as CSSProperties}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={() => openUrl(update_url)}>
              <House />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t`Home`}</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="icon" disabled={updateLoading} onClick={checkForUpdates}>
          <RefreshCw />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => WindowMinimise()}>
          <Minus />
        </Button>
        <Button variant="ghost" size="icon" onClick={resizeWindow}>
          {isMaximized ? <Copy /> : <Square />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="hover:bg-destructive hover:text-white"
          onClick={() => Quit()}
        >
          <X />
        </Button>
      </div>
    </header>
  )
}
