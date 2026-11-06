import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ComponentType, MouseEvent } from 'react'
import { Download, Plus, Upload } from 'lucide-react'
import { t } from '@lingui/macro'
import { toast } from '@/components/ui/sonner'
import { Badge as BadgeBase } from '@/components/ui/badge'
import { Button as ButtonBase } from '@/components/ui/button'
import {
  Dialog as DialogBase, DialogContent as DialogContentBase, DialogDescription as DialogDescriptionBase,
  DialogFooter as DialogFooterBase, DialogHeader as DialogHeaderBase, DialogTitle as DialogTitleBase,
} from '@/components/ui/dialog'
import { Input as InputBase } from '@/components/ui/input'
import { Label as LabelBase } from '@/components/ui/label'
import { Spinner as SpinnerBase } from '@/components/ui/spinner'
import { Switch as SwitchBase } from '@/components/ui/switch'
import { Textarea as TextareaBase } from '@/components/ui/textarea'
import { useConfirm } from '../utils/feedback'
import { download_file } from '../utils/common'
import emitter from '../utils/eventBus'
import { SetConnect, TestClient } from '../../wailsjs/go/service/ESService'
import { GetConfig, SaveConfig } from '../../wailsjs/go/config/AppConfig'
import { types } from '../../wailsjs/go/models'

// src/components/ui/* 这批组件尚未标注 props，参数被推断成 className/variant/type 等必填，
// 会在 JSX 上误报“缺少属性”。这里在本地把用到的组件放宽为任意 props：纯类型断言，
// 运行时拿到的仍是同一个组件；等 ui/* 补上类型后可以整体删掉。
type UiComponent = ComponentType<Record<string, any>>
const Badge = BadgeBase as UiComponent
const Button = ButtonBase as UiComponent
const Dialog = DialogBase as UiComponent
const DialogContent = DialogContentBase as UiComponent
const DialogDescription = DialogDescriptionBase as UiComponent
const DialogFooter = DialogFooterBase as UiComponent
const DialogHeader = DialogHeaderBase as UiComponent
const DialogTitle = DialogTitleBase as UiComponent
const Input = InputBase as UiComponent
const Label = LabelBase as UiComponent
const Spinner = SpinnerBase as UiComponent
const Switch = SwitchBase as UiComponent
const Textarea = TextareaBase as UiComponent

// 表单态：新建的连接还没有 id，编辑/保存时才带上
type ConnectForm = Omit<types.Connect, 'id'> & { id?: number }

// useConfirm 的默认值是零参函数，这里按实际调用方式补上参数类型（仅类型）
type ConfirmFn = (options: { title?: string; content?: string; type?: string }) => Promise<boolean>

// 导出文件里单条连接的形状（username/password 可能不写入）
interface ExportConnect {
  name: string
  host: string
  useSSL: boolean
  skipSSLVerify: boolean
  caCert: string
  username?: string
  password?: string
}

// 导入文件里的原始条目：来自外部 JSON，字段不可信
type RawConnect = Record<string, unknown>
type ValidRawConnect = RawConnect & { name: string; host: string }

const defaultNode = (): ConnectForm => ({
  name: '',
  host: '',
  username: '',
  password: '',
  useSSL: false,
  skipSSLVerify: false,
  caCert: ''
})

