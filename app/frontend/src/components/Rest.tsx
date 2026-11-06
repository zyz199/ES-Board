import { useEffect, useMemo, useRef, useState } from 'react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from '@/components/ui/sonner'
import {
  BookOpen, ChevronLeft, ChevronRight, Download, History, Plus,
  Search as SearchIcon, Send, Table as TableIcon, X,
} from 'lucide-react'
import { t } from '@lingui/macro'
import { useLingui } from '@lingui/react'
import emitter from '../utils/eventBus'
import { flattenObject, formatTimestamp } from '../utils/common'
import { Search } from '../../wailsjs/go/service/ESService'
import { GetConfig, GetHistory, SaveHistory } from '../../wailsjs/go/config/AppConfig'
import { types } from '../../wailsjs/go/models'

// jsoneditor 1.4.12 无类型声明：import 用 @ts-expect-error 放行，实例成员在本文件的 JsonEditorInstance 里描述
// @ts-expect-error jsoneditor 无官方类型声明
import JSONEditor from 'jsoneditor'
import '../assets/css/jsoneditor.min.css'
import 'jsoneditor/src/js/ace/theme-jsoneditor'
import 'ace-builds/src-noconflict/mode-text'
import 'ace-builds/src-noconflict/ext-language_tools'
import 'ace-builds/src-noconflict/theme-textmate'
import 'ace-builds/src-noconflict/theme-monokai'
import ace from 'ace-builds'

// jsoneditor（1.4.12）无类型声明：本文件只声明到用到的实例成员
interface JsonEditorInstance {
  set(value: unknown): void
  setText(text: string | null): void
  getText(): string
  format(): void
  destroy(): void
  // ace-builds 1.4.12 亦无类型声明，aceEditor 上的 API 一律按 any 使用
  aceEditor: any
}

// 单个查询 Tab
interface QueryTab {
  id: number
  label: string
  method: string
  path: string
  dsl: string
  response: string
}

// 结果表格的行：固定 id/_id/_index + flattenObject 展开出来的动态字段
interface ResultTableRow {
  id: string
  _id?: unknown
  _index?: unknown
  [key: string]: unknown
}

const methodOptions = ['GET', 'POST', 'PUT', 'HEAD', 'PATCH', 'OPTIONS', 'DELETE']

// MUI Chip color → Badge variant
const badgeVariantMap = {
  success: 'success',
  info: 'info',
  warning: 'warning',
  error: 'destructive',
  default: 'secondary',
} as const

// getMethodTagType 的返回值即 badgeVariantMap 的键
type ChipColor = keyof typeof badgeVariantMap

const defaultEndpoints = [
  '_search', '_cluster/health', '_cluster/state', '_cluster/stats',
  '_cat/indices', '_cat/nodes', '_cat/shards', '_cat/allocation',
  '_cat/count', '_cat/health', '_nodes/stats', '_tasks', '_flush',
  '_refresh', '_mapping', '_settings', '_stats', '_bulk', '_update',
  '_msearch', '_aliases', '_rollover', '_reindex', '_forcemerge',
  '_count', '_analyze'
]

