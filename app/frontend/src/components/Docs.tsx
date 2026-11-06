import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react'
// ui/* 下的组件目前仍是未标注类型的 JS：其推断出的 props 会把 className / variant / size
// 标为必填，导致本文件所有调用处误报 TS2739 / TS2741。本轮不允许改动其它文件，因此在这里把
// 组件引用放宽为 any —— 只影响类型检查，不改变运行时行为。
import * as badgeUi from '@/components/ui/badge'
import * as buttonUi from '@/components/ui/button'
import * as dialogUi from '@/components/ui/dialog'
import * as dropdownMenuUi from '@/components/ui/dropdown-menu'
import * as dataTableUi from '@/components/ui/data-table'
import * as inputUi from '@/components/ui/input'
import * as radioGroupUi from '@/components/ui/radio-group'
import * as selectUi from '@/components/ui/select'
import * as tabsUi from '@/components/ui/tabs'
import * as textareaUi from '@/components/ui/textarea'
import * as tooltipUi from '@/components/ui/tooltip'
import { toast } from '@/components/ui/sonner'
import {
  FolderInput, MoreVertical, Plus, RefreshCw, Search, Trash2, Upload,
} from 'lucide-react'
import { t } from '@lingui/macro'
import { useLingui } from '@lingui/react'
import { useConfirm } from '../utils/feedback'
import emitter from '../utils/eventBus'
import { formatNumber, isValidJson } from '../utils/common'
import {
  AddDocument,
  BulkImport,
  DeleteByQuery,
  DeleteDoc,
  GetDoc,
  GetFieldTopValues,
  GetIndexes,
  SearchDocs,
  UpdateDoc,
} from '../../wailsjs/go/service/ESService'

const { Badge } = badgeUi as any
const { Button } = buttonUi as any
const { DataTable } = dataTableUi as any
const { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } = dialogUi as any
const {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} = dropdownMenuUi as any
const { Input } = inputUi as any
const { RadioGroup, RadioGroupItem } = radioGroupUi as any
const { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } = selectUi as any
const { Tabs, TabsList, TabsTrigger } = tabsUi as any
const { Textarea } = textareaUi as any
const { Tooltip, TooltipContent, TooltipTrigger } = tooltipUi as any

const pageSizeOptions = [10, 20, 50, 100]

// Radix Select 不允许空字符串 value，用该占位值表示"未选择索引"
const SELECT_NONE = '__none__'

const loadCachedIndexes = (): string[] => {
  try {
    const raw = localStorage.getItem('es_king_indexes')
    if (raw) {
      const arr: unknown = JSON.parse(raw)
      if (Array.isArray(arr) && arr.length > 0) {
        return arr as string[]
      }
    }
  } catch { /* ignore */ }
  return []
}

// 简易 CSV 解析：支持双引号转义（引号内可含逗号/换行）
const parseCsv = (text: string): string[][] => {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some(v => v !== '')) rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  row.push(field)
  if (row.some(v => v !== '')) rows.push(row)
  return rows
}

const renderCellValue = (value: any): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// ==================== 局部类型 ====================
// wailsjs 的响应体是 any，这里按本文件实际用到的字段定义局部结构并断言
interface DocHit {
  _id?: string
  _source?: Record<string, any>
}

interface DocDetailState {
  show: boolean
  editing: boolean
  saving: boolean
  title: string
  content: string
  docId: string
}

interface AddDocState {
  show: boolean
  doc: string
  saving: boolean
}

interface FieldBucket {
  key: string
  doc_count: number
}

interface DocColumn {
  field: string
  headerName: string
  width?: number
  sortable?: boolean
  renderCell?: (params: { row: any }) => ReactNode
}

type DocActionHandler = (opKey: string, row: any) => Promise<void>

// useConfirm 的 Context 默认值是 () => Promise<boolean>，实际调用带 options，这里按实际签名断言
type ConfirmFn = (options: {
  title?: string
  content?: string
  type?: string
}) => Promise<boolean>

