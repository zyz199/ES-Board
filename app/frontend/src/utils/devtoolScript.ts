/*
 * Dev Tool 请求脚本解析（仿 Kibana Dev Tools Console 语法）
 *
 * 脚本格式：以 `#` 开头的行是注释，同时充当请求之间的分隔符；
 * 每个请求由「请求行 METHOD /path」+ 可选的多行 JSON body 组成。
 */

export const REQUEST_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH', 'OPTIONS']

const REQUEST_LINE_RE = /^\s*(GET|POST|PUT|DELETE|HEAD|PATCH|OPTIONS)\s+(\S+)\s*$/i

/** 解析后的单个请求（行号均为 0-based） */
export interface DevToolRequest {
  index: number
  startLine: number
  endLine: number
  bodyStartLine: number
  method: string
  path: string
  body: string
}

/** 解析过程中的中间态：比 DevToolRequest 多带 body 的原始行 */
interface PendingRequest extends DevToolRequest {
  bodyLines: string[]
  bodyLinesStart: number
}

// 首次进入 Dev Tool 时的示例脚本
export const DEFAULT_SCRIPT = `# 集群健康
GET /_cluster/health

# 查看索引列表
GET /_cat/indices?v

# 搜索（把 _search 换成 索引名/_search 可查指定索引）
POST /_search
{
  "query": {
    "match_all": {}
  },
  "size": 10
}
`

// 去掉数组首尾的空行，返回 {lines, offset}（offset 是首个非空行的下标）
function trimBlankLines(lines: string[]): { lines: string[]; offset: number } {
  let start = 0
  let end = lines.length - 1
  while (start <= end && lines[start].trim() === '') start += 1
  while (end >= start && lines[end].trim() === '') end -= 1
  if (start > end) return { lines: [], offset: lines.length }
  return { lines: lines.slice(start, end + 1), offset: start }
}

/**
 * 把脚本文本解析成请求列表
 * @param text 编辑器里的完整文本
 */
export function parseRequests(text: string | null | undefined): DevToolRequest[] {
  const lines = String(text ?? '').split('\n')
  const requests: DevToolRequest[] = []
  let current: PendingRequest | null = null

  const flush = () => {
    if (!current) return
    const { lines: bodyLines, offset } = trimBlankLines(current.bodyLines)
    const hasBody = bodyLines.length > 0
    requests.push({
      index: requests.length + 1,
      startLine: current.startLine,
      endLine: hasBody ? current.bodyLinesStart + offset + bodyLines.length - 1 : current.startLine,
      bodyStartLine: hasBody ? current.bodyLinesStart + offset : -1,
      method: current.method,
      path: current.path,
      body: bodyLines.join('\n'),
    })
    current = null
  }

  lines.forEach((line, row) => {
    if (line.trim().startsWith('#')) {
      // 注释行 = 分隔符，结束上一个请求
      flush()
      return
    }
    const matched = REQUEST_LINE_RE.exec(line)
    if (matched) {
      flush()
      current = {
        index: requests.length + 1,
        startLine: row,
        endLine: row,
        bodyStartLine: -1,
        method: matched[1].toUpperCase(),
        path: matched[2],
        body: '',
        bodyLines: [],
        bodyLinesStart: row + 1,
      }
      return
    }
    if (current) current.bodyLines.push(line)
  })
  flush()

  return requests
}

/**
 * 找出光标所在行属于哪个请求；行落空时返回其上方最近的请求
 * @param requests parseRequests 的结果
 * @param row 0-based 行号
 */
export function findRequestAt(requests: DevToolRequest[], row: number): DevToolRequest | null {
  if (!requests.length) return null
  const hit = requests.find((item) => row >= item.startLine && row <= item.endLine)
  if (hit) return hit
  let prev: DevToolRequest | null = null
  for (const item of requests) {
    if (item.startLine <= row) prev = item
    else break
  }
  return prev || requests[0]
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(text: unknown): string {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch])
}

// 轻量 JSON 语法高亮：逐段转义后再包 span，避免注入；非 JSON 文本原样返回
export function highlightJson(value: unknown): string {
  let text: string
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ''
    // 纯文本响应（如 _cat 系列）不做 JSON 着色
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return escapeHtml(value)
    text = value
  } else if (value === null || value === undefined) {
    return ''
  } else {
    try {
      text = JSON.stringify(value, null, 2) ?? String(value)
    } catch {
      text = String(value)
    }
  }
  if (!text) return ''

  const pattern = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g
  let out = ''
  let last = 0
  let matched = pattern.exec(text)
  while (matched !== null) {
    out += escapeHtml(text.slice(last, matched.index))
    const [full, str, colon, literal, num] = matched
    if (str) {
      const cls = colon
        ? 'text-sky-700 dark:text-sky-300'
        : 'text-emerald-700 dark:text-emerald-300'
      out += `<span class="${cls}">${escapeHtml(str)}</span>${colon ? escapeHtml(colon) : ''}`
    } else if (literal) {
      out += `<span class="text-purple-700 dark:text-purple-300">${literal}</span>`
    } else if (num) {
      out += `<span class="text-amber-700 dark:text-amber-300">${num}</span>`
    }
    last = matched.index + full.length
    matched = pattern.exec(text)
  }
  out += escapeHtml(text.slice(last))
  return out
}