const keywords = [
  {word: 'query', meta: 'keyword'},
  {word: 'bool', meta: 'keyword'},
  {word: 'filter', meta: 'keyword'},
  {word: 'must', meta: 'keyword'},
  {word: 'should', meta: 'keyword'},
  {word: 'must_not', meta: 'keyword'},
  {word: 'term', meta: 'keyword'},
  {word: 'terms', meta: 'keyword'},
  {word: 'match', meta: 'keyword'},
  {word: 'match_phrase', meta: 'keyword'},
  {word: 'multi_match', meta: 'keyword'},
  {word: 'range', meta: 'keyword'},
  {word: 'exists', meta: 'keyword'},
  {word: 'prefix', meta: 'keyword'},
  {word: 'wildcard', meta: 'keyword'},
  {word: 'regexp', meta: 'keyword'},
  {word: 'aggs', meta: 'keyword'},
  {word: 'aggregations', meta: 'keyword'},
  {word: 'terms', meta: 'aggregation'},
  {word: 'sum', meta: 'aggregation'},
  {word: 'avg', meta: 'aggregation'},
  {word: 'min', meta: 'aggregation'},
  {word: 'max', meta: 'aggregation'},
  {word: 'stats', meta: 'aggregation'},
  {word: 'cardinality', meta: 'aggregation'},
  {word: 'histogram', meta: 'aggregation'},
  {word: 'date_histogram', meta: 'aggregation'},
  {word: 'top_hits', meta: 'aggregation'},
  {word: 'size', meta: 'keyword'},
  {word: 'from', meta: 'keyword'},
  {word: 'sort', meta: 'keyword'},
  {word: 'track_total_hits', meta: 'keyword'},
  {word: '_source', meta: 'keyword'},
  {word: 'fields', meta: 'keyword'},
  {word: 'script', meta: 'keyword'},
  {word: 'gte', meta: 'range'},
  {word: 'lte', meta: 'range'},
  {word: 'gt', meta: 'range'},
  {word: 'lt', meta: 'range'},
  {word: 'boost', meta: 'keyword'},
  {word: 'minimum_should_match', meta: 'keyword'},
  {word: 'nested', meta: 'keyword'},
  {word: 'path', meta: 'keyword'},
  {word: 'score_mode', meta: 'keyword'},
  {word: 'bucket', meta: 'aggregation'},
  {word: 'order', meta: 'keyword'},
  {word: 'asc', meta: 'sort'},
  {word: 'desc', meta: 'sort'}
]

const dslExamples = {
  term: JSON.stringify({
    "query": {
      "term": {
        "status": "active"
      }
    },
    "size": 10,
    "track_total_hits": true
  }, null, 2),

  terms: JSON.stringify({
    "query": {
      "terms": {
        "user_id": [1, 2, 3, 4]
      }
    },
    "size": 10
  }, null, 2),

  match: JSON.stringify({
    "query": {
      "match": {
        "description": "quick brown fox"
      }
    },
    "size": 20
  }, null, 2),

  matchPhrase: JSON.stringify({
    "query": {
      "match_phrase": {
        "description": {
          "query": "quick brown fox",
          "slop": 1
        }
      }
    }
  }, null, 2),

  range: JSON.stringify({
    "query": {
      "range": {
        "age": {
          "gte": 20,
          "lte": 30
        }
      }
    }
  }, null, 2),

  bool: JSON.stringify({
    "query": {
      "bool": {
        "must": [
          {"term": {"status": "active"}}
        ],
        "must_not": [
          {"term": {"type": "deleted"}}
        ],
        "should": [
          {"term": {"category": "electronics"}},
          {"term": {"category": "computers"}}
        ],
        "minimum_should_match": 1
      }
    }
  }, null, 2),

  termsAggs: JSON.stringify({
    "aggs": {
      "status_counts": {
        "terms": {
          "field": "status",
          "missing": "N/A",
          "size": 10
        }
      }
    },
    "size": 0
  }, null, 2),

  dateHistogram: JSON.stringify({
    "aggs": {
      "sales_over_time": {
        "date_histogram": {
          "field": "created_at",
          "calendar_interval": "1d",
          "format": "yyyy-MM-dd"
        }
      }
    },
    "size": 0
  }, null, 2),

  nested: JSON.stringify({
    "query": {
      "nested": {
        "path": "comments",
        "query": {
          "bool": {
            "must": [
              {"match": {"comments.text": "great"}},
              {"term": {"comments.rating": 5}}
            ]
          }
        }
      }
    }
  }, null, 2),

  exists: JSON.stringify({
    "query": {
      "exists": {
        "field": "email"
      }
    }
  }, null, 2),

  multiMatch: JSON.stringify({
    "query": {
      "multi_match": {
        "query": "quick brown fox",
        "fields": ["title", "description^2"],
        "type": "best_fields"
      }
    }
  }, null, 2),

  wildcard: JSON.stringify({
    "query": {
      "wildcard": {
        "email": "*@gmail.com"
      }
    }
  }, null, 2),

  metrics: JSON.stringify({
    "aggs": {
      "avg_price": {"avg": {"field": "price"}},
      "max_price": {"max": {"field": "price"}},
      "min_price": {"min": {"field": "price"}},
      "sum_quantity": {"sum": {"field": "quantity"}}
    },
    "size": 0
  }, null, 2),

  cardinality: JSON.stringify({
    "aggs": {
      "unique_users": {
        "cardinality": {
          "field": "user_id",
          "precision_threshold": 100
        }
      }
    },
    "size": 0
  }, null, 2),

  script: JSON.stringify({
    "query": {
      "script_score": {
        "query": {"match_all": {}},
        "script": {
          "source": "doc['price'].value * doc['rating'].value",
          "lang": "painless"
        }
      }
    }
  }, null, 2)
}

