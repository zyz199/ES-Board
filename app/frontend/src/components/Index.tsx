import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentProps } from 'react'
import { t } from '@lingui/macro'
import { useLingui } from '@lingui/react'
import {
  ChevronLeft, ChevronRight, FolderInput, Megaphone, MoreVertical, Plus, Search,
} from 'lucide-react'
import { toast } from '@/components/ui/sonner'
import { DataTable } from '@/components/ui/data-table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { useConfirm } from '../utils/feedback'
import emitter from '../utils/eventBus'
import {
  createCsvContent,
  download_file,
  formatBytes,
  formattedJson,
  isValidJson,
} from '../utils/common'
import {
  AddDocument,
  AddIndexAlias,
  CacheClear,
  CreateIndex,
  CreateIndexFromTemplate,
  DeleteIndex,
  DownloadESIndex,
  Flush,
  GetDoc10,
  GetIndexAliases,
  GetIndexes,
  GetIndexInfo,
  GetIndexTemplates,
  MergeSegments,
  OpenCloseIndex,
  Refresh,
  RemoveIndexAlias,
  Reindex,
  UpdateIndexMappings,
  UpdateIndexSettings,
} from '../../wailsjs/go/service/ESService'

/** 索引列表行（GetIndexes 的 results 为 any[]，这里按本文件实际用到的字段收窄） */
interface IndexRow {
  index: string
  alias?: string
  health: string
  status: string
  pri: string
  rep: string
  'docs.count': string
  'docs.deleted': string
  'store.size': string
}

/** 模板下拉选项 */
interface TemplateOption {
  label: string
  value: string
}

/** 索引备份弹窗状态 */
interface DownloadIndexConfig {
  indexName: string
  dsl: string
  loading: boolean
  show: boolean
  code: string
  msg: string | null
}

/** 新建索引表单（分片/副本在输入框清空时会被置为 ''，故为 number | string） */
interface IndexConfig {
  name: string
  numberOfShards: number | string
  numberOfReplicas: number | string
  mapping: string
  template: string
}

/** 添加文档表单 */
interface DocConfig {
  index: string
  doc: string
}

/** 别名管理弹窗状态 */
interface AliasModal {
  show: boolean
  index: string
  aliases: string[]
  newAlias: string
  extra: string
  loading: boolean
  adding: boolean
}

/** Reindex 弹窗状态 */
interface ReindexModal {
  show: boolean
  source: string
  dest: string
  query: string
  loading: boolean
}

/** Mapping / Settings 编辑弹窗状态 */
interface EditModal {
  show: boolean
  index: string
  content: string
  saving: boolean
}

/** JSON 查看弹窗状态 */
interface JsonDialog {
  show: boolean
  title: string
  content: string
}

/** 分页模型（页码从 0 开始） */
interface PaginationModel {
  page: number
  pageSize: number
}

// feedback.tsx 的 ConfirmContext 目前无参数签名，这里按本文件实际用法断言（仅类型层面，无运行时影响）
type ConfirmFn = (options: { title?: string; content?: string; type?: 'error' }) => Promise<boolean>

// DataTable 的列定义类型，从组件 props 上取出（ui/data-table 未导出 DataTableColumn）
type IndexColumnList = NonNullable<ComponentProps<typeof DataTable<IndexRow>>['columns']>

const rowKey = (row: IndexRow) => row.index

const getType = (value: string): 'success' | 'warning' | 'error' => {
  const type: Record<string, 'success' | 'warning' | 'error'> = {
    "green": "success",
    "yellow": "warning",
    "open": "success",
    "close": "error",
  }
  return type[value] || 'error'
}

const MAPPING_PLACEHOLDER = JSON.stringify({ "properties": { "created_at": { "type": "date", "format": "yyyy-MM-dd HH:mm:ss" } } }, null, 2)
const DOC_PLACEHOLDER = JSON.stringify({ "field1": "value1", "field2": "value2" }, null, 2)
const ALIAS_EXTRA_PLACEHOLDER = JSON.stringify({ "filter": { "term": { "env": "prod" } }, "routing": "1" }, null, 2)
const REINDEX_QUERY_PLACEHOLDER = JSON.stringify({ "term": { "status": "active" } }, null, 2)

