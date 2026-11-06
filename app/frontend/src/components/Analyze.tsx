import { useEffect, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { t } from '@lingui/macro'
import { toast } from '@/components/ui/sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import emitter from '../utils/eventBus'
import { AnalyzeText, GetIndexes } from '../../wailsjs/go/service/ESService'

// 索引下拉选项
interface IndexOption {
  label: string
  value: string
}

// AnalyzeText 返回的单个分词
interface AnalyzeToken {
  token: string
  start_offset: number
  end_offset: number
  type: string
  position: number
}

// AnalyzeText 返回体
interface AnalyzeResult {
  tokens: AnalyzeToken[]
}

// DataTable 行（分词 + 本地行 id）
interface TokenRow extends AnalyzeToken {
  __id: number
}

// DataTable 组件消费的列定义（MUI DataGrid 风格元数据）
type DataTableColumn<T> = {
  field: string
  headerName: string
  width?: number
  renderCell?: (params: { row: T }) => ReactNode
}

const loadCachedIndexes = (): IndexOption[] => {
  try {
    const raw = localStorage.getItem('es_king_indexes')
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.map((idx) => ({ label: idx, value: idx }))
      }
    }
  } catch { /* ignore */ }
  return []
}

const analyzerOptions = [
  'standard', 'simple', 'whitespace', 'stop', 'keyword', 'pattern', 'english', 'french',
  'german', 'cjk', 'ik_max_word', 'ik_smart', 'pinyin',
]

export default function Analyze() {
  const [indexName, setIndexName] = useState<string | null>(null)
  const [indexOptions, setIndexOptions] = useState<IndexOption[]>(loadCachedIndexes())
  const [indexLoading, setIndexLoading] = useState(false)
  const [analyzer, setAnalyzer] = useState('standard')
  const [field, setField] = useState('')
  const [text, setText] = useState('')
  const [tokens, setTokens] = useState<AnalyzeToken[]>([])
  const [loading, setLoading] = useState(false)

  const loadIndexes = async () => {
    setIndexLoading(true)
    try {
      const res = await GetIndexes('')
      if (res.err !== '') {
        toast.error(res.err)
        return
      }
      const idxs = (res.results || []).map((item) => item.index).filter(Boolean)
      setIndexOptions(idxs.map((item) => ({ label: item, value: item })))
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
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setIndexLoading(false)
    }
  }

  const tokenColumns: DataTableColumn<TokenRow>[] = [
    {
      field: 'token',
      headerName: t`Token`,
      width: 180,
      renderCell: ({ row }) => <Badge variant="default">{row.token}</Badge>,
    },
    { field: 'type', headerName: t`Type`, width: 150 },
    { field: 'position', headerName: 'position', width: 100 },
    { field: 'start_offset', headerName: 'start_offset', width: 130 },
    { field: 'end_offset', headerName: 'end_offset', width: 130 },
  ]

  const doAnalyze = async () => {
    if (!text.trim()) {
      toast.warning(t`Please enter text to analyze`)
      return
    }
    if (!analyzer && !field) {
      toast.warning(t`Please provide an analyzer or a field`)
      return
    }
    setLoading(true)
    setTokens([])
    try {
      const res = await AnalyzeText(indexName || '', text, analyzer || '', field)
      if (res.err !== '') {
        toast.error(res.err)
        return
      }
      const analyzeResult = res.result as AnalyzeResult | null
      const list: AnalyzeToken[] = (analyzeResult && analyzeResult.tokens) || []
      setTokens(list)
      if (list.length === 0) {
        toast.info(t`No tokens produced`)
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const selectNode = async () => {
      setTokens([])
      await loadIndexes()
    }
    emitter.on('selectNode', selectNode)
    loadIndexes()
    return () => {
      emitter.off('selectNode', selectNode)
    }
  }, [])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <h2 className="text-xl font-semibold">{t`Analyze`}</h2>
        <p className="text-[13px] text-muted-foreground">{t`Test analyzer tokenization (_analyze)`}</p>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="flex max-w-[860px] flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">{t`Index`}</Label>
              <Select
                value={indexName || 'none'}
                onValueChange={(v: string) => setIndexName(v === 'none' ? null : v)}
              >
                <SelectTrigger className="w-[280px] min-w-[240px]">
                  <SelectValue placeholder={t`Select an index (optional, to test field analyzer)`} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {indexOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button variant="ghost" size="icon" onClick={loadIndexes} disabled={indexLoading}>
                    <RefreshCw className="size-4" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">{t`Refresh index list`}</TooltipContent>
            </Tooltip>
          </div>

          <div className="max-w-[280px]">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">{t`Analyzer`}</Label>
              <Input
                list="analyzer-options"
                value={analyzer}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setAnalyzer(e.target.value)}
                placeholder={t`standard / ik_max_word / ...`}
                disabled={field !== ''}
              />
              <datalist id="analyzer-options">
                {analyzerOptions.map((opt) => (
                  <option key={opt} value={opt} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="flex max-w-[280px] flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">{t`Field`}</Label>
            <Input
              value={field}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setField(e.target.value)}
              placeholder={t`Use the analyzer of a field in the index; overrides analyzer`}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">{t`Text`}</Label>
            <Textarea
              rows={3}
              value={text}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
              placeholder={t`Enter text to analyze, press Enter to run`}
              onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  doAnalyze()
                }
              }}
            />
          </div>

          <div className="flex gap-1">
            <Button
              disabled={loading}
              onClick={doAnalyze}
            >
              {loading ? <Spinner size={14} /> : <Search className="size-4" />}
              {t`Analyze`}
            </Button>
          </div>
        </div>
      </div>

      {loading && <Spinner size={24} className="self-center" />}
      <DataTable
        getRowId={(row) => row.__id}
        columns={tokenColumns}
        rows={tokens.map((tk, i) => ({ ...tk, __id: i }))}
        pagination={false}
        className="max-h-[400px] overflow-y-auto"
      />
    </div>
  )
}
