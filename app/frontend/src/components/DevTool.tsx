import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/sonner'
import {
  Check, ChevronLeft, ChevronRight, Copy, Eraser, History, Loader2, Play, Rocket, Sparkles,
} from 'lucide-react'
import { t } from '@lingui/macro'
import { useLingui } from '@lingui/react'
import ace from 'ace-builds'
import type { Ace } from 'ace-builds'
import 'ace-builds/src-noconflict/mode-text'
import 'ace-builds/src-noconflict/ext-language_tools'
import 'ace-builds/src-noconflict/theme-textmate'
import 'ace-builds/src-noconflict/theme-monokai'
import emitter from '../utils/eventBus'
import { DEFAULT_SCRIPT, findRequestAt, highlightJson, parseRequests } from '../utils/devtoolScript'
import { formatTimestamp } from '../utils/common'
import { Search } from '../../wailsjs/go/service/ESService'

// ace-builds 1.4.12 的 d.ts 不完整（ace.define、ext-language_tools 的补全开关、
// renderer.lineHeight 等都没声明），这些位置一律按 any 调用，不引入新依赖或声明文件
const aceAny = ace as any

const SCRIPT_KEY = 'es_king_devtool_script'
const HISTORY_KEY = 'es_king_devtool_history'
const HISTORY_LIMIT = 100
const PAGE_SIZE = 10

// ==================== 本文件内的局部类型 ====================
// 一条解析出来的请求（形状与 utils/devtoolScript.ts 的返回值一致）
interface DevRequest {
  index: number
  startLine: number
  endLine: number
  bodyStartLine: number
  method: string
  path: string
  body: string
}

// 一次执行的结果；output 是后端 Search 的 ResultResp.result，内容类型不固定
interface DevResponse {
  index: number
  method: string
  path: string
  ok: boolean
  output: any
  elapsed: number
  ts: number
}

// 进入历史记录的条目（会序列化到 localStorage）
interface HistoryEntry {
  timestamp: number
  method: string
  path: string
  body: string
}

// 「执行」按钮浮层的定位数据
interface OverlayItem {
  index: number
  top: number
}

// ==================== 自定义 Ace 模式：请求行 + JSON body 高亮 ====================
const CUSTOM_MODE = 'ace/mode/es_devtool'
let customModeReady = false
try {
  aceAny.define(
    'ace/mode/es_devtool_highlight_rules',
    ['require', 'exports', 'module', 'ace/lib/oop', 'ace/mode/text_highlight_rules'],
    (require: any, exports: any) => {
      const oop = require('ace/lib/oop')
      const TextHighlightRules = require('ace/mode/text_highlight_rules').TextHighlightRules
      const Rules = function (this: any) {
        this.$rules = {
          start: [
            { token: 'comment', regex: '#.*$' },
            { token: 'keyword', regex: '^\\s*(?:GET|POST|PUT|DELETE|HEAD|PATCH|OPTIONS)(?=\\s)' },
            { token: 'string.key', regex: '"(?:\\\\.|[^"\\\\])*"(?=\\s*:)' },
            { token: 'string.value', regex: '"(?:\\\\.|[^"\\\\])*"' },
            { token: 'constant.numeric', regex: '-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?' },
            { token: 'constant.language', regex: '\\b(?:true|false|null)\\b' },
            { token: 'support.function', regex: '/(?:[\\w\\-.*]+/)*[\\w\\-.*]+' },
          ],
        }
        this.normalizeRules()
      }
      oop.inherits(Rules, TextHighlightRules)
      exports.EsDevtoolHighlightRules = Rules
    },
  )
  aceAny.define(
    CUSTOM_MODE,
    ['require', 'exports', 'module', 'ace/lib/oop', 'ace/mode/text', 'ace/mode/es_devtool_highlight_rules'],
    (require: any, exports: any) => {
      const oop = require('ace/lib/oop')
      const TextMode = require('ace/mode/text').Mode
      const Rules = require('ace/mode/es_devtool_highlight_rules').EsDevtoolHighlightRules
      const Mode = function (this: any) {
        this.HighlightRules = Rules
      }
      oop.inherits(Mode, TextMode)
      exports.Mode = Mode
    },
  )
  customModeReady = true
} catch {
  customModeReady = false
}
const EDITOR_MODE = customModeReady ? CUSTOM_MODE : 'ace/mode/text'