export default function Rest() {
  const [method, setMethod] = useState('POST')
  const [searchText, setSearchText] = useState('')
  const [history, setHistory] = useState<types.History[]>([])
  const [sendLoading, setSendLoading] = useState(false)
  const [showDrawer, setShowDrawer] = useState(false)
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize] = useState(10)
  const [showTableView, setShowTableView] = useState(false)
  const [lastResponseText, setLastResponseText] = useState('')

  // ==================== 多Tab ====================
  const tabSeqRef = useRef(1)
  const [tabs, setTabs] = useState<QueryTab[]>([{id: 1, label: 'Tab 1', method: 'POST', path: '', dsl: '', response: ''}])
  const [activeTabId, setActiveTabId] = useState(1)
  const activeTabIdRef = useRef(1)
  const [urlPath, setUrlPath] = useState('')

  // jsoneditor 实例与容器
  const jsonEditorElRef = useRef<HTMLDivElement | null>(null)
  const jsonViewElRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<JsonEditorInstance | null>(null)
  const responseRef = useRef<JsonEditorInstance | null>(null)

  const urlCompletions = useMemo(() => {
    const cur = (urlPath || '').trim()
    const list = [...defaultEndpoints]
    try {
      const stored = localStorage.getItem('es_king_indexes')
      if (stored) {
        const idxList = JSON.parse(stored)
        for (const idx of idxList) {
          list.push(idx)
          list.push(`${idx}/_search`)
          list.push(`${idx}/_mapping`)
          list.push(`${idx}/_settings`)
          list.push(`${idx}/_count`)
        }
      }
    } catch { /* ignore */ }

    if (!cur) {
      return list.slice(0, 20).map(v => '/' + v.replace(/^\//, ''))
    }

    const query = cur.replace(/^\//, '').toLowerCase()
    const matched = list.filter(item => item.toLowerCase().includes(query))
    return matched.slice(0, 25).map(v => cur.startsWith('/') ? '/' + v.replace(/^\//, '') : v)
  }, [urlPath])

  const handleUrlInput = (val: string) => {
    setUrlPath(val)
    setTabs(prev => prev.map(item => item.id === activeTabId ? {...item, path: val} : item))
  }

  const addTab = () => {
    tabSeqRef.current += 1
    const id = tabSeqRef.current
    // tab 数据要同时传给 changeTab：setTabs 是异步的，loadTab 若从闭包里找会拿不到新 tab
    const tab = {
      id,
      label: `Tab ${id}`,
      method: 'POST',
      path: '',
      dsl: '',
      response: '',
    }
    setTabs(prev => [...prev, tab])
    changeTab(id, tab)
  }

  const closeTab = (tabId: number) => {
    const idx = tabs.findIndex(item => item.id === tabId)
    if (idx === -1) return
    const nextTabs = tabs.filter(item => item.id !== tabId)
    if (nextTabs.length === 0) {
      tabSeqRef.current = 1
      const fresh = {id: 1, label: 'Tab 1', method: 'POST', path: '', dsl: '', response: ''}
      setTabs([fresh])
      changeTab(1, fresh)
      return
    }
    setTabs(nextTabs)
    if (activeTabId === tabId) {
      const next = nextTabs[Math.min(idx, nextTabs.length - 1)]
      changeTab(next.id)
    }
  }

  // 切tab：先把当前内容存进旧tab，再恢复新tab的内容
  // tabOverride：刚创建/重建的 tab 还不在 state 里，直接把数据带过来
  const changeTab = (newId: number, tabOverride?: QueryTab) => {
    const oldId = activeTabIdRef.current
    if (oldId !== undefined && oldId !== newId) {
      persistToTab(oldId)
    }
    activeTabIdRef.current = newId
    setActiveTabId(newId)
    loadTab(newId, tabOverride)
  }

  const loadTab = (tabId: number, tabOverride?: QueryTab) => {
    const tab = tabOverride || tabs.find(item => item.id === tabId)
    if (!tab) return
    setMethod(tab.method || 'POST')
    setUrlPath(tab.path || '')
    if (editorRef.current) {
      editorRef.current.setText(tab.dsl || '')
    }
    const respText = t`{"tip": "Response result, searchable"}`
    if (responseRef.current) {
      if (tab.response) {
        try {
          responseRef.current.set(JSON.parse(tab.response))
        } catch {
          responseRef.current.setText(tab.response)
        }
      } else {
        responseRef.current.setText(respText)
      }
    }
    setLastResponseText(tab.response || '')
  }

  // 把当前编辑器内容保存进对应tab
  const persistToTab = (tabId: number) => {
    setTabs(prev => prev.map(item => {
      if (item.id !== tabId) return item
      return {
        ...item,
        method,
        path: urlPath || '',
        dsl: editorRef.current ? editorRef.current.getText() : (item.dsl || ''),
        response: lastResponseText || '',
      }
    }))
  }

  // ==================== 结果表格视图 ====================
  const tableRows = useMemo<ResultTableRow[]>(() => {
    if (!showTableView || !lastResponseText) return []
    try {
      const parsed = JSON.parse(lastResponseText)
      const hits = parsed?.hits?.hits
      if (!Array.isArray(hits)) return []
      return hits.map((hit, i) => ({
        id: `${hit._index ?? ''}#${hit._id ?? ''}#${i}`,
        _id: hit._id,
        _index: hit._index,
        ...flattenObject(hit._source || {}),
      }))
    } catch {
      return []
    }
  }, [showTableView, lastResponseText])

  const tableColumns = useMemo(() => {
    const keyCount: Record<string, number> = {}
    for (const row of tableRows.slice(0, 50)) {
      for (const key of Object.keys(row)) {
        if (key === 'id') continue
        keyCount[key] = (keyCount[key] || 0) + 1
      }
    }
    return Object.keys(keyCount)
        .sort((a, b) => keyCount[b] - keyCount[a] || a.localeCompare(b))
        .slice(0, 20)
        .map(key => ({
          field: key,
          headerName: key,
          width: key === '_id' || key === '_index' ? 220 : 180,
          renderCell: ({ row }: { row: ResultTableRow }) => {
            const value = row[key]
            if (value === null || value === undefined) return ''
            if (typeof value === 'object') return JSON.stringify(value)
            return String(value)
          },
        }))
  }, [tableRows])

  // ==================== 请求与历史 ====================
  const read_history = async () => {
    try {
      setHistory(await GetHistory())
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const write_history = async () => {
    try {
      let updated: types.History[] = [{
        timestamp: Date.now(),
        method,
        path: urlPath || '',
        dsl: editorRef.current ? editorRef.current.getText() : ''
      }, ...history]
      if (updated.length > 100) {
        updated = updated.slice(0, 100)
      }
      setHistory(updated)
      const res = await SaveHistory(updated)
      if (res !== "") {
        const msg = res
        toast.error(t`Failed to save query: ${msg}`)
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleHistoryClick = (m: string, p: string, d: string) => {
    setMethod(m)
    handleUrlInput(p)
    editorRef.current?.setText(d)
    setShowHistoryDrawer(false)
  }

  const sendRequest = async () => {
    setSendLoading(true)
    if (responseRef.current) responseRef.current.set({})
    let path = (urlPath || '').trim()
    if (path && !path.startsWith('/')) {
      path = '/' + path
      handleUrlInput(path)
    }
    try {
      const dsl = editorRef.current ? editorRef.current.getText() : ''
      const res = await Search(method, path, dsl)
      if (res.err !== "") {
        try {
          responseRef.current!.set(JSON.parse(res.err))
        } catch {
          responseRef.current!.set(res.err)
        }
        setLastResponseText('')
      } else {
        responseRef.current!.set(res.result)
        setLastResponseText(JSON.stringify(res.result))
        await write_history()
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      persistToTab(activeTabId)
      setSendLoading(false)
    }
  }

  const insertExample = (code: string) => {
    editorRef.current?.setText(code)
    setShowDrawer(false)
  }

  const toTree = () => {
    editorRef.current?.format()
  }

  const exportJson = () => {
    const blob = new Blob([responseRef.current!.getText()], {type: 'application/json'})
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'response.json'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const filteredHistory = useMemo(() => {
    if (!searchText) {
      return history
    } else {
      return history.filter(item => {
        return item.method.includes(searchText) ||
            item.path.includes(searchText) ||
            item.dsl.includes(searchText)
      })
    }
  }, [history, searchText])

  const currentPageData = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    const end = start + pageSize
    return filteredHistory.slice(start, end)
  }, [filteredHistory, currentPage, pageSize])

  const getMethodTagType = (m: string): ChipColor => {
    const types: Record<string, ChipColor> = {
      'GET': 'success',
      'POST': 'info',
      'PUT': 'warning',
      'DELETE': 'error'
    }
    return types[m] || 'default'
  }

  const formatDSL = (dsl: string) => {
    try {
      return JSON.stringify(JSON.parse(dsl), null, 2)
    } catch {
      return dsl
    }
  }

  // 示例列表（带i18n标题，供抽屉渲染与一键插入）
  // 依赖 i18n：语言切换时 I18nProvider 触发重渲染，useMemo 需随之失效，否则示例标题仍是旧语言
  const { i18n } = useLingui()
  const exampleList = useMemo(() => [
    {key: 'term', title: t`Term Query`, code: dslExamples.term},
    {key: 'terms', title: t`Terms Query`, code: dslExamples.terms},
    {key: 'match', title: t`Match Query`, code: dslExamples.match},
    {key: 'matchPhrase', title: t`Match Phrase Query`, code: dslExamples.matchPhrase},
    {key: 'range', title: t`Range Query`, code: dslExamples.range},
    {key: 'bool', title: t`Bool Compound Query`, code: dslExamples.bool},
    {key: 'termsAggs', title: t`Terms Aggregation`, code: dslExamples.termsAggs},
    {key: 'dateHistogram', title: t`Date Histogram Aggregation`, code: dslExamples.dateHistogram},
    {key: 'nested', title: t`Nested Query`, code: dslExamples.nested},
    {key: 'exists', title: t`Exists Query`, code: dslExamples.exists},
    {key: 'multiMatch', title: t`Multi-match Query`, code: dslExamples.multiMatch},
    {key: 'wildcard', title: t`Wildcard Query`, code: dslExamples.wildcard},
    {key: 'metrics', title: t`Metrics Aggregation`, code: dslExamples.metrics},
    {key: 'cardinality', title: t`Cardinality Aggregation`, code: dslExamples.cardinality},
    {key: 'script', title: t`Script Query`, code: dslExamples.script},
  ], [i18n])

  // ==================== 生命周期 ====================
  useEffect(() => {
    let cancelled = false

    const selectNodeHandler = () => {
      responseRef.current?.setText(t`{"tip": "Response result, searchable"}`)
      setLastResponseText('')
      setSendLoading(false)
    }

    // emitter 事件负载无类型约束，保留字符串/对象两种形式的原判断逻辑
    const themeChange = (newTheme: any) => {
      // update_theme 的负载是字符串（'dark'/'light'），这里同时兼容对象形式以防万一
      const isDark = newTheme === 'dark' || newTheme?.name === 'dark'
      const new_editor_theme = isDark ? 'ace/theme/monokai' : 'ace/theme/textmate'
      editorRef.current?.aceEditor?.setTheme(new_editor_theme)
      responseRef.current?.aceEditor?.setTheme(new_editor_theme)
    }

    emitter.on('selectNode', selectNodeHandler)
    emitter.on('update_theme', themeChange)

    ;(async () => {
      let loadedConfig = null
      try {
        loadedConfig = await GetConfig()
      } catch {
        // dev 浏览器中无 wails runtime
      }
      if (cancelled) return
      if (loadedConfig) {
        let theme = 'ace/theme/jsoneditor'
        if (loadedConfig.theme !== 'light') {
          theme = 'ace/theme/monokai'
        }
        editorRef.current = new JSONEditor(jsonEditorElRef.current, {
          mode: 'code',
          ace: ace,
          theme: theme,
          mainMenuBar: false,
          statusBar: false,
          showPrintMargin: false,
          placeholder: t`Request Body`
        });
        responseRef.current = new JSONEditor(jsonViewElRef.current, {
          mode: 'code',
          ace: ace,
          theme: theme,
          mainMenuBar: false,
          statusBar: false,
          showPrintMargin: false,
        });
        editorRef.current!.setText(null)
        editorRef.current!.aceEditor.setOptions({
          enableBasicAutocompletion: true,
          enableLiveAutocompletion: true
        })

        const customCompleter = {
          // ace-builds 1.4.12 无类型声明：回调形参按实际情况标注
          getCompletions: (ed: any, session: any, pos: any, prefix: string, callback: any) => {
            const suggestions = keywords
                .filter(k => k.word.startsWith(prefix))
                .map(k => ({
                  caption: k.word,
                  value: k.word,
                  meta: k.meta
                }));
            callback(null, suggestions);
          }
        };

        editorRef.current!.aceEditor.completers = [customCompleter];

        responseRef.current!.setText(t`{"tip": "Response result, searchable"}`)
      }
      await read_history()
    })()

    return () => {
      cancelled = true
      emitter.off('selectNode', selectNodeHandler)
      emitter.off('update_theme', themeChange)
      editorRef.current?.destroy()
      responseRef.current?.destroy()
      editorRef.current = null
      responseRef.current = null
    }
  }, [])

  const historyPageCount = Math.max(1, Math.ceil((filteredHistory?.length || 0) / pageSize))

  return (
    <div className="flex flex-col gap-2">
      <style>{`
        .es-rest-editarea { height: 72dvh; }
        .es-rest-editarea .ace_editor:not(.ace_focus) .ace_cursor { opacity: 0 !important; }
        .es-rest-editarea .ace_editor .ace_placeholder { position: absolute; z-index: 10; }
      `}</style>

      <div className="flex items-center gap-1">
        <h2 className="text-lg font-semibold">{t`REST`}</h2>
        <span className="text-[13px] text-muted-foreground">{t`A RESTful debug tool with formatting/DSL autocomplete/examples/download/history`}</span>
      </div>

      {/* 查询Tab */}
      <div className="flex items-center">
        <Tabs
          value={String(activeTabId)}
          onValueChange={(v) => changeTab(Number(v))}
          className="flex-1"
        >
          <TabsList className="w-full justify-start overflow-x-auto">
            {tabs.map(tab => (
              <TabsTrigger
                key={tab.id}
                value={String(tab.id)}
                className="flex-none gap-1 px-3"
              >
                <span>{tab.label}</span>
                {tabs.length > 1 && (
                  <span
                    className="inline-flex items-center rounded-full p-0.5 hover:bg-accent"
                    onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                  >
                    <X className="size-3.5" />
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button variant="ghost" size="icon-sm" onClick={addTab}><Plus className="size-4" /></Button>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {methodOptions.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="min-w-[320px] flex-1">
          <Input
            list="rest-url-completions"
            value={urlPath}
            onChange={(e) => handleUrlInput(e.target.value)}
            placeholder={t`Enter REST API path starting with /; use POST for queries; GET does not carry body`}
          />
          <datalist id="rest-url-completions">
            {urlCompletions.map(v => <option key={v} value={v} />)}
          </datalist>
        </div>

        <Button
          disabled={sendLoading}
          onClick={sendRequest}
        >
          <Send className="size-4" />
          {t`Send`}
        </Button>
        <Button variant="outline" onClick={() => setShowHistoryDrawer(true)}>
          <History className="size-4" />
          {t`History`}
        </Button>
        <Button variant="outline" onClick={() => setShowDrawer(true)}>
          <BookOpen className="size-4" />
          {t`ES Query Examples`}
        </Button>
        <Button
          variant={showTableView ? 'default' : 'outline'}
          onClick={() => setShowTableView(!showTableView)}
        >
          <TableIcon className="size-4" />
          {t`Table View`}
        </Button>
        <Button variant="outline" onClick={exportJson}>
          <Download className="size-4" />
          {t`Export Result`}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-5">
        <div
          ref={jsonEditorElRef}
          className="es-rest-editarea whitespace-pre-wrap"
          onPaste={toTree}
        />
        <div
          ref={jsonViewElRef}
          className={`es-rest-editarea ${showTableView ? 'hidden' : 'block'}`}
        />
        {showTableView && (
          <div className="es-rest-editarea overflow-auto">
            <DataTable
              columns={tableColumns}
              rows={tableRows}
              getRowId={(row) => row.id}
              pagination={false}
            />
          </div>
        )}
      </div>

      {/* 示例抽屉 */}
      {showDrawer && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowDrawer(false)} />
          <div className="absolute inset-y-0 right-0 flex w-[38.2%] max-w-full flex-col gap-2 overflow-y-auto border-l bg-background p-2 text-left shadow-xl">
            <div className="text-lg font-semibold">{t`ES DSL Query Examples`}</div>
            <div>
              {exampleList.map((example, idx) => (
                <Accordion key={example.key} type="multiple">
                  <AccordionItem value={example.key}>
                    <AccordionTrigger className="hover:no-underline">
                      <span className="flex w-full items-center justify-between pr-2">
                        <span>{idx + 1}. {example.title}</span>
                        <Button
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); insertExample(example.code) }}
                        >
                          {t`Insert`}
                        </Button>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <pre className="m-0 text-left font-mono text-[13px] whitespace-pre-wrap break-all">
                        {example.code}
                      </pre>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 历史记录抽屉 */}
      {showHistoryDrawer && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowHistoryDrawer(false)} />
          <div className="absolute inset-y-0 right-0 flex w-[38.2%] max-w-full flex-col gap-2 overflow-y-auto border-l bg-background p-2 text-left shadow-xl">
            <div className="text-lg font-semibold">{t`History`}</div>
            <div className="relative">
              <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder={t`Search history by method, path, or DSL`}
                className="pl-8"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage(currentPage - 1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-[13px] text-muted-foreground">
                {currentPage} / {historyPageCount}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={currentPage >= historyPageCount}
                onClick={() => setCurrentPage(currentPage + 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>

            <div>
              {currentPageData.map(item => (
                <div
                  key={item.timestamp}
                  className="cursor-pointer py-1.5"
                  onClick={() => handleHistoryClick(item.method, item.path, item.dsl)}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex w-full items-center justify-between gap-2 text-sm">
                        <Badge variant={badgeVariantMap[getMethodTagType(item.method)]}>{item.method}</Badge>
                        <span className="text-[13px]">{item.path}</span>
                        <span className="text-[13px] text-muted-foreground/50">
                          {formatTimestamp(item.timestamp)}
                        </span>
                      </div>
                    </TooltipTrigger>
                    {item.dsl !== '' && (
                      <TooltipContent side="left" className="max-w-[420px]">
                        <pre className="m-0 max-h-[618px] overflow-y-auto text-left font-mono text-xs whitespace-pre-wrap break-all">
                          {formatDSL(item.dsl)}
                        </pre>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
