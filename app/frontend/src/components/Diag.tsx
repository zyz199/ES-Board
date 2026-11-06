import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ComponentProps, KeyboardEvent } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { t } from '@lingui/macro'
import { toast } from '@/components/ui/sonner'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useConfirm } from '../utils/feedback'
import emitter from '../utils/eventBus'
import { formatBytes, formatMillis } from '../utils/common'
import {
  ExplainAllocation,
  GetHotThreads,
  GetNodeNames,
  GetPendingTasks,
  GetShards,
  GetThreadPool,
} from '../../wailsjs/go/service/ESService'

// ==================== 本文件内的局部类型 ====================
// 分片行：GetShards 的 results 元素，只声明本文件用到的字段
interface ShardRow {
  index: string
  shard: string
  prirep: string
  state: string
  docs?: number
  store?: number
  node?: string
  ip?: string
  id: number
}

// 线程池行：GetThreadPool 的 results 元素
interface ThreadPoolRow {
  node_name?: string
  name?: string
  active?: number
  queue?: number
  rejected?: number
  size?: number
  type?: string
  id: number
}

// 挂起任务行：GetPendingTasks 的 results 元素
interface PendingRow {
  insert_order?: number
  priority?: number
  source?: string
  time_in_queue_millis?: number
  id: number
}

// 节点下拉项：GetNodeNames 的 results 元素
interface NodeOption {
  label: string
  value: string
}

// DataTable 组件消费的列定义：直接取自组件的 props 类型，
// 避免手写一份与组件脱节的形状（多一个/少一个可选字段都会赋值失败）
type DataTableColumn<T> = NonNullable<ComponentProps<typeof DataTable<T, unknown>>['columns']>[number]

// useConfirm 的默认值是零参函数，这里按实际调用方式补上参数类型（仅类型）
type ConfirmFn = (options: { title?: string; content?: string; type?: string }) => Promise<boolean>