// 行操作下拉菜单（每个行单元格独立维护菜单开关状态）
function RowActions({ row, onSelect }: {
  row: IndexRow
  onSelect: (key: string, row: IndexRow) => void
}) {
  const [open, setOpen] = useState(false)

  const items = [
    ['addDocument', t`Add Document`],
    ['viewDetails', t`View Details`],
    ['viewAlias', t`Aliases`],
    ['viewDocs', t`View 10 Docs`],
    ['manageAlias', t`Manage Aliases`],
    ['editMapping', t`Edit Mapping`],
    ['editSettings', t`Edit Settings`],
    ['reindex', t`Reindex Data`],
    ['mergeSegments', t`Merge Segments`],
    ['deleteIndex', t`Delete Index`],
    ['openCloseIndex', row.status === 'close' ? t`Open Index` : t`Close Index`],
    ['refresh', t`Refresh`],
    ['flush', t`Flush`],
    ['clearCache', t`Clear Cache`],
  ]

  const handleItemClick = (key: string) => {
    setOpen(false)
    onSelect(key, row)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="actions">
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {items.map(([key, label]) => (
          <DropdownMenuItem key={key} onClick={() => handleItemClick(key)}>
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default function Index() {
  const confirm = useConfirm() as unknown as ConfirmFn
  const { i18n } = useLingui() // 依赖 i18n 实例，语言切换时重算列头与文案

  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<IndexRow[]>([])
  const [searchText, setSearchText] = useState('')
  const [selection, setSelection] = useState<string[]>([]) // 选中行 key（index 名）数组

  // JSON 查看弹窗（详情/别名/文档/merge/delete 等结果）
  const [jsonDialog, setJsonDialog] = useState<JsonDialog>({ show: false, title: '', content: '' })

  // 索引备份
  const [downloadIndexConfig, setDownloadIndexConfig] = useState<DownloadIndexConfig>({
    indexName: '',
    dsl: '',
    loading: false,
    show: false,
    code: '',
    msg: null,
  })

  // 新建索引
  const [createDialogVisible, setCreateDialogVisible] = useState(false)
  const [addIndexLoading, setAddIndexLoading] = useState(false)
  const [indexConfig, setIndexConfig] = useState<IndexConfig>({
    name: '',
    numberOfShards: 1,
    numberOfReplicas: 0,
    mapping: '',
    template: '',
  })
  const [templateOptions, setTemplateOptions] = useState<TemplateOption[]>([])

  // 添加文档
  const [addDocDialogVisible, setAddDocDialogVisible] = useState(false)
  const [addDocLoading, setAddDocLoading] = useState(false)
  const [docConfig, setDocConfig] = useState<DocConfig>({ index: '', doc: '' })

  // 别名管理
  const [aliasModal, setAliasModal] = useState<AliasModal>({
    show: false,
    index: '',
    aliases: [],
    newAlias: '',
    extra: '',
    loading: false,
    adding: false,
  })

  // Reindex
  const [reindexModal, setReindexModal] = useState<ReindexModal>({
    show: false,
    source: '',
    dest: '',
    query: '',
    loading: false,
  })

  // Mapping 编辑
  const [mappingModal, setMappingModal] = useState<EditModal>({
    show: false,
    index: '',
    content: '',
    saving: false,
  })

  // Settings 编辑
  const [settingsModal, setSettingsModal] = useState<EditModal>({
    show: false,
    index: '',
    content: '',
    saving: false,
  })

  // 分页（页码从 0 开始）
  const pageKey = 'esKing:index:pageKey'
  const [paginationModel, setPaginationModel] = useState<PaginationModel>({
    page: 0,
    pageSize: parseInt(localStorage.getItem(pageKey) ?? '') || 10,
  })
  const pageSizeOptions = [5, 10, 15, 20, 25, 30, 40]

  // 别名缓存（selectNode 时清空）
  const aliasesRef = useRef<Record<string, string>>({})

  const patchDownloadIndexConfig = (patch: Partial<DownloadIndexConfig>) =>
    setDownloadIndexConfig((prev) => ({ ...prev, ...patch }))
  const patchAliasModal = (patch: Partial<AliasModal>) =>
    setAliasModal((prev) => ({ ...prev, ...patch }))
  const patchReindexModal = (patch: Partial<ReindexModal>) =>
    setReindexModal((prev) => ({ ...prev, ...patch }))
  const patchMappingModal = (patch: Partial<EditModal>) =>
    setMappingModal((prev) => ({ ...prev, ...patch }))
  const patchSettingsModal = (patch: Partial<EditModal>) =>
    setSettingsModal((prev) => ({ ...prev, ...patch }))

  useEffect(() => {
    const selectNode = () => {
      setData([])
      setSelection([])
      aliasesRef.current = {}
    }
    emitter.on('selectNode', selectNode)
    return () => {
      emitter.off('selectNode', selectNode)
    }
  }, [])

  const cacheData = (indexes: string[]) => {
    const key = 'es_king_indexes';
    let values: string[] = []
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) values = parsed
      } catch {
        // 缓存损坏则忽略旧数据，与 Docs/Analyze 的容错行为保持一致
      }
      for (const v of indexes) {
        if (!values.includes(v)) {
          values.push(v);
        }
      }
    }
    if (values) {
      localStorage.setItem(key, JSON.stringify(values.slice(-1000)))
    }
  }

  const getData = async (value: string) => {
    const res = await GetIndexes(value)
    if (res.err !== '') {
      toast.error(res.err)
    } else {
      setData(res.results)
      cacheData(res.results.map((item: IndexRow) => item.index))
    }
  }

  const search = async () => {
    setLoading(true)
    try {
      await getData(searchText)
    } catch (e) {
      toast.error((e as Error).message)
    }
    setLoading(false)
  }

  const downloadIndex = async () => {
    const indexName = downloadIndexConfig.indexName;
    const dsl = downloadIndexConfig.dsl;

    if (!indexName) {
      toast.error(t`Please fill in the index name`)
      return;
    }
    if (downloadIndexConfig.code !== "964440643") {
      toast.error(t`Incorrect group number, please check on GitHub`)
      return;
    }
    const file_path = `/${indexName}-${Math.floor(Date.now() / 1000)}.json`

    patchDownloadIndexConfig({ loading: true })
    try {
      const res = await DownloadESIndex(indexName, dsl, file_path);
      if (res.err !== '') {
        toast.error(res.err)
        patchDownloadIndexConfig({ msg: res.err })
      } else {
        const savedPath = res.result || file_path;
        const downloadMsg = t`Backup successful` + ' ' + savedPath;
        toast.success(downloadMsg)
        patchDownloadIndexConfig({ msg: downloadMsg, show: false })
      }
    } catch (e) {
      toast.error((e as Error).message)
      patchDownloadIndexConfig({ msg: String(e) })
    } finally {
      patchDownloadIndexConfig({ loading: false })
    }
  };

  // 打开创建索引弹窗时加载模板列表
  const openCreateIndex = async () => {
    setIndexConfig((prev) => ({ ...prev, template: '' }))
    setCreateDialogVisible(true)
    const res = await GetIndexTemplates()
    if (res.err === '' && Array.isArray(res.results)) {
      setTemplateOptions(res.results.map((tpl: { name: string; index_patterns?: string[] }) => {
        const patterns = Array.isArray(tpl.index_patterns) ? tpl.index_patterns.join(', ') : ''
        return { label: patterns ? `${tpl.name} (${patterns})` : tpl.name, value: tpl.name }
      }))
    }
  }

  const createIndexFromTemplate = async () => {
    setAddIndexLoading(true)
    try {
      const res = await CreateIndexFromTemplate(
        indexConfig.name,
        indexConfig.template,
        // 表单已校验非空，运行期必为 number，断言仅用于收窄 number | string
        indexConfig.numberOfShards as number,
        indexConfig.numberOfReplicas as number
      )
      if (res.err !== '') {
        toast.error(res.err)
      } else {
        const name = indexConfig.name
        toast.success(t`Index [${name}] created successfully`)
        await search()
        setCreateDialogVisible(false)
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setAddIndexLoading(false)
    }
  }

  const addIndex = async () => {
    // 表单校验（等价 Vue 版 form rules）
    if (!indexConfig.name || indexConfig.numberOfShards === null || indexConfig.numberOfShards === '' ||
      indexConfig.numberOfReplicas === null || indexConfig.numberOfReplicas === '') {
      toast.error(t`Please fill in all required fields`)
      return
    }
    if (indexConfig.template) {
      await createIndexFromTemplate()
      return
    }
    if (indexConfig.mapping) {
      const err = isValidJson(indexConfig.mapping)
      if (!err) {
        toast.error(t`Mapping is not valid JSON`)
        return
      }
    }
    setAddIndexLoading(true)
    let created = false
    try {
      const res = await CreateIndex(indexConfig.name, indexConfig.numberOfShards as number, indexConfig.numberOfReplicas as number, indexConfig.mapping)
      if (res.err !== '') {
        toast.error(res.err)
      } else {
        created = true
        const name = indexConfig.name
        toast.success(t`Index [${name}] created successfully`)
        await search()
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setAddIndexLoading(false)
    }
    // 只在成功时关弹窗：失败保留用户填写的名称/分片/mapping，可改完重试
    if (created) setCreateDialogVisible(false)
  }

  const addDocument = (row: IndexRow) => {
    setAddDocDialogVisible(true)
    setDocConfig((prev) => ({ ...prev, index: row.index }))
  }

  const addDocumentFunc = async () => {
    if (!docConfig.doc) {
      toast.error(t`Please enter document content`)
      return
    }
    if (!isValidJson(docConfig.doc)) {
      toast.error(t`Please fill in all required fields`)
      return
    }
    setAddDocLoading(true)
    try {
      const res = await AddDocument(docConfig.index, docConfig.doc);
      if (res.err !== '') {
        toast.error(res.err)
      } else {
        const id = res.result['_id']
        toast.success(t`Document added successfully, id: ${id}`)
        await search()
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setAddDocLoading(false)
      setAddDocDialogVisible(false)
      setDocConfig({ index: '', doc: '' })
    }
  }

  const showJsonDialog = (result: unknown, title: string) => {
    setJsonDialog({ show: true, title, content: formattedJson(result) })
  }

  const viewIndexDetails = async (row: IndexRow) => {
    const res = await GetIndexInfo(row.index)
    if (res.err !== '') {
      toast.error(res.err)
    } else {
      showJsonDialog(res.result, row.index)
    }
  }

  const viewIndexAlias = async (row: IndexRow) => {
    const res = await GetIndexAliases([row.index])
    if (res.err !== '') {
      toast.error(res.err)
    } else {
      showJsonDialog(res.result, row.index)
    }
  }

  const viewIndexDocs = async (row: IndexRow) => {
    setLoading(true)
    try {
      const res = await GetDoc10(row.index)
      if (res.err !== '') {
        toast.error(res.err)
      } else {
        showJsonDialog(res.result, row.index)
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
    setLoading(false)
  }

  const mergeSegmentsFunc = async (row: IndexRow) => {
    const res = await MergeSegments(row.index)
    if (res.err !== '') {
      toast.error(res.err)
    } else {
      showJsonDialog(res.result, row.index)
      toast.success(t`Merge request submitted. Merging is I/O intensive, please monitor cluster load.`)
      await search()
    }
  }

  const mergeSegments = async (row: IndexRow) => {
    const name = row.index
    if (!(await confirm({
      title: t`Warning`,
      content: t`Are you sure you want to merge segments for index ${name}? Merging is very resource-intensive and will be submitted to ES backend.`,
    }))) return
    await mergeSegmentsFunc(row)
  }

  const deleteIndexFunc = async (row: IndexRow) => {
    const res = await DeleteIndex(row.index)
    if (res.err !== '') {
      toast.error(res.err)
    } else {
      showJsonDialog(res.result, row.index)
      await search()
    }
  }

  const deleteIndex = async (row: IndexRow) => {
    const name = row.index
    if (!(await confirm({
      title: t`Warning`,
      content: t`Are you sure you want to delete index ${name}?`,
      type: 'error',
    }))) return
    await deleteIndexFunc(row)
  }

  const openCloseIndex = async (row: IndexRow) => {
    const res = await OpenCloseIndex(row.index, row.status)
    if (res.err !== '') {
      toast.error(res.err)
    } else {
      showJsonDialog(res.result, row.index)
      await search()
    }
  }

  const refreshIndex = async (row: IndexRow) => {
    const res = await Refresh(row.index)
    if (res.err !== '') {
      toast.error(res.err)
    } else {
      showJsonDialog(res.result, row.index)
    }
  }

  const flushIndex = async (row: IndexRow) => {
    const res = await Flush(row.index)
    if (res.err !== '') {
      toast.error(res.err)
    } else {
      showJsonDialog(res.result, row.index)
    }
  }

  const clearCache = async (row: IndexRow) => {
    const res = await CacheClear(row.index)
    if (res.err !== '') {
      toast.error(res.err)
    } else {
      showJsonDialog(res.result, row.index)
      await search()
    }
  }

  const downloadAllDataCsv = () => {
    const csvContent = createCsvContent(data, csvColumns)
    download_file(csvContent, t`index-list.csv`, 'text/csv;charset=utf-8;')
  }

  const queryAlias = async () => {
    setLoading(true)
    const name_lst: string[] = []
    const start = paginationModel.page * paginationModel.pageSize;
    const end = start + paginationModel.pageSize;
    const pagedData = data.slice(start, end);
    for (const k in pagedData) {
      name_lst.push(pagedData[k].index)
    }
    try {
      const res = await GetIndexAliases(name_lst)
      if (res.err !== '') {
        setLoading(false)
        toast.error(res.err)
        return
      }
      aliasesRef.current = { ...aliasesRef.current, ...res.result }
      setData((prev) => prev.map((item) => {
        const alias = aliasesRef.current[item.index]
        return alias ? { ...item, alias } : item
      }))
    } catch (e) {
      toast.error((e as Error).message)
    }
    setLoading(false)
  }

  // ==================== 别名管理 ====================
  const refreshAliasList = async () => {
    const res = await GetIndexAliases([aliasModal.index])
    if (res.err !== '') {
      toast.error(res.err)
      return
    }
    const joined = res.result[aliasModal.index] || ''
    patchAliasModal({ aliases: joined ? joined.split(',') : [] })
  }

  const manageAlias = async (row: IndexRow) => {
    patchAliasModal({ show: true, index: row.index, newAlias: '', extra: '', loading: true })
    try {
      const res = await GetIndexAliases([row.index])
      if (res.err !== '') {
        toast.error(res.err)
        patchAliasModal({ aliases: [] })
      } else {
        const joined = res.result[row.index] || ''
        patchAliasModal({ aliases: joined ? joined.split(',') : [] })
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      patchAliasModal({ loading: false })
    }
  }

  const addAlias = async () => {
    if (!aliasModal.newAlias) {
      toast.warning(t`Please enter an alias`)
      return
    }
    if (aliasModal.extra && !isValidJson(aliasModal.extra)) {
      toast.error(t`Alias parameters are not valid JSON`)
      return
    }
    patchAliasModal({ adding: true })
    try {
      const res = await AddIndexAlias(aliasModal.index, aliasModal.newAlias, aliasModal.extra)
      if (res.err !== '') {
        toast.error(res.err)
      } else {
        toast.success(t`Alias added successfully`)
        patchAliasModal({ newAlias: '', extra: '' })
        await refreshAliasList()
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      patchAliasModal({ adding: false })
    }
  }

  const removeAlias = async (alias: string) => {
    if (!(await confirm({
      title: t`Warning`,
      content: t`Are you sure you want to remove alias ${alias}?`,
    }))) return
    const res = await RemoveIndexAlias(aliasModal.index, alias)
    if (res.err !== '') {
      toast.error(res.err)
    } else {
      toast.success(t`Alias removed`)
      await refreshAliasList()
    }
  }

  // ==================== Reindex ====================
  const openReindex = (row: IndexRow) => {
    setReindexModal({ show: true, source: row.index, dest: '', query: '', loading: false })
  }

  const doReindex = async () => {
    if (!reindexModal.dest) {
      toast.warning(t`Please enter the destination index`)
      return
    }
    if (reindexModal.query && !isValidJson(reindexModal.query)) {
      toast.error(t`Query DSL is not valid JSON`)
      return
    }
    patchReindexModal({ loading: true })
    try {
      const res = await Reindex(reindexModal.source, reindexModal.dest, reindexModal.query)
      if (res.err !== '') {
        toast.error(res.err)
      } else {
        toast.success(t`Reindex task submitted (async)`)
        patchReindexModal({ show: false })
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      patchReindexModal({ loading: false })
    }
  }

  // ==================== Mapping / Settings 编辑 ====================
  const editMapping = async (row: IndexRow) => {
    const res = await GetIndexInfo(row.index)
    if (res.err !== '') {
      toast.error(res.err)
      return
    }
    const info = (res.result && res.result[row.index]) || {}
    const mappings = info.mappings || {}
    setMappingModal({
      show: true,
      index: row.index,
      content: JSON.stringify(mappings, null, 2),
      saving: false,
    })
  }

  const saveMapping = async () => {
    if (!isValidJson(mappingModal.content)) {
      toast.error(t`Mapping is not valid JSON`)
      return
    }
    patchMappingModal({ saving: true })
    try {
      const res = await UpdateIndexMappings(mappingModal.index, mappingModal.content)
      if (res.err !== '') {
        toast.error(res.err)
      } else {
        toast.success(t`Mapping saved successfully`)
        patchMappingModal({ show: false })
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      patchMappingModal({ saving: false })
    }
  }

  const editSettings = async (row: IndexRow) => {
    const res = await GetIndexInfo(row.index)
    if (res.err !== '') {
      toast.error(res.err)
      return
    }
    const info = (res.result && res.result[row.index]) || {}
    const settings = (info.settings && info.settings.index) || {}
    setSettingsModal({
      show: true,
      index: row.index,
      content: JSON.stringify({ index: settings }, null, 2),
      saving: false,
    })
  }

  const saveSettings = async () => {
    if (!isValidJson(settingsModal.content)) {
      toast.error(t`Settings are not valid JSON`)
      return
    }
    patchSettingsModal({ saving: true })
    try {
      const res = await UpdateIndexSettings(settingsModal.index, settingsModal.content)
      if (res.err !== '') {
        toast.error(res.err)
      } else {
        toast.success(t`Settings saved successfully`)
        patchSettingsModal({ show: false })
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      patchSettingsModal({ saving: false })
    }
  }

  const bulk_delete = async () => {
    setLoading(true)
    let success_count = 0
    try {
      for (const Key in selection) {
        const res = await DeleteIndex(selection[Key])
        if (res.err !== '') {
          toast.error(res.err)
          break
        } else {
          success_count += 1
        }
      }
      setSelection([])
      const count = success_count
      toast.success(t`Successfully deleted ${count} indices`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
    await search()
  }

  // ==================== 行菜单分发 ====================
  const handleMenuSelect = async (key: string, row: IndexRow) => {
    const func: Record<string, (row: IndexRow) => void | Promise<void>> = {
      "addDocument": addDocument,
      "viewDetails": viewIndexDetails,
      "viewAlias": viewIndexAlias,
      "viewDocs": viewIndexDocs,
      "manageAlias": manageAlias,
      "editMapping": editMapping,
      "editSettings": editSettings,
      "reindex": openReindex,
      "mergeSegments": mergeSegments,
      "deleteIndex": deleteIndex,
      "refresh": refreshIndex,
      "openCloseIndex": openCloseIndex,
      "flush": flushIndex,
      "clearCache": clearCache,
    }
    setLoading(true)
    try {
      await func[key](row)
    } catch (e) {
      toast.error((e as Error).message)
    }
    setLoading(false)
  }
  // handleMenuSelect 每次渲染重建，经 ref 中转避免 columns 闭包过期
  const handleMenuSelectRef = useRef(handleMenuSelect)
  handleMenuSelectRef.current = handleMenuSelect

  // 批量删除（确认后执行）
  const bulkDeleteAction = async () => {
    // 断言为 string 仅为满足 lingui 模板占位符类型；运行时插值仍由 String() 拼接，输出与原实现一致
    const names = selection as unknown as string
    if (!(await confirm({
      title: t`Warning`,
      content: t`Are you sure you want to delete indices ${names}?`,
      type: 'error',
    }))) return
    await bulk_delete()
  }

  const [bulkMenuOpen, setBulkMenuOpen] = useState(false)

  // ==================== 列定义 ====================
  const columns = useMemo<IndexColumnList>(() => [
    {
      field: 'index',
      headerName: t`Index Name`,
      width: 220,
      renderCell: ({ row }: { row: IndexRow }) => (
        <p
          className="text-info cursor-pointer truncate"
          onClick={() => viewIndexDocs(row)}
        >
          {row.index}
        </p>
      ),
    },
    { field: 'alias', headerName: t`Alias`, width: 160 },
    {
      field: 'health',
      headerName: t`Health`,
      width: 110,
      renderCell: ({ row }: { row: IndexRow }) => {
        const variant = getType(row.health)
        return (
          <Badge variant={variant === 'error' ? 'destructive' : variant}>
            {row.health}
          </Badge>
        )
      },
    },
    {
      field: 'status',
      headerName: t`Status`,
      width: 100,
      renderCell: ({ row }: { row: IndexRow }) => {
        const variant = getType(row.status)
        return (
          <Badge variant={variant === 'error' ? 'destructive' : variant}>
            {row.status}
          </Badge>
        )
      },
    },
    {
      field: 'pri',
      headerName: t`Primary`,
      width: 90,
      align: 'right',
      valueGetter: (row: IndexRow) => Number(row['pri']),
    },
    {
      field: 'rep',
      headerName: t`Replica`,
      width: 90,
      align: 'right',
      valueGetter: (row: IndexRow) => Number(row['rep']),
    },
    {
      field: 'docs.count',
      headerName: t`Doc Count`,
      width: 110,
      align: 'right',
      valueGetter: (row: IndexRow) => Number(row['docs.count']),
    },
    {
      field: 'docs.deleted',
      headerName: t`Deleted Docs`,
      width: 120,
      align: 'right',
      valueGetter: (row: IndexRow) => Number(row['docs.deleted']),
    },
    {
      field: 'store.size',
      headerName: t`Store Size`,
      width: 120,
      align: 'right',
      valueGetter: (row: IndexRow) => Number(row['store.size']),
      renderCell: ({ row }: { row: IndexRow }) => <span>{formatBytes(row['store.size'])}</span>,
    },
    {
      field: 'actions',
      headerName: t`Actions`,
      width: 100,
      sortable: false,
      align: 'center',
      renderCell: ({ row }: { row: IndexRow }) => <RowActions row={row} onSelect={(...args: [string, IndexRow]) => handleMenuSelectRef.current(...args)} />,
    },
  ], [i18n])

  // 勾选列（DataTable 无内置多选，用列内 Checkbox 实现；selection 状态与批量删除逻辑不变）
  const selectionColumn: IndexColumnList[number] = {
    field: '__selection',
    headerName: '',
    width: 48,
    sortable: false,
    align: 'center',
    renderCell: ({ row }: { row: IndexRow }) => (
      <Checkbox
        checked={selection.includes(row.index)}
        onCheckedChange={(checked) => {
          setSelection((prev) => (checked ? [...prev, row.index] : prev.filter((k) => k !== row.index)))
        }}
      />
    ),
  }

  // CSV 导出列（headerName/field，store.size 保持原始值导出，与 Vue 版一致）
  const csvColumns = useMemo(() => [
    { field: 'index', headerName: t`Index Name` },
    { field: 'alias', headerName: t`Alias` },
    { field: 'health', headerName: t`Health` },
    { field: 'status', headerName: t`Status` },
    { field: 'pri', headerName: t`Primary` },
    { field: 'rep', headerName: t`Replica` },
    { field: 'docs.count', headerName: t`Doc Count` },
    { field: 'docs.deleted', headerName: t`Deleted Docs` },
    { field: 'store.size', headerName: t`Store Size` },
  ], [i18n])

  let count = data.length
  const totalMsg = t`${count} total`
  count = selection.length
  const selectedMsg = t`You selected ${count} rows.`

  // 分页（DataGrid 页码从 0 开始的逻辑保持不变，DataTable 关闭内置分页、由外层切片）
  const pageCount = Math.max(1, Math.ceil(data.length / paginationModel.pageSize))
  const pageStart = paginationModel.page * paginationModel.pageSize
  const pagedData = data.slice(pageStart, pageStart + paginationModel.pageSize)
  const onPaginationModelChange = (model: PaginationModel) => {
    setPaginationModel(model)
    localStorage.setItem(pageKey, String(model.pageSize))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2>{t`Index`}</h2>
        <p>{totalMsg}</p>
      </div>

      <div className="flex items-center gap-2">
        {/* 搜索框宽度 = 按钮之外剩余空间的 2/3：外层 flex-1 占满剩余空间，内层 w-2/3 取其中三分之二 */}
        <div className="flex-1 min-w-0">
          <Input
            className="w-2/3"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder={t`Fuzzy search index`}
            onKeyDown={(e) => { if (e.key === 'Enter') search() }}
          />
        </div>
        <Button variant="ghost" size="icon" onClick={search} aria-label="search">
          <Search className="size-4" />
        </Button>
        <Button onClick={openCreateIndex}>
          <Plus className="size-4" />
          {t`Add Index`}
        </Button>
        <Button onClick={downloadAllDataCsv}>
          <FolderInput className="size-4" />
          {t`Export CSV`}
        </Button>
        <Button onClick={queryAlias}>
          <Megaphone className="size-4" />
          {t`Read Aliases`}
        </Button>
        <Button
          disabled={downloadIndexConfig.loading}
          onClick={() => patchDownloadIndexConfig({ show: true })}
        >
          <FolderInput className="size-4" />
          {t`Index Backup (Preview)`}
        </Button>
      </div>

      <div className="relative">
        <DataTable
          columns={[selectionColumn, ...columns]}
          rows={pagedData}
          getRowId={rowKey}
          pagination={false}
        />
        {loading && (
          <div className="absolute inset-0 z-[1] flex items-center justify-center gap-1 bg-white/60">
            <Spinner size={24} />
            <p>{t`Connecting...`}</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 text-[13px] text-muted-foreground">
        <span>page {paginationModel.page + 1} / {pageCount}</span>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={paginationModel.page <= 0}
          aria-label="previous page"
          onClick={() => onPaginationModelChange({ ...paginationModel, page: paginationModel.page - 1 })}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={paginationModel.page >= pageCount - 1}
          aria-label="next page"
          onClick={() => onPaginationModelChange({ ...paginationModel, page: paginationModel.page + 1 })}
        >
          <ChevronRight className="size-4" />
        </Button>
        <Select
          value={String(paginationModel.pageSize)}
          onValueChange={(v) => onPaginationModelChange({ page: 0, pageSize: Number(v) })}
        >
          <SelectTrigger className="w-[80px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((size) => (
              <SelectItem key={size} value={String(size)}>{size}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <DropdownMenu open={bulkMenuOpen} onOpenChange={setBulkMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              {t`Batch Actions`}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              onClick={() => {
                setBulkMenuOpen(false)
                bulkDeleteAction()
              }}
            >
              {t`Delete`}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <p>{selectedMsg}</p>
      </div>

      {/* 索引备份 */}
      <Dialog
        open={downloadIndexConfig.show}
        onOpenChange={(v) => { if (!v) patchDownloadIndexConfig({ show: false }) }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t`Index Backup (Preview)`}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-left">
            <p>{t`[This feature is still in testing. Please enter the QQ group number, otherwise download will not work. If you encounter bugs, please report to the group owner.]`}</p>
            <p>{t`Enter index name to backup`}</p>
            <Input
              value={downloadIndexConfig.indexName}
              onChange={(e) => patchDownloadIndexConfig({ indexName: e.target.value })}
            />
            <p>{t`Enter query DSL, leave empty for all`}</p>
            <Textarea
              className="font-mono"
              rows={3}
              value={downloadIndexConfig.dsl}
              onChange={(e) => patchDownloadIndexConfig({ dsl: e.target.value })}
            />
            <p>{t`Verification code (QQ group number), please check on GitHub`}</p>
            <Input
              value={downloadIndexConfig.code}
              onChange={(e) => patchDownloadIndexConfig({ code: e.target.value })}
            />
            {downloadIndexConfig.msg && <p>{downloadIndexConfig.msg}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => patchDownloadIndexConfig({ show: false })}>{t`Cancel`}</Button>
            <Button
              disabled={downloadIndexConfig.loading}
              onClick={downloadIndex}
            >
              {t`Start Download`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* JSON 查看弹窗 */}
      <Dialog
        open={jsonDialog.show}
        onOpenChange={(v) => { if (!v) setJsonDialog((prev) => ({ ...prev, show: false })) }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{jsonDialog.title}</DialogTitle>
          </DialogHeader>
          <pre
            className="m-0 text-left font-mono text-[13px] whitespace-pre-wrap break-all"
          >
            {jsonDialog.content}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setJsonDialog((prev) => ({ ...prev, show: false }))}>{t`Close`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新建索引 */}
      <Dialog
        open={createDialogVisible}
        onOpenChange={(v) => { if (!v) setCreateDialogVisible(false) }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t`Create Index`}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 text-left">
            <div className="flex flex-col gap-2">
              <Label>{t`From Template`}</Label>
              <Select
                value={indexConfig.template || undefined}
                onValueChange={(v) => setIndexConfig((prev) => ({ ...prev, template: v }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t`Select an index template (optional)`} />
                </SelectTrigger>
                <SelectContent>
                  {templateOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t`Index Name`}<span className="text-destructive"> *</span></Label>
              <Input
                value={indexConfig.name}
                onChange={(e) => setIndexConfig((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t`Primary Shards`}<span className="text-destructive"> *</span></Label>
              <Input
                type="number"
                value={indexConfig.numberOfShards}
                onChange={(e) => setIndexConfig((prev) => ({ ...prev, numberOfShards: e.target.value === '' ? '' : Number(e.target.value) }))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t`Number of Replicas`}<span className="text-destructive"> *</span></Label>
              <Input
                type="number"
                value={indexConfig.numberOfReplicas}
                onChange={(e) => setIndexConfig((prev) => ({ ...prev, numberOfReplicas: e.target.value === '' ? '' : Number(e.target.value) }))}
              />
            </div>
            <p>{t`mapping`}</p>
            <Textarea
              className="font-mono text-left"
              rows={6}
              placeholder={MAPPING_PLACEHOLDER}
              value={indexConfig.mapping}
              onChange={(e) => setIndexConfig((prev) => ({ ...prev, mapping: e.target.value }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogVisible(false)}>{t`Cancel`}</Button>
            <Button disabled={addIndexLoading} onClick={addIndex}>
              {t`Save`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 添加文档 */}
      <Dialog
        open={addDocDialogVisible}
        onOpenChange={(v) => { if (!v) setAddDocDialogVisible(false) }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t`Add Document`}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-left">
            <p>{t`Document Content`}</p>
            <Textarea
              className="font-mono text-left"
              rows={6}
              placeholder={DOC_PLACEHOLDER}
              value={docConfig.doc}
              onChange={(e) => setDocConfig((prev) => ({ ...prev, doc: e.target.value }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDocDialogVisible(false)}>{t`Cancel`}</Button>
            <Button disabled={addDocLoading} onClick={addDocumentFunc}>
              {t`Save`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 别名管理 */}
      <Dialog
        open={aliasModal.show}
        onOpenChange={(v) => { if (!v) patchAliasModal({ show: false }) }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t`Alias Management`} - {aliasModal.index}</DialogTitle>
          </DialogHeader>
          <div className="relative">
            {aliasModal.loading && (
              <div className="absolute inset-0 z-[1] flex items-center justify-center">
                <Spinner size={24} />
              </div>
            )}
            {aliasModal.aliases.length === 0 ? (
              <div className="py-4 text-center">
                <p className="text-muted-foreground">{t`No aliases`}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {aliasModal.aliases.map((alias) => (
                  <div key={alias} className="flex items-center justify-between">
                    <Badge variant="info">{alias}</Badge>
                    <Button variant="destructive" size="sm" onClick={() => removeAlias(alias)}>
                      {t`Delete`}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Separator className="my-3" />
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label>{t`New Alias`}</Label>
              <Input
                placeholder="my-alias"
                value={aliasModal.newAlias}
                onChange={(e) => patchAliasModal({ newAlias: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') addAlias() }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t`Alias Parameters (optional, e.g. filter, routing)`}</Label>
              <Textarea
                className="font-mono text-left"
                rows={1}
                placeholder={ALIAS_EXTRA_PLACEHOLDER}
                value={aliasModal.extra}
                onChange={(e) => patchAliasModal({ extra: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => patchAliasModal({ show: false })}>{t`Close`}</Button>
            <Button disabled={aliasModal.adding} onClick={addAlias}>
              {t`Add Alias`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reindex */}
      <Dialog
        open={reindexModal.show}
        onOpenChange={(v) => { if (!v) patchReindexModal({ show: false }) }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t`Reindex`}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 text-left">
            <div className="flex flex-col gap-2">
              <Label>{t`Source Index`}</Label>
              <Input value={reindexModal.source} disabled />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t`Destination Index`}</Label>
              <Input
                placeholder={t`Destination index name (may not exist yet)`}
                value={reindexModal.dest}
                onChange={(e) => patchReindexModal({ dest: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t`Filter (optional, query clause JSON)`}</Label>
              <Textarea
                className="font-mono text-left"
                rows={3}
                placeholder={REINDEX_QUERY_PLACEHOLDER}
                value={reindexModal.query}
                onChange={(e) => patchReindexModal({ query: e.target.value })}
              />
            </div>
            <p className="text-[13px] text-muted-foreground">
              {t`Data copy will run asynchronously in the background. Check progress on the Task page.`}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => patchReindexModal({ show: false })}>{t`Cancel`}</Button>
            <Button disabled={reindexModal.loading} onClick={doReindex}>
              {t`Execute`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mapping 编辑 */}
      <Dialog
        open={mappingModal.show}
        onOpenChange={(v) => { if (!v) patchMappingModal({ show: false }) }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t`Edit Mapping`} - {mappingModal.index}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Alert variant="warning">
              <AlertDescription>
                {t`You can only add new fields or change dynamic parameters. Changing types of existing fields will be rejected by ES.`}
              </AlertDescription>
            </Alert>
            <Textarea
              className="font-mono text-left"
              rows={12}
              value={mappingModal.content}
              onChange={(e) => patchMappingModal({ content: e.target.value })}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => patchMappingModal({ show: false })}>{t`Cancel`}</Button>
            <Button disabled={mappingModal.saving} onClick={saveMapping}>
              {t`Save`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings 编辑 */}
      <Dialog
        open={settingsModal.show}
        onOpenChange={(v) => { if (!v) patchSettingsModal({ show: false }) }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t`Edit Settings`} - {settingsModal.index}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Alert variant="info">
              <AlertDescription>
                {t`Only dynamically updatable settings are supported (e.g. number_of_replicas, refresh_interval)`}
              </AlertDescription>
            </Alert>
            <Textarea
              className="font-mono text-left"
              rows={12}
              value={settingsModal.content}
              onChange={(e) => patchSettingsModal({ content: e.target.value })}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => patchSettingsModal({ show: false })}>{t`Cancel`}</Button>
            <Button disabled={settingsModal.saving} onClick={saveSettings}>
              {t`Save`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
