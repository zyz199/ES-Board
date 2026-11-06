import { useEffect, useState } from 'react'
import type { ChangeEvent, ComponentType } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { t } from '@lingui/macro'
import { toast } from '@/components/ui/sonner'
import { Button as ButtonBase } from '@/components/ui/button'
import { DataTable as DataTableBase } from '@/components/ui/data-table'
import {
  Dialog as DialogBase, DialogContent as DialogContentBase,
  DialogFooter as DialogFooterBase, DialogHeader as DialogHeaderBase, DialogTitle as DialogTitleBase,
} from '@/components/ui/dialog'
import { Input as InputBase } from '@/components/ui/input'
import { Label as LabelBase } from '@/components/ui/label'
import { Spinner as SpinnerBase } from '@/components/ui/spinner'
import { Tabs as TabsBase, TabsList as TabsListBase, TabsTrigger as TabsTriggerBase } from '@/components/ui/tabs'
import { Textarea as TextareaBase } from '@/components/ui/textarea'
import { useConfirm } from '../utils/feedback'
import emitter from '../utils/eventBus'
import {
  CreateIndexTemplate,
  DeleteIndexTemplate,
  GetComponentTemplates,
  GetIndexTemplates,
} from '../../wailsjs/go/service/ESService'

// src/components/ui/* 这批组件尚未标注 props，参数被推断成 className/onRowClick 等必填，
// 会在 JSX 上误报“缺少属性”。这里在本地把用到的组件放宽为任意 props：纯类型断言，
// 运行时拿到的仍是同一个组件；等 ui/* 补上类型后可以整体删掉。
type UiComponent = ComponentType<Record<string, any>>
const Button = ButtonBase as UiComponent
const DataTable = DataTableBase as UiComponent
const Dialog = DialogBase as UiComponent
const DialogContent = DialogContentBase as UiComponent
const DialogFooter = DialogFooterBase as UiComponent
const DialogHeader = DialogHeaderBase as UiComponent
const DialogTitle = DialogTitleBase as UiComponent
const Input = InputBase as UiComponent
const Label = LabelBase as UiComponent
const Spinner = SpinnerBase as UiComponent
const Tabs = TabsBase as UiComponent
const TabsList = TabsListBase as UiComponent
const TabsTrigger = TabsTriggerBase as UiComponent
const Textarea = TextareaBase as UiComponent

// 表格行：接口返回的 results 是 any[]，这里按页面用到的字段声明局部形状
interface IndexTemplateRow {
  name: string
  index_patterns?: unknown
  composed_of?: unknown
  priority?: unknown
  version?: unknown
  _template?: Record<string, any>
}

interface ComponentTemplateRow {
  name: string
  version?: unknown
  _template?: Record<string, any>
}

// useConfirm 的默认值是零参函数，这里按实际调用方式补上参数类型（仅类型）
type ConfirmFn = (options: { title?: string; content?: string; type?: string }) => Promise<boolean>

const renderPatternList = (patterns: unknown) => {
  if (!Array.isArray(patterns) || patterns.length === 0) return '-'
  return patterns.join(', ')
}