export default function Diag() {
  const confirm = useConfirm() as ConfirmFn

  const [activeTab, setActiveTab] = useState('shards')

  // ==================== 分片 ====================
  const [shardData, setShardData] = useState<ShardRow[]>([])
  const [shardLoading, setShardLoading] = useState(false)
  const [shardFilter, setShardFilter] = useState('')
  const [shardStateFilter, setShardStateFilter] = useState<string | null>(null)
  const [hasQueriedShards, setHasQueriedShards] = useState(false)

  const stateFilterOptions = [
    { label: 'STARTED', value: 'STARTED' },
    { label: 'INITIALIZING', value: 'INITIALIZING' },
    { label: 'RELOCATING', value: 'RELOCATING' },
    { label: 'UNASSIGNED', value: 'UNASSIGNED' },
  ]

  const filteredShards = useMemo(() => {
    return shardData.filter(row => {
      if (shardFilter && !(row.index || '').includes(shardFilter)) return false
      if (shardStateFilter && row.state !== shardStateFilter) return false
      return true
    })
  }, [shardData, shardFilter, shardStateFilter])

  const fetchShards = async (targetIndex: string) => {
    setShardLoading(true)
    setHasQueriedShards(true)
    try {
      const res = await GetShards(targetIndex || '')
      if (res.err !== '') {
        toast.error(res.err)
      } else {
        setShardData((res.results || []).map((row, i) => ({ ...row, id: i })))
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setShardLoading(false)
    }
  }

  const doSearchShards = () => {
    const target = shardFilter.trim()
    if (target === '') {
      confirmGetAllShards()
    } else {
      fetchShards(target)
    }
  }

  const confirmGetAllShards = async () => {
    const ok = await confirm({
      title: t`Query All Shards Warning`,
      content: t`No index is specified. This will query all physical shards across the entire cluster. In large clusters (tens of thousands of shards), this requests the Master node to serialize the full routing table and may cause temporary Master load spikes. Are you sure you want to proceed?`,
      type: 'error',
    })
    if (!ok) return
    fetchShards('')
  }

  const [explainModal, setExplainModal] = useState({ show: false, content: '' })

  const showExplain = (content: string) => {
    setExplainModal({ show: true, content })
  }

  const explainShard = async (row: ShardRow) => {
    const res = await ExplainAllocation(row.index, parseInt(row.shard), row.prirep === 'p')
    if (res.err !== '') {
      try {
        showExplain(JSON.stringify(JSON.parse(res.err), null, 2))
      } catch {
        showExplain(res.err)
      }
      return
    }
    showExplain(JSON.stringify(res.result, null, 2))
  }

  const explainFirstUnassigned = () => {
    if (shardData.length === 0) {
      toast.warning(t`💡 To avoid heavy Master node serialization load in huge clusters, all shards are not loaded automatically. Please enter an index name to query, or click 'Query All Shards'.`)
      return
    }
    const target = shardData.find(row => row.state === 'UNASSIGNED')
    if (!target) {
      toast.info(t`No unassigned shards currently`)
      return
    }
    explainShard(target)
  }

  const stateBadgeVariant = (state: string): 'success' | 'info' | 'destructive' | 'secondary' => {
    if (state === 'STARTED') return 'success'
    if (state === 'INITIALIZING' || state === 'RELOCATING') return 'info'
    if (state === 'UNASSIGNED') return 'destructive'
    return 'secondary'
  }

  const shardColumns: DataTableColumn<ShardRow>[] = [
    { field: 'index', headerName: t`Index`, width: 220 },
    { field: 'shard', headerName: t`Shard`, width: 80 },
    {
      field: 'prirep', headerName: t`Role`, width: 90,
      renderCell: ({ row }) => (
        <Badge
          variant={row.prirep === 'p' ? 'info' : 'secondary'}
        >
          {row.prirep === 'p' ? 'primary' : 'replica'}
        </Badge>
      ),
    },
    {
      field: 'state', headerName: t`State`, width: 130,
      renderCell: ({ row }) => (
        <Badge variant={stateBadgeVariant(row.state)}>{row.state}</Badge>
      ),
    },
    { field: 'docs', headerName: t`Doc Count`, width: 110 },
    {
      field: 'store', headerName: t`Store Size`, width: 110,
      renderCell: ({ row }) => (row.store ? formatBytes(row.store) : ''),
    },
    { field: 'node', headerName: 'node', width: 200 },
    { field: 'ip', headerName: 'ip', width: 130 },
    {
      field: 'actions', headerName: t`Actions`, width: 100, sortable: false,
      renderCell: ({ row }) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => explainShard(row)}
        >
          {t`Explain`}
        </Button>
      ),
    },
  ]

  // ==================== 线程池 ====================
  const [threadPoolData, setThreadPoolData] = useState<ThreadPoolRow[]>([])
  const [, setThreadPoolLoading] = useState(false)
  const [threadPoolFilter, setThreadPoolFilter] = useState('')

  const filteredThreadPool = useMemo(() => {
    return threadPoolData.filter(row => {
      if (threadPoolFilter &&
        !`${row.name || ''}`.includes(threadPoolFilter) &&
        !`${row.node_name || ''}`.includes(threadPoolFilter)) return false
      return true
    })
  }, [threadPoolData, threadPoolFilter])

  const getThreadPool = async () => {
    setThreadPoolLoading(true)
    try {
      const res = await GetThreadPool()
      if (res.err !== '') {
        toast.error(res.err)
      } else {
        setThreadPoolData((res.results || []).map((row, i) => ({ ...row, id: i })))
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setThreadPoolLoading(false)
    }
  }

  const threadPoolColumns: DataTableColumn<ThreadPoolRow>[] = [
    { field: 'node_name', headerName: t`Name`, width: 200 },
    { field: 'name', headerName: t`Pool`, width: 160 },
    { field: 'active', headerName: t`Active`, width: 80 },
    { field: 'queue', headerName: t`Queue`, width: 80 },
    { field: 'rejected', headerName: t`Rejected`, width: 90 },
    { field: 'size', headerName: t`Size`, width: 80 },
    { field: 'type', headerName: 'Type', width: 120 },
  ]

  // ==================== 热点线程 ====================
  const [hotThreadsText, setHotThreadsText] = useState('')
  const [hotThreadsLoading, setHotThreadsLoading] = useState(false)
  const [selectedHotThreadsNode, setSelectedHotThreadsNode] = useState<string | null>(null)
  const [nodeOptions, setNodeOptions] = useState<NodeOption[]>([])

  const loadNodeOptions = async () => {
    try {
      const res = await GetNodeNames()
      if (res.err === '' && res.results) {
        const options: NodeOption[] = [{ label: t`All Cluster Nodes (Heavy)`, value: '' }]
        for (const n of res.results) {
          const name = n.name || n.ip
          const label = n.name ? `${n.name} (${n.ip})` : n.ip
          options.push({ label, value: name })
        }
        setNodeOptions(options)
      }
    } catch {
      // ignore
    }
  }

  const fetchHotThreads = async (node: string) => {
    setHotThreadsLoading(true)
    try {
      const res = await GetHotThreads(node || '')
      if (res.err !== '') {
        toast.error(res.err)
      } else {
        setHotThreadsText(res.result || '')
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setHotThreadsLoading(false)
    }
  }

  const handleGetHotThreads = async () => {
    if (!selectedHotThreadsNode) {
      const ok = await confirm({
        title: t`Cluster-wide Sampling Warning`,
        content: t`No specific node is selected. This will trigger JVM hot thread sampling across ALL nodes simultaneously. In large clusters, this adds CPU sampling pressure to every node and may take a while. Are you sure you want to proceed?`,
        type: 'error',
      })
      if (!ok) return
      fetchHotThreads('')
    } else {
      fetchHotThreads(selectedHotThreadsNode)
    }
  }

  // ==================== 挂起任务 ====================
  const [pendingData, setPendingData] = useState<PendingRow[]>([])
  const [pendingLoading, setPendingLoading] = useState(false)

  const pendingColumns: DataTableColumn<PendingRow>[] = [
    { field: 'insert_order', headerName: t`Insert Order`, width: 110 },
    { field: 'priority', headerName: t`Priority`, width: 100 },
    { field: 'source', headerName: t`Action`, width: 300 },
    {
      field: 'time_in_queue_millis', headerName: t`Time in Queue`, width: 130,
      renderCell: ({ row }) => formatMillis(row.time_in_queue_millis),
    },
  ]

  const getPendingTasks = async () => {
    setPendingLoading(true)
    try {
      const res = await GetPendingTasks()
      if (res.err !== '') {
        toast.error(res.err)
      } else {
        setPendingData((res.results || []).map((row, i) => ({ ...row, id: i })))
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setPendingLoading(false)
    }
  }

  // ==================== 生命周期与懒加载 ====================
  const activeTabRef = useRef(activeTab)
  useEffect(() => {
    activeTabRef.current = activeTab
  }, [activeTab])

  useEffect(() => {
    const selectNode = async () => {
      setShardData([])
      setHasQueriedShards(false)
      setThreadPoolData([])
      setHotThreadsText('')
      setPendingData([])
      setSelectedHotThreadsNode(null)
      await loadNodeOptions()
      if (activeTabRef.current === 'threadPool') {
        await getThreadPool()
      } else if (activeTabRef.current === 'pendingTasks') {
        await getPendingTasks()
      }
    }
    emitter.on('selectNode', selectNode)
    loadNodeOptions()
    return () => emitter.off('selectNode', selectNode)
  }, [])

  // 懒加载：首次切到某 tab 时才拉数据
  useEffect(() => {
    if (activeTab === 'threadPool' && threadPoolData.length === 0) {
      getThreadPool()
    } else if (activeTab === 'pendingTasks' && pendingData.length === 0) {
      getPendingTasks()
    } else if (activeTab === 'hotThreads' && nodeOptions.length === 0) {
      loadNodeOptions()
    }
  }, [activeTab])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2>{t`Diagnose`}</h2>
        <p className="text-[13px] text-muted-foreground">{t`Shard distribution, thread pools, hot threads, pending tasks`}</p>
      </div>

      <Tabs value={activeTab} onValueChange={(v: string) => setActiveTab(v)}>
        <TabsList>
          <TabsTrigger value="shards">{t`Shards`}</TabsTrigger>
          <TabsTrigger value="threadPool">{t`Thread Pools`}</TabsTrigger>
          <TabsTrigger value="hotThreads">{t`Hot Threads`}</TabsTrigger>
          <TabsTrigger value="pendingTasks">{t`Pending Tasks`}</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* ============ 分片分布 ============ */}
      <div role="tabpanel" hidden={activeTab !== 'shards'}>
        {activeTab === 'shards' && (
          <div className="flex flex-col gap-2">
            {!hasQueriedShards && shardData.length === 0 && (
              <Alert variant="info" className="text-left">
                {t`💡 To avoid heavy Master node serialization load in huge clusters, all shards are not loaded automatically. Please enter an index name to query, or click 'Query All Shards'.`}
              </Alert>
            )}

            <div className="flex items-center gap-2">
              <Input
                placeholder={t`Filter by index (supports *)`}
                value={shardFilter}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setShardFilter(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') doSearchShards() }}
                className="w-[260px]"
              />
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">{t`Filter by state`}</Label>
                <Select
                  value={shardStateFilter ?? 'all'}
                  onValueChange={(v: string) => setShardStateFilter(v === 'all' ? null : v)}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {stateFilterOptions.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                disabled={shardLoading}
                onClick={doSearchShards}
              >
                {shardLoading ? <Spinner size={14} /> : <Search className="size-4" />}
                {t`Search`}
              </Button>
              <Button variant="outline" onClick={confirmGetAllShards}>
                <RefreshCw className="size-4" />
                {t`Query All Shards`}
              </Button>
              <Button variant="outline" onClick={explainFirstUnassigned}>
                {t`Explain Unassigned`}
              </Button>
            </div>
            <DataTable
              columns={shardColumns}
              rows={filteredShards}
              getRowId={(row) => row.id}
              pageSize={20}
              emptyMessage={t`No data`}
            />
          </div>
        )}
      </div>

      {/* ============ 线程池 ============ */}
      <div role="tabpanel" hidden={activeTab !== 'threadPool'}>
        {activeTab === 'threadPool' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Input
                placeholder={t`Filter by pool/node name`}
                value={threadPoolFilter}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setThreadPoolFilter(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') getThreadPool() }}
                className="w-[240px]"
              />
              <Button onClick={getThreadPool}>
                <RefreshCw className="size-4" />
                {t`Refresh`}
              </Button>
            </div>
            <DataTable
              columns={threadPoolColumns}
              rows={filteredThreadPool}
              getRowId={(row) => row.id}
              pageSize={20}
              emptyMessage={t`No data`}
            />
          </div>
        )}
      </div>

      {/* ============ 热点线程 ============ */}
      <div role="tabpanel" hidden={activeTab !== 'hotThreads'}>
        {activeTab === 'hotThreads' && (
          <div className="flex flex-col gap-2">
            <Alert variant="info" className="text-left">
              {t`💡 It is recommended to select a specific node. Cluster-wide sampling triggers JVM stack sampling on every node concurrently and may cause temporary CPU spikes in large clusters.`}
            </Alert>

            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-1">
                <Select
                  value={selectedHotThreadsNode ?? 'all'}
                  onValueChange={(v: string) => setSelectedHotThreadsNode(v === 'all' ? null : v)}
                >
                  <SelectTrigger className="w-[280px]">
                    <SelectValue placeholder={t`Select node (recommended)`} />
                  </SelectTrigger>
                  <SelectContent>
                    {nodeOptions.map(o => (
                      <SelectItem key={o.value || 'all'} value={o.value || 'all'}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                disabled={hotThreadsLoading}
                onClick={handleGetHotThreads}
              >
                {hotThreadsLoading ? <Spinner size={14} /> : <RefreshCw className="size-4" />}
                {t`Start Sampling`}
              </Button>
            </div>
            <Textarea
              rows={20}
              readOnly
              value={hotThreadsText}
              onChange={() => {}}
              className="min-h-0 text-left font-mono"
            />
          </div>
        )}
      </div>

      {/* ============ 挂起任务 ============ */}
      <div role="tabpanel" hidden={activeTab !== 'pendingTasks'}>
        {activeTab === 'pendingTasks' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center">
              <Button onClick={getPendingTasks}>
                <RefreshCw className="size-4" />
                {t`Refresh`}
              </Button>
              {pendingLoading && <Spinner size={20} className="ml-2" />}
            </div>
            <DataTable
              columns={pendingColumns}
              rows={pendingData}
              getRowId={(row) => row.id}
              pagination={false}
              emptyMessage={t`No data`}
            />
          </div>
        )}
      </div>

      {/* 分配解释 */}
      <Dialog
        open={explainModal.show}
        onOpenChange={(v: boolean) => { if (!v) setExplainModal(m => ({ ...m, show: false })) }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t`Shard Allocation Explain`}</DialogTitle>
          </DialogHeader>
          <pre
            className="m-0 max-h-[65vh] overflow-auto text-left whitespace-pre-wrap break-all font-mono text-[13px]"
          >
            {explainModal.content}
          </pre>
          <DialogFooter>
            <Button onClick={() => setExplainModal(m => ({ ...m, show: false }))}>{t`Close`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
