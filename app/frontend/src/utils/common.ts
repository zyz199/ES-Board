// 打开链接（交给系统浏览器）
import { BrowserOpenURL } from '../../wailsjs/runtime'

export function openUrl(url: string): void {
  BrowserOpenURL(url)
}

/** 压扁 JSON：嵌套对象用 . 连接键名，数组保持原样 */
export function flattenObject(obj: Record<string, any>, parentKey = ''): Record<string, any> {
  const flatResult: Record<string, any> = {}
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const newKey = parentKey ? `${parentKey}.${key}` : key
      const value = obj[key]
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        Object.assign(flatResult, flattenObject(value as Record<string, any>, newKey))
      } else {
        flatResult[newKey] = value
      }
    }
  }
  return flatResult
}

// 格式化的 JSON 字符串
export function formattedJson(value: unknown): string {
  if (!value) return ''
  return JSON.stringify(value, null, 1) ?? ''
}

// 验证json
export function isValidJson(jsonString: string): boolean {
  try {
    JSON.parse(jsonString)
    return true
  } catch {
    return false
  }
}

// 单位处理
export function formatBytes(bytes: number | string | null, decimals = 2): string {
  if (bytes === 0) return '0 Bytes'
  if (bytes === null) return ''
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  const n = Number(bytes)
  const i = Math.floor(Math.log(n) / Math.log(k))
  return parseFloat((n / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

/** CSV 导出列定义（与 MUI DataGrid 列元数据兼容的子集） */
export interface CsvColumn {
  headerName?: string
  field?: string
  getCsvValue?: (row: any) => unknown
}

// 创建 CSV 内容
export function createCsvContent(allData: readonly Record<string, any>[], columns: CsvColumn[]): string {
  const cols = columns.filter((col) => col.headerName !== undefined)
  const headers = cols.map((col) => col.headerName).join(',')
  const rows = allData
    .map((row) =>
      cols
        .map((col) => {
          if (col.getCsvValue) {
            const csvValue = col.getCsvValue(row)
            // 仅字符串加引号防止逗号破坏列，数字/布尔保持原样
            return typeof csvValue === 'string' ? `"${csvValue}"` : csvValue
          }
          const value = row[col.field as string]
          return typeof value === 'string' ? `"${value}"` : value
        })
        .join(','),
    )
    .join('\n')
  return `${headers}\n${rows}`
}

// 下载文件
export function download_file(content: string, fileName: string, type: string): void {
  const blob = new Blob([content], { type: type })
  const link = document.createElement('a')
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', fileName)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }
}

// 日期格式化
export function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

export function formatTimestamp(timestamp: number | string): string {
  return new Date(timestamp).toLocaleString()
}

// 格式化毫秒为可读时长
export function formatMillis(ms: number | null | undefined): string {
  const n = Number(ms)
  if (!n) return '0s'
  const seconds = Math.floor(n / 1000)
  const d = Math.floor(seconds / (3600 * 24))
  const h = Math.floor((seconds % (3600 * 24)) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  let result = ''
  if (d > 0) result += `${d}d `
  if (h > 0) result += `${h}h `
  if (m > 0) result += `${m}m `
  if (s > 0 || result === '') result += `${s}s`
  return result.trim()
}

export function formatMillisToDays(ms: number | null | undefined): string {
  const n = Number(ms)
  if (!n) return '0天'
  const days = Math.floor(n / (1000 * 60 * 60 * 24))
  return `${days}天`
}

// 格式化大数字（加逗号）
export function formatNumber(num: number | null | undefined): string {
  return num?.toLocaleString() ?? '0'
}