// 路径自动补全候选（常用端点 + 本地缓存的索引）
const FIXED_ENDPOINTS = [
  '_search', '_cluster/health', '_cluster/state', '_cluster/stats',
  '_cat/indices', '_cat/nodes', '_cat/shards', '_cat/allocation', '_cat/count',
  '_cat/health', '_cat/aliases', '_nodes/stats', '_tasks', '_flush', '_refresh',
  '_mapping', '_settings', '_stats', '_bulk', '_update', '_msearch', '_aliases',
  '_rollover', '_reindex', '_forcemerge', '_count', '_analyze', '_delete_by_query',
]

const DSL_KEYWORDS = [
  'query', 'bool', 'filter', 'must', 'should', 'must_not', 'term', 'terms',
  'match', 'match_phrase', 'multi_match', 'range', 'exists', 'prefix', 'wildcard',
  'regexp', 'aggs', 'aggregations', 'sum', 'avg', 'min', 'max', 'stats',
  'cardinality', 'histogram', 'date_histogram', 'top_hits', 'size', 'from',
  'sort', 'track_total_hits', '_source', 'fields', 'script', 'gte', 'lte', 'gt',
  'lt', 'boost', 'minimum_should_match', 'nested', 'path', 'order', 'asc', 'desc',
]

// Badge 支持的变体（与 ui/badge.tsx 的 cva variants 对齐）
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'info' | 'outline'

const METHOD_VARIANT: Record<string, BadgeVariant> = {
  GET: 'success', POST: 'info', PUT: 'warning', DELETE: 'destructive', HEAD: 'secondary',
}

// 示例脚本（title 在组件内用 t 宏生成，script 为纯脚本文本）
const EXAMPLES = [
  { key: 'cluster', script: '# 集群健康\nGET /_cluster/health\n' },
  { key: 'indices', script: '# 索引列表\nGET /_cat/indices?v\n' },
  { key: 'search', script: '# 搜索\nPOST /_search\n{\n  "query": {\n    "match_all": {}\n  },\n  "size": 10\n}\n' },
  { key: 'aggs', script: '# 聚合\nPOST /_search\n{\n  "size": 0,\n  "aggs": {\n    "by_field": {\n      "terms": {\n        "field": "status",\n        "size": 10\n      }\n    }\n  }\n}\n' },
  { key: 'mapping', script: '# 索引 mapping\nGET /_mapping\n' },
  { key: 'shards', script: '# 分片分配\nGET /_cat/shards?v\n' },
]

function loadStoredScript() {
  try {
    const stored = localStorage.getItem(SCRIPT_KEY)
    if (stored && stored.trim()) return stored
  } catch { /* localStorage 不可用时用默认脚本 */ }
  return DEFAULT_SCRIPT
}

function loadStoredHistory() {
  try {
    const stored = localStorage.getItem(HISTORY_KEY)
    if (stored) {
      const list = JSON.parse(stored)
      if (Array.isArray(list)) return list
    }
  } catch { /* 解析失败视为无历史 */ }
  return []
}