export default function Templates() {
  const confirm = useConfirm() as ConfirmFn

  const [tab, setTab] = useState('indexTemplate')

  // ==================== 索引模板 ====================
  const [tplData, setTplData] = useState<IndexTemplateRow[]>([])
  const [tplLoading, setTplLoading] = useState(false)

  const getTemplates = async () => {
    setTplLoading(true)
    try {
      const res = await GetIndexTemplates()
      if (res.err !== '') {
        toast.error(res.err)
      } else {
        setTplData(res.results || [])
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setTplLoading(false)
    }
  }

  // ==================== 组件模板 ====================
  const [compData, setCompData] = useState<ComponentTemplateRow[]>([])
  const [compLoading, setCompLoading] = useState(false)

  const getComponentTemplates = async () => {
    setCompLoading(true)
    try {
      const res = await GetComponentTemplates()
      if (res.err !== '') {
        toast.error(res.err)
      } else {
        setCompData(res.results || [])
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCompLoading(false)
    }
  }

  // ==================== 模板详情 ====================
  const [detail, setDetail] = useState({ show: false, title: '', content: '' })

  const viewTemplateDetail = (row: IndexTemplateRow) => {
    const body = {
      index_patterns: row.index_patterns,
      composed_of: row.composed_of,
      priority: row.priority,
      version: row.version,
      template: row._template,
    }
    setDetail({
      show: true,
      title: row.name,
      content: JSON.stringify(body, null, 2),
    })
  }

  const viewComponentDetail = (row: ComponentTemplateRow) => {
    setDetail({
      show: true,
      title: row.name,
      content: JSON.stringify(row._template || {}, null, 2),
    })
  }

  // ==================== 创建模板 ====================
  const [createForm, setCreateForm] = useState({ show: false, name: '', body: '', saving: false })

  const openCreateTpl = () => {
    setCreateForm((f) => ({ ...f, show: true }))
  }

  const submitCreateTpl = async () => {
    if (!createForm.name) {
      toast.warning(t`Please enter the template name`)
      return
    }
    setCreateForm((f) => ({ ...f, saving: true }))
    try {
      const res = await CreateIndexTemplate(createForm.name, createForm.body)
      if (res.err !== '') {
        toast.error(res.err)
      } else {
        toast.success(t`Template created successfully`)
        setCreateForm({ show: false, name: '', body: '', saving: false })
        await getTemplates()
        return
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreateForm((f) => ({ ...f, saving: false }))
    }
  }

  const deleteTemplate = async (name: string) => {
    const ok = await confirm({
      title: t`Warning`,
      content: t`Are you sure you want to delete template "${name}"?`,
      type: 'error',
    })
    if (!ok) return
    const res = await DeleteIndexTemplate(name)
    if (res.err !== '') {
      toast.error(res.err)
    } else {
      toast.success(t`Template deleted`)
      await getTemplates()
    }
  }

  // ==================== 列定义 ====================
  const tplColumns = [
    { field: 'name', headerName: t`Template`, width: 200 },
    {
      field: 'index_patterns',
      headerName: t`Index Patterns`,
      width: 260,
      valueGetter: (row: IndexTemplateRow) => renderPatternList(row.index_patterns),
    },
    {
      field: 'composed_of',
      headerName: t`Composed Of`,
      width: 200,
      valueGetter: (row: IndexTemplateRow) => renderPatternList(row.composed_of),
    },
    { field: 'priority', headerName: t`Priority`, width: 90 },
    {
      field: 'actions',
      headerName: t`Actions`,
      width: 160,
      sortable: false,
      renderCell: ({ row }: { row: IndexTemplateRow }) => (
        <div className="flex items-center gap-0.5">
          <Button size="sm" variant="ghost" onClick={() => viewTemplateDetail(row)}>
            {t`Details`}
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => deleteTemplate(row.name)}>
            {t`Delete`}
          </Button>
        </div>
      ),
    },
  ]

  const compColumns = [
    { field: 'name', headerName: t`Template`, width: 200 },
    {
      field: 'version',
      headerName: 'version',
      width: 90,
      valueGetter: (row: ComponentTemplateRow) => row.version ?? '-',
    },
    {
      field: 'actions',
      headerName: t`Actions`,
      width: 100,
      sortable: false,
      renderCell: ({ row }: { row: ComponentTemplateRow }) => (
        <Button size="sm" variant="ghost" onClick={() => viewComponentDetail(row)}>
          {t`Details`}
        </Button>
      ),
    },
  ]

  // ==================== 生命周期 ====================
  useEffect(() => {
    const selectNode = async () => {
      setTplData([])
      setCompData([])
      await getTemplates()
      await getComponentTemplates()
    }
    emitter.on('selectNode', selectNode)
    getTemplates()
    getComponentTemplates()
    return () => {
      emitter.off('selectNode', selectNode)
    }
  }, [])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <h2 className="text-xl font-semibold">{t`Templates`}</h2>
        <p className="text-[13px] text-muted-foreground">{t`Manage index templates and component templates`}</p>
      </div>

      <Tabs value={tab} onValueChange={(v: string) => setTab(v)}>
        <TabsList>
          <TabsTrigger value="indexTemplate">{t`Index Templates`}</TabsTrigger>
          <TabsTrigger value="componentTemplate">{t`Component Templates`}</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* ============ 索引模板 ============ */}
      <div role="tabpanel" hidden={tab !== 'indexTemplate'}>
        {tab === 'indexTemplate' && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                onClick={getTemplates}
              >
                <RefreshCw className="size-4" />
                {t`Refresh`}
              </Button>
              <Button onClick={openCreateTpl}>
                <Plus className="size-4" />
                {t`Create Template`}
              </Button>
            </div>
            {tplLoading && <Spinner size={24} className="self-center" />}
            <DataTable
              getRowId={(row: IndexTemplateRow) => row.name}
              columns={tplColumns}
              rows={tplData}
              pagination={false}
              className="max-h-[500px] overflow-y-auto"
            />
          </div>
        )}
      </div>

      {/* ============ 组件模板 ============ */}
      <div role="tabpanel" hidden={tab !== 'componentTemplate'}>
        {tab === 'componentTemplate' && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                onClick={getComponentTemplates}
              >
                <RefreshCw className="size-4" />
                {t`Refresh`}
              </Button>
            </div>
            {compLoading && <Spinner size={24} className="self-center" />}
            <DataTable
              getRowId={(row: ComponentTemplateRow) => row.name}
              columns={compColumns}
              rows={compData}
              pagination={false}
              className="max-h-[500px] overflow-y-auto"
            />
          </div>
        )}
      </div>

      {/* 模板详情 */}
      <Dialog
        open={detail.show}
        onOpenChange={(v: boolean) => { if (!v) setDetail((d) => ({ ...d, show: false })) }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail.title}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-auto">
            <pre
              className="m-0 text-left whitespace-pre-wrap break-all font-mono text-[13px]"
            >
              {detail.content}
            </pre>
          </div>
          <DialogFooter>
            <Button onClick={() => setDetail((d) => ({ ...d, show: false }))}>{t`Close`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 创建模板 */}
      <Dialog
        open={createForm.show}
        onOpenChange={(v: boolean) => { if (!v) setCreateForm((f) => ({ ...f, show: false })) }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t`Create Template`}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex flex-col gap-1.5">
              <Label>{t`Template Name`}</Label>
              <Input
                value={createForm.name}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="my-template"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t`Template (JSON)`}</Label>
              <Textarea
                rows={10}
                value={createForm.body}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setCreateForm((f) => ({ ...f, body: e.target.value }))}
                placeholder={JSON.stringify({ index_patterns: ['logs-*'], template: { settings: {}, mappings: {} } }, null, 2)}
                className="text-left font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateForm((f) => ({ ...f, show: false }))}>{t`Cancel`}</Button>
            <Button
              disabled={createForm.saving}
              onClick={submitCreateTpl}
            >
              {t`Save`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