export default function Conn() {
  const confirm = useConfirm() as ConfirmFn

  const [esNodes, setEsNodes] = useState<types.Connect[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null)
  const [showEditDrawer, setShowEditDrawer] = useState(false)
  const [currentNode, setCurrentNode] = useState<ConnectForm>(defaultNode())
  const [isEditing, setIsEditing] = useState(false)
  const [spin_loading, setSpinLoading] = useState(false)
  const [test_connect_loading, setTestConnectLoading] = useState(false)
  const [showExportDialog, setShowExportDialog] = useState(false)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    refreshNodeList()
  }, [])

  const refreshNodeList = async () => {
    setSpinLoading(true)
    try {
      const config = await GetConfig()
      setEsNodes(config.connects.filter(node => (node.name as string | null) !== null && node.name !== ''))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSpinLoading(false)
    }
  }

  function editNode(node: types.Connect) {
    setCurrentNode({ ...node })
    setIsEditing(true)
    setShowEditDrawer(true)
  }

  const addNewNode = () => {
    setCurrentNode(defaultNode())
    setIsEditing(false)
    setShowEditDrawer(true)
  }

  // 表单校验（对应 naive-ui form rules：name/host 必填）
  const validateForm = () => {
    if (!currentNode.name.trim() || !currentNode.host.trim()) {
      toast.error(t`Please fill in all required fields`)
      return false
    }
    return true
  }

  const saveNode = async () => {
    if (!validateForm()) return

    const config = await GetConfig()
    let nextNodes: types.Connect[]
    if (isEditing) {
      // edit
      nextNodes = esNodes.map(node => node.id === currentNode.id ? { ...currentNode } as types.Connect : node)
    } else {
      // add
      const newId = Math.max(...esNodes.map(node => node.id), 0) + 1
      nextNodes = [...esNodes, { ...currentNode, id: newId }]
    }
    setEsNodes(nextNodes)

    // 保存
    config.connects = nextNodes
    const err = await SaveConfig(config)
    if (err !== '') {
      toast.error(t`Save failed: ${err}`)
      return
    }
    setShowEditDrawer(false)
    await refreshNodeList()
    toast.success(t`Saved successfully`)
  }

  const deleteNode = async (id: number) => {
    const ok = await confirm({
      title: t`Delete`,
      content: t`Are you sure you want to delete?`,
      type: 'error',
    })
    if (!ok) return

    const nextNodes = esNodes.filter(node => node.id !== id)
    setEsNodes(nextNodes)
    const config = await GetConfig()
    config.connects = nextNodes
    const err = await SaveConfig(config)
    if (err !== '') {
      toast.error(t`Save failed: ${err}`)
      await refreshNodeList()
      return
    }
    if (selectedNodeId === id) {
      setSelectedNodeId(null)
    }
    await refreshNodeList()
    toast.success(t`Saved successfully`)
  }

  // ==================== 连接配置导出/导入 ====================

  const exportConn = () => {
    if (!esNodes.length) {
      toast.warning(t`No connections to export`)
      return
    }
    setShowExportDialog(true)
  }

  const doExport = (includePassword: boolean) => {
    setShowExportDialog(false)
    const connects = esNodes.map((node): ExportConnect => {
      const item: ExportConnect = {
        name: node.name,
        host: node.host,
        useSSL: !!node.useSSL,
        skipSSLVerify: !!node.skipSSLVerify,
        caCert: node.caCert || '',
      }
      if (node.username) {
        item.username = node.username
      }
      if (includePassword && node.password) {
        item.password = node.password
      }
      return item
    })
    const payload = {
      app: 'ES-King',
      type: 'es-king-connections',
      version: 1,
      exportedAt: new Date().toISOString(),
      connects,
    }
    const fileName = `es-king-connections-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
    download_file(JSON.stringify(payload, null, 2), fileName, 'application/json;charset=utf-8;')
    const count = connects.length
    toast.success(t`Exported ${count} connections`)
  }

  const triggerImport = () => {
    fileInputRef.current?.click()
  }

  const readAsText = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file, 'utf-8')
  })

  const onImportFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) {
      return
    }

    let list: RawConnect[] | null
    try {
      const data = JSON.parse(await readAsText(file))
      list = Array.isArray(data) ? data : (Array.isArray(data?.connects) ? data.connects : null)
    } catch {
      list = null
    }
    if (!list) {
      toast.error(t`Invalid file: please select a connections JSON exported from ES-King`)
      return
    }

    const valid = list.filter((node): node is ValidRawConnect => node && typeof node === 'object'
      && typeof node.name === 'string' && node.name.trim() !== ''
      && typeof node.host === 'string' && node.host.trim() !== '')
    if (!valid.length) {
      toast.warning(t`No valid connections in the file (missing name or host)`)
      return
    }

    const normalize = (node: ValidRawConnect): ConnectForm => ({
      name: node.name.trim(),
      host: node.host.trim(),
      username: typeof node.username === 'string' ? node.username : '',
      password: typeof node.password === 'string' ? node.password : '',
      useSSL: !!node.useSSL,
      skipSSLVerify: !!node.skipSSLVerify,
      caCert: typeof node.caCert === 'string' ? node.caCert : '',
    })

    // 同名连接直接更新覆盖；空字段保留原值（如"不包含密码"导出的文件不会清掉已保存的密码）
    const byName = new Map<string, ConnectForm>(esNodes.map((node): [string, ConnectForm] => [node.name, node]))
    const toAdd: ConnectForm[] = []
    const updatedNodes: types.Connect[] = [...esNodes]
    let updated = 0
    for (const raw of valid) {
      const node = normalize(raw)
      const exist = byName.get(node.name)
      if (exist) {
        exist.host = node.host
        if (node.username) {
          exist.username = node.username
        }
        if (node.password) {
          exist.password = node.password
        }
        if (node.caCert) {
          exist.caCert = node.caCert
        }
        if ('useSSL' in raw) {
          exist.useSSL = node.useSSL
        }
        if ('skipSSLVerify' in raw) {
          exist.skipSSLVerify = node.skipSSLVerify
        }
        updated += 1
      } else {
        byName.set(node.name, node)
        toAdd.push(node)
      }
    }

    let nextId = Math.max(...esNodes.map(node => node.id), 0)
    for (const node of toAdd) {
      nextId += 1
      updatedNodes.push({ ...node, id: nextId })
    }
    setEsNodes(updatedNodes)

    const config = await GetConfig()
    config.connects = updatedNodes
    const err = await SaveConfig(config)
    if (err !== '') {
      toast.error(t`Save failed: ${err}`)
      await refreshNodeList()
      return
    }
    await refreshNodeList()
    if (toAdd.length) {
      const count = toAdd.length
      toast.success(t`Added ${count} connections, updated ${updated} with the same name`)
    } else {
      const count = updated
      toast.success(t`Updated ${count} existing connections, nothing added`)
    }
  }

  const test_connect = async () => {
    if (!validateForm()) return

    setTestConnectLoading(true)
    try {
      const node = currentNode
      const res = await TestClient(node.host, node.username, node.password, node.caCert, node.useSSL, node.skipSSLVerify)
      if (res !== '') {
        toast.error(t`Connection failed: ${res}`)
      } else {
        toast.success(t`Connection successful`)
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
    setTestConnectLoading(false)
  }

  const selectNode = async (node: types.Connect) => {
    setSpinLoading(true)

    try {
      const res = await TestClient(node.host, node.username, node.password, node.caCert, node.useSSL, node.skipSSLVerify)
      if (res !== '') {
        toast.error(t`Connection failed: ${res}`)
      } else {
        await SetConnect(node.name, node.host, node.username, node.password, node.caCert, node.useSSL, node.skipSSLVerify)
        setSelectedNodeId(node.id)
        toast.success(t`Connection successful`)
        emitter.emit('menu_select', 'nodes')
        emitter.emit('selectNode', node)
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
    setSpinLoading(false)
  }

  const drawerTitle = isEditing ? t`Edit Connection` : t`Add Connection`

  return (
    <div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2>{t`Cluster`}</h2>
          <p>{(() => { const count = esNodes.length; return t`${count} in total` })()}</p>
          <Button variant="default" onClick={addNewNode}><Plus className="size-4" />{t`Add Cluster`}</Button>
          <Button variant="default" onClick={triggerImport}><Upload className="size-4" />{t`Import`}</Button>
          <Button variant="default" onClick={exportConn}><Download className="size-4" />{t`Export`}</Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={onImportFileChange}
          />
        </div>

        <div className="relative min-h-[100px]">
          {spin_loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1">
              <Spinner size={28} />
              <p className="text-[13px]">{t`Connecting...`}</p>
            </div>
          )}

          <div className="grid grid-cols-4 gap-3">
            {esNodes.map(node => (
              <div
                key={node.id}
                onClick={() => selectNode(node)}
                className={`conn_card rounded-lg border bg-card p-0 cursor-pointer transition-[border-color,box-shadow,transform] duration-200 hover:border-[#36ad6a] hover:shadow-[0_4px_14px_rgba(24,160,88,.25)] hover:-translate-y-0.5 active:translate-y-0${selectedNodeId === node.id ? ' conn_card_selected border-[#18a058] shadow-[inset_0_0_0_1px_#18a058,0_4px_14px_rgba(24,160,88,.3)]' : ''}`}
              >
                <div className="p-4">
                  <div className="flex items-center justify-between gap-1">
                    <div className="font-semibold truncate">{node.name}</div>
                    <div className="flex items-center gap-1">
                      {selectedNodeId === node.id && (
                        <Badge variant="success">{t`Connected`}</Badge>
                      )}
                      <Button size="sm" variant="outline" onClick={(e: MouseEvent) => { e.stopPropagation(); editNode(node) }}>
                        {t`Edit`}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        onClick={(e: MouseEvent) => { e.stopPropagation(); deleteNode(node.id) }}
                      >
                        {t`Delete`}
                      </Button>
                    </div>
                  </div>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {t`Protocol://Host:Port`}: {node.host}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 编辑/新增连接抽屉 */}
      {showEditDrawer && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowEditDrawer(false)} />
          <div className="absolute inset-y-0 right-0 w-[38.2%] bg-background shadow-xl flex flex-col">
            <div className="p-6 text-left overflow-y-auto flex-1">
              <div className="font-semibold text-lg mb-2">{drawerTitle}</div>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label>
                    {t`Nickname`} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={currentNode.name}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setCurrentNode({ ...currentNode, name: e.target.value })}
                    placeholder={t`Enter node name`}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>
                    {t`Protocol://Host:Port`} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={currentNode.host}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setCurrentNode({ ...currentNode, host: e.target.value })}
                    placeholder={t`Enter protocol://host:port`}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t`Username`}</Label>
                  <Input
                    value={currentNode.username}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setCurrentNode({ ...currentNode, username: e.target.value })}
                    placeholder={t`Enter username`}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t`Password`}</Label>
                  <Input
                    type="password"
                    value={currentNode.password}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setCurrentNode({ ...currentNode, password: e.target.value })}
                    placeholder={t`Enter password`}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <p>{t`Use SSL`}</p>
                  <Switch
                    checked={!!currentNode.useSSL}
                    onCheckedChange={(v: boolean) => setCurrentNode({ ...currentNode, useSSL: v })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <p>{t`Skip SSL Verify`}</p>
                  <Switch
                    checked={!!currentNode.skipSSLVerify}
                    onCheckedChange={(v: boolean) => setCurrentNode({ ...currentNode, skipSSLVerify: v })}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>{t`CA Certificate`}</Label>
                  <Textarea
                    rows={4}
                    value={currentNode.caCert}
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setCurrentNode({ ...currentNode, caCert: e.target.value })}
                    placeholder={t`Enter CA certificate content`}
                  />
                </div>
              </div>
            </div>
            <div className="absolute bottom-0 left-0 right-0 p-4 flex justify-end gap-2 bg-background border-t">
              <Button variant="ghost" onClick={test_connect} disabled={test_connect_loading}>{t`Test Connection`}</Button>
              <Button variant="ghost" onClick={() => setShowEditDrawer(false)}>{t`Cancel`}</Button>
              <Button variant="default" onClick={saveNode}>{t`Save`}</Button>
            </div>
          </div>
        </div>
      )}

      {/* 导出确认（三选项：包含密码 / 不包含 / 取消） */}
      <Dialog open={showExportDialog} onOpenChange={(v: boolean) => { if (!v) setShowExportDialog(false) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t`Export connections`}</DialogTitle>
            <DialogDescription>
              {t`Include passwords in the export file? Keep the file safe if passwords are included.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowExportDialog(false)}>{t`Cancel`}</Button>
            <Button variant="outline" onClick={() => doExport(false)}>{t`Without passwords`}</Button>
            <Button variant="default" onClick={() => doExport(true)}>{t`Include passwords`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
