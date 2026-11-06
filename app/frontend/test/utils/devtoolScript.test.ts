import {describe, expect, it} from 'vitest'
import {
  DEFAULT_SCRIPT, escapeHtml, findRequestAt, highlightJson, parseRequests,
} from '../../src/utils/devtoolScript'

describe('parseRequests', () => {
  it('空文本返回空数组', () => {
    expect(parseRequests('')).toEqual([])
    expect(parseRequests(null)).toEqual([])
    expect(parseRequests('   \n\n  ')).toEqual([])
  })

  it('解析单个无 body 请求', () => {
    const [req] = parseRequests('GET /_cluster/health')
    expect(req).toEqual({
      index: 1,
      startLine: 0,
      endLine: 0,
      bodyStartLine: -1,
      method: 'GET',
      path: '/_cluster/health',
      body: '',
    })
  })

  it('method 统一大写、保留查询串', () => {
    const [req] = parseRequests('get /_cat/indices?v')
    expect(req.method).toBe('GET')
    expect(req.path).toBe('/_cat/indices?v')
  })

  it('解析带多行 JSON body 的请求', () => {
    const script = ['POST /_search', '{', '  "size": 1', '}'].join('\n')
    const [req] = parseRequests(script)
    expect(req.method).toBe('POST')
    expect(req.path).toBe('/_search')
    expect(req.bodyStartLine).toBe(1)
    expect(req.endLine).toBe(3)
    expect(req.body).toBe('{\n  "size": 1\n}')
  })

  it('去掉 body 首尾空行，但保留内部空行', () => {
    const script = ['POST /_search', '', '{', '', '  "size": 1', '}', '', ''].join('\n')
    const [req] = parseRequests(script)
    expect(req.body).toBe('{\n\n  "size": 1\n}')
    expect(req.bodyStartLine).toBe(2)
    expect(req.endLine).toBe(5)
  })

  it('# 注释行分隔多个请求并计数', () => {
    const reqs = parseRequests(DEFAULT_SCRIPT)
    expect(reqs.map(r => `${r.method} ${r.path}`)).toEqual([
      'GET /_cluster/health',
      'GET /_cat/indices?v',
      'POST /_search',
    ])
    expect(reqs.map(r => r.index)).toEqual([1, 2, 3])
    expect(reqs[2].body).toContain('"match_all"')
  })

  it('行号定位正确（便于悬浮执行按钮定位）', () => {
    const reqs = parseRequests(DEFAULT_SCRIPT)
    const lines = DEFAULT_SCRIPT.split('\n')
    for (const req of reqs) {
      expect(lines[req.startLine].trim()).toBe(`${req.method} ${req.path}`)
    }
    expect(reqs[0].startLine).toBe(1)
    expect(reqs[1].startLine).toBe(4)
    expect(reqs[2].startLine).toBe(7)
  })

  it('缩进的请求行也能识别，普通文本行不会误判', () => {
    const reqs = parseRequests('  GET /_cat/nodes\n"method": "GET"')
    expect(reqs).toHaveLength(1)
    expect(reqs[0].path).toBe('/_cat/nodes')
  })
})

describe('findRequestAt', () => {
  const reqs = parseRequests(DEFAULT_SCRIPT)

  it('命中请求行与 body 行', () => {
    expect(findRequestAt(reqs, 1)?.path).toBe('/_cluster/health')
    expect(findRequestAt(reqs, 8)?.path).toBe('/_search')
  })

  it('落在注释/空行时回退到上方最近的请求（首行注释则取第一个请求）', () => {
    expect(findRequestAt(reqs, 0)).toBe(reqs[0])
    expect(findRequestAt(reqs, 3)?.path).toBe('/_cluster/health')
    expect(findRequestAt(reqs, 11)?.path).toBe('/_search')
  })

  it('空列表返回 null', () => {
    expect(findRequestAt([], 3)).toBeNull()
  })
})

describe('highlightJson', () => {
  it('转义 HTML，避免注入', () => {
    const html = highlightJson({a: '<script>alert(1)</script>'})
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  it('为 key / 字符串值 / 数字 / 字面量上色', () => {
    const html = highlightJson({ok: true, size: 10, name: 'es'})
    expect(html).toContain('text-sky-700')       // key
    expect(html).toContain('text-emerald-700')   // 字符串值
    expect(html).toContain('text-amber-700')     // 数字
    expect(html).toContain('text-purple-700')    // true/false/null
  })

  it('空值与对象循环引用不抛错', () => {
    expect(highlightJson('')).toBe('')
    expect(highlightJson(null)).toBe('')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => highlightJson(circular)).not.toThrow()
  })

  it('纯文本响应按原样返回', () => {
    expect(highlightJson('green open index-1')).toBe('green open index-1')
  })
})
