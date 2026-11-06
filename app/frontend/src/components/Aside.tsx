import type { CSSProperties, ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Hexagon, Network, Library, FileText,
  Plug, TextSearch, HeartPulse, CircleCheck,
  Heart, BarChart3, Camera, LayoutGrid,
  Settings2, Info, Terminal,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import emitter from '../utils/eventBus'

/** 侧边栏菜单项（由 App 传入，component 由 App 自行消费） */
export interface AsideMenuItem {
  key: string
  label: ReactNode
  icon: string
}

const ICONS: Record<string, LucideIcon> = {
  HiveOutlined: Hexagon, AllOutOutlined: Network, LibraryBooksOutlined: Library,
  DescriptionOutlined: FileText, ApiOutlined: Plug, ManageSearchOutlined: TextSearch,
  MonitorHeartOutlined: HeartPulse, TaskAlt: CircleCheck, TerminalOutlined: Terminal,
  Favorite: Heart, BarChartOutlined: BarChart3, AddAPhoto: Camera,
  AutoAwesomeMotionOutlined: LayoutGrid, SettingsSuggestOutlined: Settings2,
  InfoOutlined: Info,
}

export default function Aside({ menus, active }: { menus: AsideMenuItem[]; active: string }) {
  return (
    <nav
      className="w-[60px] shrink-0 border-r bg-panel overflow-y-auto"
      style={{ '--wails-draggable': 'drag' } as CSSProperties}
    >
      <ul className="p-0" style={{ '--wails-draggable': 'no-drag' } as CSSProperties}>
        {menus.map(m => {
          const Icon = ICONS[m.icon] || Info
          return (
            <Tooltip key={m.key}>
              <TooltipTrigger asChild>
                <li
                  className={
                    'flex min-h-12 items-center justify-center px-2.5 cursor-pointer transition-colors ' +
                    (active === m.key
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')
                  }
                  onClick={() => emitter.emit('menu_select', m.key)}
                >
                  <Icon className="size-5" />
                </li>
              </TooltipTrigger>
              <TooltipContent side="right">{m.label}</TooltipContent>
            </Tooltip>
          )
        })}
      </ul>
    </nav>
  )
}