export default function Docs() {
  const confirm = useConfirm() as ConfirmFn
  const { i18n } = useLingui()

  const [activeTab, setActiveTab] = useState('browse')

  // ==================== 索引下拉 ====================
  const [indexOptions, setIndexOptions] = useState<string[]>(loadCachedIndexes)
  const [indexLoading, setIndexLoading] = useState(false)

  const loadIndexes = async () => {
    setIndexLoading(true)
    try {
      const res = await GetIndexes("")
      if (res.err !== "") {
        toast.error(res.err)
        return
      }
      const idxs = (res.results || []).map(item => item.index).filter(Boolean)
      setIndexOptions(idxs)
      try {
        const key = 'es_king_indexes'
        const stored = localStorage.getItem(key)
        const values = stored ? JSON.parse(stored) : []
        for (const v of idxs) {
          if (!values.includes(v)) {
            values.push(v)
          }
        }
        localStorage.setItem(key, JSON.stringify(values.slice(-1000)))
      } catch { /* ignore */ }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setIndexLoading(false)
    }
  }

  // ==================== 文档浏览 ====================
  const [browseIndex, setBrowseIndex] = useState<string | null>(null)
  const [queryDsl, setQueryDsl] = useState('')
  const [docs, setDocs] = useState<DocHit[]>([])
  const [total, setTotal] = useState(0)
  const [fromNum, setFromNum] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [loading, setLoading] = useState(false)

  // 查看/编辑文档弹窗
  const [docDetail, setDocDetail] = useState<DocDetailState>({
    show: false, editing: false, saving: false,
    title: '', content: '', docId: '',
  })
  // 添加文档弹窗
  const [addDoc, setAddDoc] = useState<AddDocState>({ show: false, doc: '', saving: false })

  const searchDocs = async (index: string | null = browseIndex, from: number = fromNum, size: number = pageSize) => {
    if (!index) {
      toast.warning(t`Please select an index first`)
      return
    }
    if (queryDsl && !isValidJson(queryDsl)) {
      toast.error(t`Query DSL is not valid JSON`)
      return
    }
    setLoading(true)
    try {
      const res = await SearchDocs(index, queryDsl, from, size)
      if (res.err !== "") {
        toast.error(res.err)
        return
      }
      const result = res.result || {}
      setDocs((result.hits && result.hits.hits) || [])
      setTotal((result.hits && result.hits.total && result.hits.total.value) || 0)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  const resetBrowse = (idx: string | null = browseIndex, size: number = pageSize) => {
    setFromNum(0)
    setDocs([])
    setTotal(0)
    if (idx) {
      searchDocs(idx, 0, size)
    }
  }

  const prevPage = () => {
    const next = Math.max(0, fromNum - pageSize)
    setFromNum(next)
    searchDocs(browseIndex, next)
  }

  const nextPage = () => {
    const next = fromNum + pageSize
    setFromNum(next)
    searchDocs(browseIndex, next)
  }

  // 新搜索从第一页开始，翻页保留偏移量
  const newSearch = () => {
    setFromNum(0)
    searchDocs(browseIndex, 0)
  }

  const docRows = useMemo(
    () => docs.map((hit, i) => ({ id: hit._id ?? `row-${i}`, ...hit })),
    [docs]
  )

  // 动态列：取所有文档 _source 顶层字段并集
  // handleDocAction 每次渲染重建，经 ref 中转避免闭包过期；i18n 依赖保证切语言后表头更新
  const handleDocActionRef = useRef<DocActionHandler | null>(null)
  const docColumns = useMemo<DocColumn[]>(() => {
    const keyCount: Record<string, number> = {}
    for (const hit of docs) {
      const source = hit._source || {}
      for (const key of Object.keys(source)) {
        keyCount[key] = (keyCount[key] || 0) + 1
      }
    }
    const keys = Object.keys(keyCount)
        .sort((a, b) => keyCount[b] - keyCount[a] || a.localeCompare(b))
        .slice(0, 15)
    const cols: DocColumn[] = [
      {
        field: '_id',
        headerName: '_id',
        width: 160,
        renderCell: ({ row }: { row: any }) => <Badge variant="info">{row._id}</Badge>,
      },
      ...keys.map(key => ({
        field: `source.${key}`,
        headerName: key,
        width: 220,
        renderCell: ({ row }: { row: any }) => renderCellValue((row._source || {})[key]),
      })),
    ]
    cols.push({
      field: 'actions',
      headerName: t`Actions`,
      width: 110,
      sortable: false,
      renderCell: ({ row }: { row: any }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => handleDocActionRef.current!('view', row)}>
              {t`Details`}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleDocActionRef.current!('edit', row)}>
              {t`Edit`}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={() => handleDocActionRef.current!('delete', row)}>
              {t`Delete`}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    })
    return cols
  }, [docs, i18n])

  const handleDocAction: DocActionHandler = async (opKey, row) => {
    if (opKey === 'view' || opKey === 'edit') {
      if (opKey === 'view') {
        const res = await GetDoc(browseIndex!, row._id)
        if (res.err !== "") {
          toast.error(res.err)
          return
        }
        setDocDetail({
          show: true, editing: false, saving: false,
          title: `${browseIndex} / ${row._id}`,
          content: JSON.stringify(res.result, null, 2),
          docId: row._id,
        })
      } else {
        setDocDetail({
          show: true, editing: true, saving: false,
          title: `${browseIndex} / ${row._id}`,
          content: JSON.stringify(row._source || {}, null, 2),
          docId: row._id,
        })
      }
    } else if (opKey === 'delete') {
      const id = row._id
      const ok = await confirm({
        title: t`Warning`,
        content: t`Are you sure you want to delete document ${id}?`,
        type: 'error',
      })
      if (!ok) return
      const res = await DeleteDoc(browseIndex!, id)
      if (res.err !== "") {
        toast.error(res.err)
      } else {
        toast.success(t`Document ${id} deleted`)
        await searchDocs()
      }
    }
  }
  handleDocActionRef.current = handleDocAction

  const saveDoc = async () => {
    if (!isValidJson(docDetail.content)) {
      toast.error(t`Document content is not valid JSON`)
      return
    }
    setDocDetail(d => ({ ...d, saving: true }))
    try {
      const res = await UpdateDoc(browseIndex!, docDetail.docId, docDetail.content)
      if (res.err !== "") {
        toast.error(res.err)
      } else {
        toast.success(t`Document saved successfully`)
        setDocDetail(d => ({ ...d, show: false }))
        await searchDocs()
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDocDetail(d => ({ ...d, saving: false }))
    }
  }

  const openAddDoc = () => {
    if (!browseIndex) {
      toast.warning(t`Please select an index first`)
      return
    }
    setAddDoc(d => ({ ...d, show: true }))
  }

  const submitAddDoc = async () => {
    if (!isValidJson(addDoc.doc)) {
      toast.error(t`Document content is not valid JSON`)
      return
    }
    setAddDoc(d => ({ ...d, saving: true }))
    try {
      const res = await AddDocument(browseIndex!, addDoc.doc)
      if (res.err !== "") {
        toast.error(res.err)
      } else {
        const id = res.result['_id']
        toast.success(t`Document added successfully, id: ${id}`)
        setAddDoc({ show: false, doc: '', saving: false })
        await searchDocs()
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setAddDoc(d => ({ ...d, saving: false }))
    }
  }

  const confirmDeleteByQuery = async () => {
    if (!browseIndex) {
      toast.warning(t`Please select an index first`)
      return
    }
    if (!queryDsl) {
      toast.warning(t`Delete by query requires a query condition to prevent accidental full deletion`)
      return
    }
    const index = browseIndex
    const ok = await confirm({
      title: t`Warning`,
      content: t`Are you sure you want to delete documents matching the query in index ${index}? Deletion runs asynchronously and is irreversible!`,
      type: 'error',
    })
    if (!ok) return
    const res = await DeleteByQuery(index, queryDsl)
    if (res.err !== "") {
      toast.error(res.err)
    } else {
      toast.success(t`Delete task submitted (async)`)
    }
  }

  // ==================== 字段统计 ====================
  const [statsIndex, setStatsIndex] = useState<string | null>(null)
  const [statsField, setStatsField] = useState('')
  const [statsSize, setStatsSize] = useState(10)
  const [statsData, setStatsData] = useState<FieldBucket[]>([])
  const [statsLoading, setStatsLoading] = useState(false)
  const [cardinality, setCardinality] = useState<number | null>(null)

  const statsRows = useMemo(() => statsData.map((b, i) => ({ id: i, ...b })), [statsData])

  const statsColumns = useMemo<DocColumn[]>(() => [
    { field: 'key', headerName: t`Value`, width: 320 },
    { field: 'doc_count', headerName: t`Doc Count`, width: 160 },
  ], [])

  const queryFieldStats = async () => {
    if (!statsIndex) {
      toast.warning(t`Please select an index first`)
      return
    }
    if (!statsField) {
      toast.warning(t`Please enter a field name`)
      return
    }
    setStatsLoading(true)
    setCardinality(null)
    try {
      const res = await GetFieldTopValues(statsIndex, statsField, statsSize)
      if (res.err !== "") {
        toast.error(res.err)
        return
      }
      const aggs = (res.result && res.result.aggregations) || {}
      const buckets = (aggs.top_values && aggs.top_values.buckets) || []
      setStatsData(buckets.map((b: any): FieldBucket => ({
        key: typeof b.key === 'object' ? JSON.stringify(b.key) : String(b.key),
        doc_count: b.doc_count,
      })))
      if (aggs.unique_count) {
        setCardinality(aggs.unique_count.value)
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setStatsLoading(false)
    }
  }

  // ==================== 导入 ====================
  const [importIndex, setImportIndex] = useState<string | null>(null)
  const [importFormat, setImportFormat] = useState('json')
  const [importData, setImportData] = useState('')
  const [importLoading, setImportLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const isCsv = file.name.toLowerCase().endsWith('.csv')
    const reader = new FileReader()
    reader.onload = (event) => {
      setImportData((event.target?.result as string) || '')
      if (isCsv) {
        setImportFormat('csv')
      } else if (file.name.toLowerCase().endsWith('.json')) {
        setImportFormat('json')
      }
      const name = file.name
      toast.success(t`File loaded: ${name}`)
    }
    reader.onerror = () => {
      toast.error(t`Failed to read file`)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const fillSampleData = () => {
    if (importFormat === 'csv') {
      setImportData(`title,category,views,publish_date
Elasticsearch Guide,database,1500,2026-01-15
Naive UI Tutorial,frontend,820,2026-02-20
Go Wails Desktop App,golang,2300,2026-03-01`)
    } else {
      setImportData(JSON.stringify([
        {
          "title": "Elasticsearch Guide",
          "category": "database",
          "views": 1500,
          "publish_date": "2026-01-15"
        },
        {
          "title": "Naive UI Tutorial",
          "category": "frontend",
          "views": 820,
          "publish_date": "2026-02-20"
        },
        {
          "title": "Go Wails Desktop App",
          "category": "golang",
          "views": 2300,
          "publish_date": "2026-03-01"
        }
      ], null, 2))
    }
  }

  const csvToDocs = (text: string): Record<string, string>[] => {
    const rows = parseCsv(text.trim())
    if (rows.length < 2) {
      throw new Error(t`CSV requires a header row and at least one data row`)
    }
    const headers = rows[0].map(h => h.trim())
    return rows.slice(1).map(row => {
      const doc: Record<string, string> = {}
      headers.forEach((h, i) => {
        if (h !== "") {
          doc[h] = row[i] ?? ''
        }
      })
      return doc
    })
  }

  const parsedDocCount = useMemo(() => {
    const raw = importData.trim()
    if (!raw) return 0
    if (importFormat === 'json') {
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.length : 0
      } catch {
        return 0
      }
    } else {
      try {
        const rows = parseCsv(raw)
        return rows.length > 1 ? rows.length - 1 : 0
      } catch {
        return 0
      }
    }
  }, [importData, importFormat])

  const parseErrorMessage = useMemo(() => {
    const raw = importData.trim()
    if (!raw) return ''
    if (importFormat === 'json') {
      try {
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) {
          return t`Document data must be a JSON array`
        }
        return ''
      } catch (e: any) {
        return e.message
      }
    } else {
      try {
        const rows = parseCsv(raw)
        if (rows.length < 2) {
          return t`CSV requires a header row and at least one data row`
        }
        return ''
      } catch (e: any) {
        return e.message
      }
    }
  }, [importData, importFormat])

  const importDocs = async () => {
    if (!importIndex) {
      toast.warning(t`Please select an index first`)
      return
    }
    let docsArray: any
    try {
      if (importFormat === 'csv') {
        docsArray = csvToDocs(importData)
      } else {
        docsArray = JSON.parse(importData)
        if (!Array.isArray(docsArray)) {
          toast.error(t`Document data must be a JSON array`)
          return
        }
      }
    } catch (e: any) {
      const msg = e.message
      toast.error(t`Parse failed: ${msg}`)
      return
    }
    setImportLoading(true)
    try {
      const res = await BulkImport(importIndex, JSON.stringify(docsArray))
      if (res.err !== "") {
        toast.error(res.err)
        return
      }
      const summary = res.result || {}
      if (summary.failed > 0) {
        const success = summary.success
        const failed = summary.failed
        const msg = summary.first_error || ''
        toast.warning(t`Import finished: ${success} succeeded, ${failed} failed. First error: ${msg}`)
      } else {
        const count = summary.total
        toast.success(t`Successfully imported ${count} documents`)
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setImportLoading(false)
    }
  }

  const openImportTab = () => {
    if (browseIndex) {
      setImportIndex(browseIndex)
    } else if (!importIndex && indexOptions.length > 0) {
      setImportIndex(indexOptions[0])
    }
    setActiveTab('import')
  }

  // ==================== 生命周期 ====================
  const selectNode = async () => {
    setDocs([])
    setTotal(0)
    setBrowseIndex(null)
    setStatsIndex(null)
    setImportIndex(null)
    await loadIndexes()
  }

  useEffect(() => {
    emitter.on('selectNode', selectNode)
    loadIndexes()
    return () => {
      emitter.off('selectNode', selectNode)
    }
  }, [])

  // 切换 tab 时自动填充索引
  useEffect(() => {
    if (activeTab === 'import') {
      if (!importIndex) {
        setImportIndex(browseIndex || (indexOptions[0] ?? null))
      }
    }
    if (activeTab === 'fieldStats') {
      if (!statsIndex) {
        setStatsIndex(browseIndex || (indexOptions[0] ?? null))
      }
    }
  }, [activeTab])

  // 页码显示变量名须与 en.json 占位符一致：Rows {from}-{to} of {total}
  const from = total === 0 ? 0 : fromNum + 1
  const to = fromNum + docs.length

  const indexSelect = (value: string | null, onValueChange: (value: string) => void) => (
    <Select
      value={value ?? ''}
      onValueChange={onValueChange}
      disabled={indexLoading}
    >
      <SelectTrigger className="w-[260px] min-w-[240px] shrink-0">
        <SelectValue placeholder={t`Select an index`} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SELECT_NONE}>
          <span className="italic">{t`Select an index`}</span>
        </SelectItem>
        {indexOptions.map(idx => <SelectItem key={idx} value={idx}>{idx}</SelectItem>)}
      </SelectContent>
    </Select>
  )

  return (
    <div className="flex flex-col gap-2">
      <style>{`
        textarea.es-docs-json-input {
          text-align: left !important;
          font-family: Consolas, Monaco, monospace;
        }
      `}</style>

      <div className="flex items-center gap-1">
        <h2 className="text-lg font-semibold">{t`Documents`}</h2>
        <span className="text-[13px] text-muted-foreground">{t`Browse, edit, import documents and field statistics`}</span>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="browse">{t`Browse`}</TabsTrigger>
          <TabsTrigger value="fieldStats">{t`Field Stats`}</TabsTrigger>
          <TabsTrigger value="import">{t`Import`}</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* ============ 文档浏览 ============ */}
      {activeTab === 'browse' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {indexSelect(browseIndex, (v) => {
              const nv = v === SELECT_NONE ? null : v
              setBrowseIndex(nv)
              resetBrowse(nv)
            })}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" disabled={indexLoading} onClick={loadIndexes}>
                  <RefreshCw className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t`Refresh index list`}</TooltipContent>
            </Tooltip>
            <Textarea
              rows={1}
              value={queryDsl}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setQueryDsl(e.target.value)}
              placeholder={t`Query DSL (optional), e.g. {"term":{"status":"active"}}`}
              title={t`Query DSL (optional), e.g. {"term":{"status":"active"}}. Leave empty to match all`}
              onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter') newSearch() }}
              className="es-docs-json-input min-w-[280px] flex-1 min-h-[32px] max-h-[144px] resize-y"
            />
            <Button
              disabled={loading}
              onClick={newSearch}
            >
              <Search className="size-4" />
              {t`Search`}
            </Button>
            <Button variant="outline" onClick={openAddDoc}>
              <Plus className="size-4" />
              {t`Add Document`}
            </Button>
            <Button variant="outline" onClick={openImportTab}>
              <FolderInput className="size-4" />
              {t`Import`}
            </Button>
            <Button variant="destructive" onClick={confirmDeleteByQuery}>
              <Trash2 className="size-4" />
              {t`Delete by Query`}
            </Button>
          </div>

          <DataTable
            columns={docColumns}
            rows={docRows}
            getRowId={(row: any) => row.id}
            pagination={false}
            emptyMessage={t`No data`}
          />

          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={fromNum <= 0} onClick={prevPage}>
              {t`Prev`}
            </Button>
            <p className="text-[13px]">{t`Rows ${from}-${to} of ${total}`}</p>
            <Button variant="outline" size="sm" disabled={fromNum + pageSize >= total || docs.length === 0} onClick={nextPage}>
              {t`Next`}
            </Button>
            <Select
              value={String(pageSize)}
              onValueChange={(v: string) => {
                const n = Number(v)
                setPageSize(n)
                resetBrowse(browseIndex, n)
              }}
            >
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map(v => <SelectItem key={v} value={String(v)}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* ============ 字段统计 ============ */}
      {activeTab === 'fieldStats' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {indexSelect(statsIndex, (v) => setStatsIndex(v === SELECT_NONE ? null : v))}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" disabled={indexLoading} onClick={loadIndexes}>
                  <RefreshCw className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t`Refresh index list`}</TooltipContent>
            </Tooltip>
            <div className="shrink-0">
              <Input
                value={statsField}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setStatsField(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') queryFieldStats() }}
                placeholder={t`Field`}
                className="w-[220px]"
              />
            </div>
            <Input
              type="number"
              min={1}
              max={1000}
              value={statsSize}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const v = parseInt(e.target.value, 10)
                setStatsSize(isNaN(v) ? 1 : Math.min(1000, Math.max(1, v)))
              }}
              placeholder="Size"
              className="w-[140px] shrink-0"
            />
            <Button
              disabled={statsLoading}
              onClick={queryFieldStats}
            >
              <Search className="size-4" />
              {t`Search`}
            </Button>
          </div>
          {cardinality !== null && (
            <p>
              {(() => { const count = formatNumber(cardinality); return t`Cardinality: ${count}` })()}
            </p>
          )}
          <DataTable
            columns={statsColumns}
            rows={statsRows}
            getRowId={(row: any) => row.id}
            pagination={false}
            emptyMessage={t`No data`}
          />
        </div>
      )}

      {/* ============ 导入 ============ */}
      {activeTab === 'import' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {indexSelect(importIndex, (v) => setImportIndex(v === SELECT_NONE ? null : v))}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" disabled={indexLoading} onClick={loadIndexes}>
                  <RefreshCw className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t`Refresh index list`}</TooltipContent>
            </Tooltip>
            <RadioGroup
              value={importFormat}
              onValueChange={setImportFormat}
              className="flex flex-row items-center gap-4"
            >
              <label className="flex cursor-pointer items-center gap-1.5 text-[13px]">
                <RadioGroupItem value="json" />
                JSON
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-[13px]">
                <RadioGroupItem value="csv" />
                CSV
              </label>
            </RadioGroup>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.csv,.txt"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              <FolderInput className="size-4" />
              {t`Select Local File`}
            </Button>
            <Button variant="ghost" onClick={fillSampleData}>
              {t`Fill Sample Template`}
            </Button>
            <Button variant="ghost" onClick={() => setImportData('')}>
              {t`Clear`}
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-muted-foreground/50">
              {importFormat === 'csv'
                ? t`The first CSV row is the header (field names), each following row is a document. Double quotes are supported.`
                : t`Enter a JSON array where each element is a document`}
            </p>
            {parsedDocCount > 0 ? (
              <Badge variant="success">{(() => { const count = parsedDocCount; return t`${count} documents ready to import` })()}</Badge>
            ) : (
              importData.trim() && parseErrorMessage
                ? <Badge variant="destructive">{parseErrorMessage}</Badge>
                : null
            )}
          </div>
          <Textarea
            rows={12}
            value={importData}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setImportData(e.target.value)}
            placeholder={importFormat === 'csv'
              ? t`name,age,city
Alice,20,Beijing
Bob,25,Shanghai`
              : t`[
  {"name": "Alice", "age": 20},
  {"name": "Bob", "age": 25}
]`}
            className="es-docs-json-input min-h-[260px] max-h-[520px] font-mono"
          />
          <div className="flex items-center gap-1">
            <Button
              disabled={importLoading || !importIndex || !importData.trim()}
              onClick={importDocs}
            >
              <Upload className="size-4" />
              {t`Start Import`}
            </Button>
            {!importIndex && (
              <p className="text-[13px] text-muted-foreground/50">
                {t`Please select an index first`}
              </p>
            )}
          </div>
        </div>
      )}

      {/* 查看/编辑文档 */}
      <Dialog
        open={docDetail.show}
        onOpenChange={(v: boolean) => { if (!v) setDocDetail(d => ({ ...d, show: false })) }}
      >
        <DialogContent className="max-w-[90vw] sm:max-w-[680px] text-left">
          <DialogHeader>
            <DialogTitle>{docDetail.title}</DialogTitle>
          </DialogHeader>
          {!docDetail.editing ? (
            <pre className="m-0 max-h-[65vh] overflow-auto text-left font-mono text-[13px] whitespace-pre-wrap break-all">
              {docDetail.content}
            </pre>
          ) : (
            <Textarea
              value={docDetail.content}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDocDetail(d => ({ ...d, content: e.target.value }))}
              className="es-docs-json-input min-h-[240px] font-mono"
            />
          )}
          <DialogFooter>
            {!docDetail.editing ? (
              <Button onClick={() => setDocDetail(d => ({ ...d, show: false }))}>{t`Close`}</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setDocDetail(d => ({ ...d, show: false }))}>{t`Cancel`}</Button>
                <Button disabled={docDetail.saving} onClick={saveDoc}>{t`Save`}</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 添加文档 */}
      <Dialog
        open={addDoc.show}
        onOpenChange={(v: boolean) => { if (!v) setAddDoc(d => ({ ...d, show: false })) }}
      >
        <DialogContent className="max-w-[90vw] sm:max-w-[640px] text-left">
          <DialogHeader>
            <DialogTitle>{t`Add Document`}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={addDoc.doc}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setAddDoc(d => ({ ...d, doc: e.target.value }))}
            placeholder={JSON.stringify({"field1": "value1"}, null, 2)}
            className="es-docs-json-input min-h-[240px] font-mono"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDoc(d => ({ ...d, show: false }))}>{t`Cancel`}</Button>
            <Button disabled={addDoc.saving} onClick={submitAddDoc}>{t`Save`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
