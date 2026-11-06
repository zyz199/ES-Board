import {describe, it, expect, vi, beforeEach} from 'vitest'

// common.js 顶层 import 了 wailsjs/runtime（依赖 Wails 桌面环境），在 node 下需 mock
vi.mock('../../wailsjs/runtime', () => ({
  BrowserOpenURL: vi.fn(),
}))

import {
  openUrl,
  flattenObject,
  formattedJson,
  isValidJson,
  formatBytes,
  createCsvContent,
  formatDate,
  formatMillis,
  formatMillisToDays,
  formatNumber,
} from '../../src/utils/common'
import type { CsvColumn } from '../../src/utils/common'
import {BrowserOpenURL} from '../../wailsjs/runtime'

describe('openUrl', () => {
  beforeEach(() => vi.clearAllMocks())

  it('应调用 Wails 的 BrowserOpenURL', () => {
    openUrl('https://example.com')
    expect(BrowserOpenURL).toHaveBeenCalledWith('https://example.com')
  })
})

describe('flattenObject', () => {
  it('应压扁嵌套对象并用 . 连接键名', () => {
    const input = {a: {b: {c: 1}}, d: 2}
    expect(flattenObject(input)).toEqual({'a.b.c': 1, d: 2})
  })

  it('数组不应被压扁', () => {
    expect(flattenObject({list: [1, 2], meta: {ok: true}}))
      .toEqual({list: [1, 2], 'meta.ok': true})
  })

  it('空对象返回空结果', () => {
    expect(flattenObject({})).toEqual({})
  })
})

describe('formattedJson', () => {
  it('空值返回空字符串', () => {
    expect(formattedJson(null)).toBe('')
    expect(formattedJson('')).toBe('')
    expect(formattedJson(0)).toBe('')
  })

  it('对象序列化为缩进 1 的 JSON', () => {
    expect(formattedJson({a: 1})).toBe('{\n "a": 1\n}')
  })
})

describe('isValidJson', () => {
  it('合法 JSON 返回 true', () => {
    expect(isValidJson('{"a":1}')).toBe(true)
    expect(isValidJson('[1,2]')).toBe(true)
    expect(isValidJson('"str"')).toBe(true)
  })

  it('非法 JSON 返回 false', () => {
    expect(isValidJson('{a:1}')).toBe(false)
    expect(isValidJson('not json')).toBe(false)
    expect(isValidJson('')).toBe(false)
  })
})

describe('formatBytes', () => {
  it('边界值', () => {
    expect(formatBytes(0)).toBe('0 Bytes')
    expect(formatBytes(null)).toBe('')
  })

  it('各单位换算', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1048576)).toBe('1 MB')
    expect(formatBytes(1073741824)).toBe('1 GB')
  })

  it('小数位数为负时按 0 位处理', () => {
    expect(formatBytes(1536, -1)).toBe('2 KB')
  })
})

describe('createCsvContent', () => {
  it('过滤无 headerName 的列并正确拼接', () => {
    const columns: CsvColumn[] = [
      {field: 'name', headerName: '名称'},
      {field: 'age', headerName: '年龄', getCsvValue: row => row.age * 2},
      {field: 'hidden'}, // 无 headerName，应被过滤
    ]
    const data = [
      {name: '张三', age: 3},
      {name: '李,四', age: 5},
    ]
    const csv = createCsvContent(data, columns)
    const lines = csv.split('\n')
    expect(lines[0]).toBe('名称,年龄')
    // 字符串加引号防止逗号破坏列；getCsvValue 返回的数字保持原样
    expect(lines[1]).toBe('"张三",6')
    expect(lines[2]).toBe('"李,四",10')
  })

  it('非字符串原始值不加引号', () => {
    const csv = createCsvContent([{n: 1}], [{field: 'n', headerName: 'N'}])
    expect(csv).toBe('N\n1')
  })
})

describe('formatDate', () => {
  it('应格式化为 yyyy-MM-dd HH:mm:ss', () => {
    const d = new Date(2025, 0, 15, 9, 5, 3) // 本地时区 2025-01-15 09:05:03
    expect(formatDate(d)).toBe('2025-01-15 09:05:03')
  })
})

describe('formatMillis', () => {
  it('零值返回 0s', () => {
    expect(formatMillis(0)).toBe('0s')
    expect(formatMillis(null)).toBe('0s')
  })

  it('各时间单位', () => {
    expect(formatMillis(500)).toBe('0s')
    expect(formatMillis(1000)).toBe('1s')
    expect(formatMillis(65000)).toBe('1m 5s')
    expect(formatMillis(3600000)).toBe('1h')
    expect(formatMillis(3661000)).toBe('1h 1m 1s')
    expect(formatMillis(90061000)).toBe('1d 1h 1m 1s')
  })
})

describe('formatMillisToDays', () => {
  it('毫秒转天数', () => {
    expect(formatMillisToDays(0)).toBe('0天')
    expect(formatMillisToDays(86399999)).toBe('0天')
    expect(formatMillisToDays(86400000)).toBe('1天')
    expect(formatMillisToDays(90061000)).toBe('1天')
  })
})

describe('formatNumber', () => {
  it('千分位分隔', () => {
    expect(formatNumber(1234567)).toBe('1,234,567')
    expect(formatNumber(0)).toBe('0')
  })

  it('空值兜底为 0', () => {
    expect(formatNumber(null)).toBe('0')
    expect(formatNumber(undefined)).toBe('0')
  })
})
