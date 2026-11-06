import { useEffect, useState } from 'react'
import { t } from '@lingui/macro'
import { useLingui } from '@lingui/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toast } from '@/components/ui/sonner'
import { Moon, Sun } from 'lucide-react'
import { GetConfig, SaveConfig } from '../../wailsjs/go/config/AppConfig'
import { types } from '../../wailsjs/go/models'
import { GetProcessInfo } from '../../wailsjs/go/system/Update'
import { WindowSetSize } from '../../wailsjs/runtime'
import emitter from '../utils/eventBus'

export default function Settings() {
  const { i18n } = useLingui()

  // 设置页只编辑这几个字段；connects 由「集群」页面维护，
  // 加载配置后 state 里会带上它并在保存时原样回传
  const [config, setConfig] = useState<Pick<types.Config, 'width' | 'height' | 'language' | 'theme'>>({
    width: 1248,
    height: 768,
    language: 'zh-CN',
    theme: 'light',
  })
  const [theme, setTheme] = useState('light')
  const [sysInfo, setSysInfo] = useState('')

  const getSysInfo = async () => {
    setSysInfo(await GetProcessInfo())
  }

  useEffect(() => {
    (async () => {
      const loadedConfig = await GetConfig()
      if (loadedConfig) {
        // 历史配置里可能残留已下线的语言（如 ja），归一化后再渲染，
        // 否则下拉框会因为没有对应选项而显示空白
        if (!['zh-CN', 'en'].includes(loadedConfig.language)) {
          loadedConfig.language = 'zh-CN'
        }
        setConfig(loadedConfig)
        setTheme(loadedConfig.theme)
        i18n.activate(loadedConfig.language)
      }
      await getSysInfo()
    })()
  }, [])

  const languageOptions = [
    { label: t`中文`, value: 'zh-CN' },
    { label: t`English`, value: 'en' },
  ]

  const onLanguageChange = (value: string) => {
    i18n.activate(value)
    emitter.emit('change_language', value)
  }

  const saveConfig = async () => {
    // 断言只为补类型：运行时 config 是 GetConfig 返回的完整对象，本就带 connects
    const newConfig = { ...config, theme } as types.Config
    const err = await SaveConfig(newConfig)
    if (err !== '') {
      const msg = err
      toast.error(t`Save failed: ${msg}`)
      return
    }

    WindowSetSize(newConfig.width, newConfig.height)

    emitter.emit('update_theme', theme)
    toast.success(t`Saved successfully`)
    setConfig(await GetConfig())
  }

  const changeTheme = (checked: boolean) => {
    const value = checked ? 'dark' : 'light'
    setTheme(value)
    emitter.emit('update_theme', value)
  }

  return (
    <div className="flex flex-col gap-2 items-start">
      <h2>{t`Settings`}</h2>
      <div className="text-left">
        <div className="mb-4">
          <Label className="mb-1">{t`Window Width`}</Label>
          <Input
            type="number"
            className="w-[120px]"
            value={config.width}
            min={800}
            max={1920}
            onChange={(e) => setConfig({ ...config, width: Number(e.target.value) })}
          />
        </div>
        <div className="mb-4">
          <Label className="mb-1">{t`Window Height`}</Label>
          <Input
            type="number"
            className="w-[120px]"
            value={config.height}
            min={600}
            max={1080}
            onChange={(e) => setConfig({ ...config, height: Number(e.target.value) })}
          />
        </div>
        <div className="mb-4">
          <Label className="mb-1">{t`Language`}</Label>
          <Select
            value={config.language}
            onValueChange={(value) => {
              setConfig({ ...config, language: value })
              onLanguageChange(value)
            }}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {languageOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mb-4">
          <Label className="mb-1">{t`Theme`}</Label>
          <div className="flex items-center gap-2">
            <Sun className="size-4 text-warning" />
            <Switch checked={theme === 'dark'} onCheckedChange={changeTheme} />
            <Moon className="size-4 text-info" />
          </div>
        </div>
        <div className="flex gap-1">
          <Button onClick={saveConfig}>{t`Save Settings`}</Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button className="w-[100px]" onClick={getSysInfo}>
                {t`ProcessInfo`}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="whitespace-pre-wrap max-h-[400px] overflow-auto max-w-80 text-left">
              {sysInfo}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
