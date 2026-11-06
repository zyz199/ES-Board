import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { t } from '@lingui/macro'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { ConfirmProvider } from './utils/feedback'
import { setLocale, SUPPORTED } from './i18n'
import emitter from './utils/eventBus'
import { GetConfig } from '../wailsjs/go/config/AppConfig'

import Header from './components/Header'
import Aside from './components/Aside'
import Conn from './components/Conn'
import Nodes from './components/Nodes'
import Index from './components/Index'
import Docs from './components/Docs'
import Rest from './components/Rest'
import DevTool from './components/DevTool'
import Analyze from './components/Analyze'
import Diag from './components/Diag'
import Task from './components/Task'
import Health from './components/Health'
import Core from './components/Core'
import Snapshot from './components/Snapshot'
import Templates from './components/Templates'
import Settings from './components/Settings'

export default function App() {
  const [active, setActive] = useState('cluster')
  const [visited, setVisited] = useState(new Set(['cluster']))

  // 菜单标签统一走 t 宏（msgid 即宏生成的哈希，与 catalog 的 key 一致）
  const menus = [
    { key: 'cluster', label: t`Cluster`, icon: 'HiveOutlined', component: Conn },
    { key: 'nodes', label: t`Nodes`, icon: 'AllOutOutlined', component: Nodes },
    { key: 'index', label: t`Index`, icon: 'LibraryBooksOutlined', component: Index },
    { key: 'docs', label: t`Docs`, icon: 'DescriptionOutlined', component: Docs },
    { key: 'rest', label: 'REST', icon: 'ApiOutlined', component: Rest },
    { key: 'devtool', label: t`Dev Tools`, icon: 'TerminalOutlined', component: DevTool },
    { key: 'analyze', label: t`Analyze`, icon: 'ManageSearchOutlined', component: Analyze },
    { key: 'diag', label: t`Diagnose`, icon: 'MonitorHeartOutlined', component: Diag },
    { key: 'task', label: 'Task', icon: 'TaskAlt', component: Task },
    { key: 'health', label: t`Health`, icon: 'Favorite', component: Health },
    { key: 'metrics', label: t`Metrics`, icon: 'BarChartOutlined', component: Core },
    { key: 'snapshot', label: t`Snapshot`, icon: 'AddAPhoto', component: Snapshot },
    { key: 'templates', label: t`Templates`, icon: 'AutoAwesomeMotionOutlined', component: Templates },
    { key: 'settings', label: t`Settings`, icon: 'SettingsSuggestOutlined', component: Settings },
  ]

  // 主题切换（把 naive-ui 的 theme name 归一为 light/dark），dark class 挂在 <html> 上
  function applyTheme(name: string) {
    const next = name === 'dark' ? 'dark' : 'light'
    document.documentElement.classList.toggle('dark', next === 'dark')
  }

  useEffect(() => {
    (async () => {
      try {
        const loaded = await GetConfig()
        if (loaded) {
          applyTheme(loaded.theme)
          if (SUPPORTED.includes(loaded.language)) {
            setLocale(loaded.language)
          }
        }
      } catch {
        // dev 浏览器里没有 wails runtime 时静默失败
      }
    })()

    emitter.on('update_theme', applyTheme)
    const onMenuSelect = (key: string) => {
      setActive(key)
      setVisited(prev => new Set(prev).add(key))
    }
    const onChangeLanguage = (lang: string) => setLocale(lang)
    emitter.on('menu_select', onMenuSelect)
    emitter.on('change_language', onChangeLanguage)
    return () => {
      emitter.off('update_theme', applyTheme)
      // 必须带 handler：不带会清掉同名事件的所有监听（如 DevTool 也监听 menu_select）
      emitter.off('menu_select', onMenuSelect)
      emitter.off('change_language', onChangeLanguage)
    }
  }, [])

  return (
    <TooltipProvider>
      <ConfirmProvider>
        <div className="h-screen flex flex-col bg-background text-foreground">
          {/* --wails-draggable 是 Wails 自定义属性，不在 CSSProperties 里，需断言 */}
          <div className="h-[42px] shrink-0" style={{ '--wails-draggable': 'drag' } as CSSProperties}>
            <Header />
          </div>
          <div className="flex flex-1 min-h-0">
            <Aside menus={menus} active={active} />
            <div className="flex-1 min-w-0 overflow-auto px-4">
              {/* keep-alive：首次访问后常驻，display 切换保状态 */}
              {menus.map(m =>
                visited.has(m.key) ? (
                  <div
                    key={m.key}
                    className="pt-1"
                    style={{ display: m.key === active ? 'block' : 'none' }}
                  >
                    <m.component />
                  </div>
                ) : null,
              )}
            </div>
          </div>
        </div>
        <Toaster />
      </ConfirmProvider>
    </TooltipProvider>
  )
}