export default function DevTool() {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const editorElRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<Ace.Editor | null>(null)
  const rafRef = useRef(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const requestsRef = useRef<DevRequest[]>([])

  const [requests, setRequests] = useState<DevRequest[]>([])
  const [overlay, setOverlay] = useState<OverlayItem[]>([])
  const [responses, setResponses] = useState<DevResponse[]>([])
  const [running, setRunning] = useState<Record<number, boolean>>({})
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadStoredHistory())
  const [showHistory, setShowHistory] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [historyPage, setHistoryPage] = useState(1)
  const [copiedIndex, setCopiedIndex] = useState(-1)

  const clearResults = useCallback(() => setResponses([]), [])

  // ==================== 布局：把「执行」按钮贴到每个请求的首行 ====================
  const refreshLayout = useCallback(() => {
    const editor = editorRef.current
    const wrap = wrapRef.current
    if (!editor || !wrap) return
    const list = parseRequests(editor.getValue()) as DevRequest[]
    requestsRef.current = list
    setRequests(list)

    const wrapRect = wrap.getBoundingClientRect()
    const lineHeight = (editor.renderer as any).lineHeight || 16
    const next: OverlayItem[] = []
    for (const req of list) {
      const pos = editor.renderer.textToScreenCoordinates(req.startLine, 0)
      if (!pos) continue
      next.push({
        index: req.index,
        top: Math.round(pos.pageY - wrapRect.top - window.scrollY + (lineHeight - 20) / 2),
      })
    }
    setOverlay(next)
  }, [])

  const scheduleLayout = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(refreshLayout)
  }, [refreshLayout])

  // ==================== 请求执行 ====================
  const upsertResponse = useCallback((entry: DevResponse) => {
    setResponses(prev => {
      const idx = prev.findIndex(item => item.index === entry.index)
      if (idx === -1) return [...prev, entry].sort((a, b) => a.index - b.index)
      const next = [...prev]
      next[idx] = entry
      return next
    })
  }, [])

  const pushHistory = useCallback((req: DevRequest) => {
    setHistory(prev => {
      const entry = { timestamp: Date.now(), method: req.method, path: req.path, body: req.body }
      const deduped = prev.filter(
        item => !(item.method === entry.method && item.path === entry.path && item.body === entry.body),
      )
      const next = [entry, ...deduped].slice(0, HISTORY_LIMIT)
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      } catch { /* 配额不足时忽略 */ }
      return next
    })
  }, [])

  const runRequest = useCallback(async (req: DevRequest | undefined) => {
    if (!req) return
    setRunning(prev => ({ ...prev, [req.index]: true }))
    const startedAt = performance.now()
    try {
      // 没有 body 时传空串而不是 null：Wails v2 对 null 参数会以零值 reflect.Value
      // 调用 Go 方法，报 `reflect: Call using zero Value argument`，GET/HEAD/DELETE 全挂
      const res = await Search(req.method, req.path, req.body || '')
      const elapsed = Math.round(performance.now() - startedAt)
      const failed = !!(res && res.err)
      upsertResponse({
        index: req.index,
        method: req.method,
        path: req.path,
        ok: !failed,
        output: failed ? res.err : (res ? res.result : null),
        elapsed,
        ts: Date.now(),
      })
      if (!failed) pushHistory(req)
    } catch (e) {
      upsertResponse({
        index: req.index,
        method: req.method,
        path: req.path,
        ok: false,
        output: (e as Error).message,
        elapsed: Math.round(performance.now() - startedAt),
        ts: Date.now(),
      })
    } finally {
      setRunning(prev => {
        const next = { ...prev }
        delete next[req.index]
        return next
      })
    }
  }, [pushHistory, upsertResponse])

  const runCurrent = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const req = findRequestAt(parseRequests(editor.getValue()), editor.getCursorPosition().row) as DevRequest | null
    if (!req) {
      toast.warning(t`No request found, write one like: GET /_cluster/health`)
      return
    }
    runRequest(req)
  }, [runRequest])

  const runAll = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return
    const list = parseRequests(editor.getValue()) as DevRequest[]
    if (!list.length) {
      toast.warning(t`No request found, write one like: GET /_cluster/health`)
      return
    }
    // 顺序执行，避免把集群打爆
    for (const req of list) {
      await runRequest(req)
    }
  }, [runRequest])

  // 快捷键回调里读最新实现，避免闭包过期
  const runCurrentRef = useRef(runCurrent)
  const runAllRef = useRef(runAll)
  runCurrentRef.current = runCurrent
  runAllRef.current = runAll

  // ==================== 编辑器初始化 ====================
  useEffect(() => {
    const editor = ace.edit(editorElRef.current!, {
      mode: EDITOR_MODE,
      theme: 'ace/theme/textmate',
      fontSize: 13,
      showPrintMargin: false,
      showFoldWidgets: false,
      tabSize: 2,
      useSoftTabs: true,
      useWorker: false,
      wrap: false,
      enableBasicAutocompletion: true,
      enableLiveAutocompletion: true,
    } as any)
    editorRef.current = editor
    editor.session.setUseWrapMode(false)
    editor.setValue(loadStoredScript(), -1)
    editor.clearSelection()

    // 直接用事件负载判断主题：本监听器注册早于 App 的处理器（子组件 effect 先执行），
    // 此时 App 还没把 dark class 挂到 <html> 上，读 classList 会慢一拍
    const applyTheme = (theme?: any) => {
      const dark = theme
        ? theme === 'dark' || theme?.name === 'dark'
        : document.documentElement.classList.contains('dark')
      editor.setTheme(dark ? 'ace/theme/monokai' : 'ace/theme/textmate')
    }
    applyTheme()

    // 自动补全：请求行提示 API 路径，body 内提示 DSL 关键词
    editor.completers = [{
      getCompletions: (ed, session, pos, prefix, callback) => {
        const line = session.getLine(pos.row)
        let candidates: { caption: string; value: string; meta: string }[]
        if (/^\s*(GET|POST|PUT|DELETE|HEAD|PATCH|OPTIONS)\s/i.test(line)) {
          const paths = [...FIXED_ENDPOINTS]
          try {
            const stored = localStorage.getItem('es_king_indexes')
            if (stored) {
              for (const idx of JSON.parse(stored)) {
                paths.push(idx, `${idx}/_search`, `${idx}/_mapping`, `${idx}/_count`)
              }
            }
          } catch { /* 缓存异常时只用固定端点 */ }
          candidates = paths.map(v => {
            const value = `/${String(v).replace(/^\//, '')}`
            return { caption: value, value, meta: 'path' }
          })
        } else {
          candidates = DSL_KEYWORDS.map(v => ({ caption: v, value: v, meta: 'dsl' }))
        }
        const lower = prefix.toLowerCase()
        // ace 的 Completion 要求 score 字段，而这里按老逻辑只给 caption/value/meta，按 any 传入
        callback(null, candidates.filter(item => item.value.toLowerCase().startsWith(lower)).slice(0, 30) as any)
      },
    }]

    editor.commands.addCommand({
      name: 'devtoolRunCurrent',
      bindKey: { win: 'Ctrl-Enter', mac: 'Command-Enter' },
      exec: () => runCurrentRef.current(),
    })
    editor.commands.addCommand({
      name: 'devtoolRunAll',
      bindKey: { win: 'Ctrl-Shift-Enter', mac: 'Command-Shift-Enter' },
      exec: () => runAllRef.current(),
    })

    const onChange = () => {
      scheduleLayout()
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        try {
          localStorage.setItem(SCRIPT_KEY, editor.getValue())
        } catch { /* 忽略写入失败 */ }
      }, 400)
    }
    const onScroll = () => scheduleLayout()
    const onWindowResize = () => {
      editor.resize()
      scheduleLayout()
    }
    const onMenuSelect = (key: any) => {
      if (key === 'devtool') {
        editor.resize(true)
        scheduleLayout()
      }
    }

    editor.on('change', onChange)
    editor.session.on('changeScrollTop', onScroll)
    window.addEventListener('resize', onWindowResize)
    emitter.on('update_theme', applyTheme)
    emitter.on('selectNode', clearResults)
    emitter.on('menu_select', onMenuSelect)

    // 初次进入：等一帧 + 字体就绪后各定位一次，避免行高未定型导致错位
    scheduleLayout()
    const timers = [setTimeout(scheduleLayout, 60), setTimeout(scheduleLayout, 300)]

    return () => {
      timers.forEach(clearTimeout)
      clearTimeout(saveTimerRef.current)
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', onWindowResize)
      emitter.off('update_theme', applyTheme)
      emitter.off('selectNode', clearResults)
      emitter.off('menu_select', onMenuSelect)
      editor.destroy()
      editorRef.current = null
    }
  }, [clearResults, scheduleLayout])

  // ==================== 交互动作 ====================
  // 依赖 i18n：语言切换时让 useMemo 失效，示例标题才能跟着翻译
  const { i18n } = useLingui()
  const exampleItems = useMemo(() => [
    { key: 'cluster', title: t`Cluster health` },
    { key: 'indices', title: t`List indices` },
    { key: 'search', title: t`Search request` },
    { key: 'aggs', title: t`Aggregation request` },
    { key: 'mapping', title: t`Index mapping` },
    { key: 'shards', title: t`Shards allocation` },
  ], [i18n])

  const insertScript = (text: string) => {
    const editor = editorRef.current
    if (!editor) return
    const current = editor.getValue()
    const separator = (!current || current.endsWith('\n')) ? '' : '\n'
    editor.setValue(`${current}${separator}${text}`, -1)
    editor.clearSelection()
    editor.focus()
    scheduleLayout()
  }

  const resetScript = () => {
    const editor = editorRef.current
    if (!editor) return
    editor.setValue(DEFAULT_SCRIPT, -1)
    editor.clearSelection()
    clearResults()
    scheduleLayout()
  }

  const copyResult = async (index: number, output: any) => {
    const payload = typeof output === 'string' ? output : JSON.stringify(output, null, 2)
    try {
      await navigator.clipboard.writeText(payload || '')
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex(prev => (prev === index ? -1 : prev)), 1500)
    } catch {
      toast.error(t`Copy failed`)
    }
  }

  const filteredHistory = useMemo(() => {
    const keyword = historySearch.trim().toLowerCase()
    if (!keyword) return history
    return history.filter(item =>
      item.method.toLowerCase().includes(keyword) ||
      item.path.toLowerCase().includes(keyword) ||
      String(item.body || '').toLowerCase().includes(keyword))
  }, [history, historySearch])

  const historyPageCount = Math.max(1, Math.ceil(filteredHistory.length / PAGE_SIZE))
  const historyPageData = useMemo(
    () => filteredHistory.slice((historyPage - 1) * PAGE_SIZE, historyPage * PAGE_SIZE),
    [filteredHistory, historyPage],
  )

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">{t`Dev Tools`}</h2>
        <span className="text-[13px] text-muted-foreground">
          {t`Multiple requests in one editor, separated by # lines`}
        </span>
      </div>

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button onClick={runCurrent}>
              <Play className="size-4" />
              {t`Run`}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t`Run the request under the cursor (Ctrl/Cmd + Enter)`}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" onClick={runAll}>
              <Rocket className="size-4" />
              {t`Run all`}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t`Run every request in order (Ctrl/Cmd + Shift + Enter)`}</TooltipContent>
        </Tooltip>
        <Button variant="outline" onClick={clearResults}>
          <Eraser className="size-4" />
          {t`Clear results`}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Sparkles className="size-4" />
              {t`Examples`}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>{t`Insert example request`}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {EXAMPLES.map((item, idx) => (
              <DropdownMenuItem key={item.key} onSelect={() => insertScript(item.script)}>
                {exampleItems[idx].title}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={resetScript}>{t`Reset editor`}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" onClick={() => setShowHistory(true)}>
          <History className="size-4" />
          {t`History`}
        </Button>
        <div className="flex-1" />
        <span className="text-[12px] text-muted-foreground">
          {t`Requests`}: {requests.length}
        </span>
      </div>

      {/* 左：脚本编辑器（每行请求首行有执行按钮）；右：响应 */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4" style={{ height: '72dvh' }}>
        <div ref={wrapRef} className="relative min-h-0 overflow-hidden rounded-md border">
          {/* 用 inline style 定位：ace 自带的 .ace_editor{position:relative}（未分层 CSS）
              会覆盖 Tailwind 的 absolute 定位类，导致编辑器高度塌成 0 */}
          <div
            ref={editorElRef}
            style={{ position: 'absolute', top: 0, bottom: 0, left: '28px', right: 0 }}
          />
          {overlay.map(item => (
            <button
              key={item.index}
              type="button"
              title={t`Run this request`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runRequest(requestsRef.current.find(r => r.index === item.index))}
              disabled={!!running[item.index]}
              className="absolute left-1 flex size-5 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-accent hover:text-primary disabled:opacity-50"
              style={{ top: item.top }}
            >
              {running[item.index]
                ? <Loader2 className="size-3.5 animate-spin" />
                : <Play className="size-3.5" />}
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-col gap-2 overflow-auto rounded-md border p-2">
          {requests.length === 0 && (
            <p className="text-[13px] text-muted-foreground">
              {t`No request parsed yet. Format: METHOD /path, an optional JSON body on the following lines, requests separated by # lines.`}
            </p>
          )}
          {requests.map(req => {
            const resp = responses.find(item => item.index === req.index)
            const isRunning = !!running[req.index]
            return (
              <div key={req.index} className="rounded-md border">
                <div className="flex items-center gap-2 border-b bg-muted/40 px-2 py-1">
                  <Badge variant={METHOD_VARIANT[req.method] || 'secondary'}>{req.method}</Badge>
                  <span className="truncate font-mono text-[12px]">{req.path}</span>
                  <div className="flex-1" />
                  {isRunning && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                  {!isRunning && resp && (
                    <Badge variant={resp.ok ? 'success' : 'destructive'}>{resp.ok ? 'OK' : 'ERROR'}</Badge>
                  )}
                  {!isRunning && resp && (
                    <span className="text-[12px] text-muted-foreground">{resp.elapsed} ms</span>
                  )}
                  {resp && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon-sm" onClick={() => copyResult(req.index, resp.output)}>
                          {copiedIndex === req.index
                            ? <Check className="size-3.5" />
                            : <Copy className="size-3.5" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t`Copy result`}</TooltipContent>
                    </Tooltip>
                  )}
                </div>
                {resp
                  ? (
                    <pre
                      className="m-0 max-h-[280px] overflow-auto p-2 font-mono text-[12px] whitespace-pre-wrap break-all"
                      dangerouslySetInnerHTML={{ __html: highlightJson(resp.output) || '&nbsp;' }}
                    />
                  )
                  : (
                    <div className="px-2 py-3 text-[12px] text-muted-foreground">{t`Not executed yet`}</div>
                  )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 历史抽屉 */}
      {showHistory && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowHistory(false)} />
          <div className="absolute inset-y-0 right-0 flex w-[38.2%] max-w-full flex-col gap-2 overflow-y-auto border-l bg-background p-2 text-left shadow-xl">
            <div className="text-lg font-semibold">{t`History`}</div>
            <Input
              value={historySearch}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setHistorySearch(e.target.value); setHistoryPage(1) }}
              placeholder={t`Search history by method, path, or body`}
            />
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                disabled={historyPage <= 1}
                onClick={() => setHistoryPage(historyPage - 1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-[13px] text-muted-foreground">{historyPage} / {historyPageCount}</span>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={historyPage >= historyPageCount}
                onClick={() => setHistoryPage(historyPage + 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
            {historyPageData.length === 0 && (
              <p className="text-[13px] text-muted-foreground">
                {history.length ? t`No matched history` : t`No history yet`}
              </p>
            )}
            {historyPageData.map(item => (
              <div
                key={item.timestamp}
                className="flex cursor-pointer items-center justify-between gap-2 py-1.5"
                onClick={() => {
                  const body = item.body ? `\n${item.body}` : ''
                  insertScript(`# ${formatTimestamp(item.timestamp)}\n${item.method} ${item.path}${body}\n`)
                  setShowHistory(false)
                }}
              >
                <Badge variant={METHOD_VARIANT[item.method] || 'secondary'}>{item.method}</Badge>
                <span className="flex-1 truncate text-[13px]">{item.path}</span>
                <span className="text-[13px] text-muted-foreground/50">
                  {formatTimestamp(item.timestamp)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
