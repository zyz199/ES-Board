import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { FolderInput, RefreshCw } from 'lucide-react'
import { t } from '@lingui/macro'
import { toast } from '@/components/ui/sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  createCsvContent,
  download_file,
  formatBytes,
  formatMillis,
  formatMillisToDays,
  formatNumber,
} from '../utils/common'
import emitter from '../utils/eventBus'
import { GetNodes } from '../../wailsjs/go/service/ESService'

// 节点统计详情表的键（这些键对应的值都是「字段名 -> 展示值」的字典）
type NodeStatKey =
  | 'stats_search'
  | 'stats_merges'
  | 'stats_segments'
  | 'stats_process'
  | 'stats_fs'

// GetNodes 返回体中单个节点的原始结构。
// ES 的节点统计层级深、字段随版本变化，这里只描述前端实际访问到的顶层字段，
// 深层统计（indices/jvm/os/process）保持宽松类型。
interface RawNode {
  name: string
  transport_address?: string
  roles?: string[]
  fs?: {
    total?: {
      total_in_bytes?: number
      available_in_bytes?: number
    }
    io_stats?: {
      total?: {
        read_operations?: number
        write_operations?: number
        read_kilobytes?: number
        write_kilobytes?: number
      }
    }
  }
  indices?: Record<string, any>
  jvm?: Record<string, any>
  os?: Record<string, any>
  process?: Record<string, any>
}

// GetNodes 返回体经前端拍平后的节点行结构
interface NodeRow {
  name: string
  ip: string
  roles: string[]
  is_master: boolean
  uptime: number
  docs_count: number
  store_size: number
  disk_total: number
  disk_percent: number
  load_5m: number
  heap_used_in_bytes: number
  heap_max_in_bytes: number
  heap_percent: number
  segments_count: number
  stats_search: Record<string, string>
  stats_merges: Record<string, string | number>
  stats_segments: Record<string, string>
  stats_process: Record<string, string>
  stats_fs: Record<string, string>
  stats_cache: string
  stats_cache_size: number
}

// CSV 导出的列定义
interface CsvColumn {
  headerName: string
  field?: string
  getCsvValue?: (row: NodeRow) => string | number | boolean
}

// DataTable 组件消费的列定义（MUI DataGrid 风格元数据）
type DataTableColumn<T> = {
  field: string
  headerName: string
  width?: number
  renderCell?: (params: { row: T }) => ReactNode
}

const roleMap: Record<string, string> = { m: '主', d: '数据', i: 'Ingest', l: 'ML', c: '协调', r: '远程', t: '转换', h: '热', w: '温', f: '冻', v: '投票' };

function createTooltipContent(stats: Record<string, string | number>) {
  return (
    <div className="flex flex-col max-w-[400px] text-left">
      {Object.entries(stats).map(([key, value]) => (
        <p key={key} className="text-[13px]">{`${key}: ${value}`}</p>
      ))}
    </div>
  );
}

const getProgressColorClass = (value: number): string => {
  const numValue = Number(value)
  if (numValue < 60) return '[&>[data-slot=progress-indicator]]:bg-success'
  if (numValue < 80) return '[&>[data-slot=progress-indicator]]:bg-warning'
  return '[&>[data-slot=progress-indicator]]:bg-destructive'
}

export default function Nodes() {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<NodeRow[]>([])
  const [cluster_name, setClusterName] = useState('')

  const getData = async () => {
    setLoading(true);
    try {
    const res = await GetNodes();
    if (res.err !== '') {
      toast.error(res.err);
      return;
    }
    setClusterName(res.result.cluster_name);
    const nodesData = (res.result.nodes || {}) as Record<string, RawNode>;

    const masterEligibleNodes = Object.keys(nodesData).filter(id => nodesData[id].roles?.includes('master'));
    const masterNodeId = masterEligibleNodes.length > 0 ? masterEligibleNodes[0] : null;

    const flattenedData: NodeRow[] = Object.values(nodesData).map(node => {
      const diskTotal = node.fs?.total?.total_in_bytes ?? 0;
      const diskFree = node.fs?.total?.available_in_bytes ?? 0;
      const diskUsedPercent = diskTotal > 0 ? Math.round(((diskTotal - diskFree) / diskTotal) * 100) : 0;

      const indices = node.indices ?? {};
      const search = indices.search ?? {};
      const merges = indices.merges ?? {};
      const query_cache = indices.query_cache ?? {};
      const fielddata = indices.fielddata ?? {};
      const request_cache = indices.request_cache ?? {};
      const segments = indices.segments ?? {};
      const jvm = node.jvm ?? {};
      const jvm_mem = jvm.mem ?? {};
      const os_cpu = node.os?.cpu ?? {};
      const process = node.process ?? {};
      const fs_total = node.fs?.total ?? {};
      const fs_io = node.fs?.io_stats?.total ?? {};

      return {
        name: node.name,
        ip: node.transport_address?.split(':')[0] ?? 'N/A',
        roles: node.roles || [],
        is_master: node.name === nodesData[masterNodeId as string]?.name,
        uptime: jvm.uptime_in_millis ?? 0,
        docs_count: indices.docs?.count ?? 0,
        store_size: indices.store?.size_in_bytes ?? 0,
        disk_total: diskTotal,
        disk_percent: diskUsedPercent,
        load_5m: os_cpu.load_average?.['5m'] ?? 0,
        heap_used_in_bytes: jvm_mem.heap_used_in_bytes ?? 0,
        heap_max_in_bytes: jvm_mem.heap_max_in_bytes ?? 0,
        heap_percent: jvm_mem.heap_used_percent ?? 0,
        segments_count: segments.count ?? 0,
        stats_search: {
          '查询总数': formatNumber(search.query_total ?? 0),
          '查询耗时': formatMillis(search.query_time_in_millis ?? 0),
          '拉取总数': formatNumber(search.fetch_total ?? 0),
          '拉取耗时': formatMillis(search.fetch_time_in_millis ?? 0),
          '滚动总数': formatNumber(search.scroll_total ?? 0),
          '滚动耗时': formatMillis(search.scroll_time_in_millis ?? 0),
        },
        stats_merges: {
          '合并总数': formatNumber(merges.total ?? 0),
          '合并总耗时': formatMillis(merges.total_time_in_millis ?? 0),
          '合并文档总数': formatNumber(merges.total_docs ?? 0),
          '合并总大小': formatBytes(merges.total_size_in_bytes ?? 0),
          '当前合并数': merges.current ?? 0,
        },
        stats_cache: `查询缓存: ${formatBytes(query_cache.memory_size_in_bytes ?? 0)} |
      Fielddata: ${formatBytes(fielddata.memory_size_in_bytes ?? 0)} |
      请求缓存: ${formatBytes(request_cache.memory_size_in_bytes ?? 0)} |
      段内存: ${formatBytes(segments.memory_in_bytes ?? 0)}`,
        stats_cache_size: (query_cache.memory_size_in_bytes ?? 0) + (fielddata.memory_size_in_bytes ?? 0) + (request_cache.memory_size_in_bytes ?? 0)
          + (segments.memory_in_bytes ?? 0),
        stats_segments: {
          '段总数': formatNumber(segments.count ?? 0),
          '总内存占用': formatBytes(segments.memory_in_bytes ?? 0),
          '词项 (Terms)': formatBytes(segments.terms_memory_in_bytes ?? 0),
          '存储字段 (Stored Fields)': formatBytes(segments.stored_fields_memory_in_bytes ?? 0),
          'Doc Values': formatBytes(segments.doc_values_memory_in_bytes ?? 0),
          'Norms': formatBytes(segments.norms_memory_in_bytes ?? 0),
        },
        stats_process: {
          '打开文件描述符': `${formatNumber(process.open_file_descriptors ?? 0)} / ${formatNumber(process.max_file_descriptors ?? 0)}`,
          '进程CPU使用率': `${process.cpu?.percent ?? 0}%`,
          '虚拟内存占用': formatBytes(process.mem?.total_virtual_in_bytes ?? 0),
        },
        stats_fs: {
          '总空间': formatBytes(fs_total.total_in_bytes ?? 0),
          '可用空间': formatBytes(fs_total.available_in_bytes ?? 0),
          'IO读操作': formatNumber(fs_io.read_operations ?? 0),
          'IO写操作': formatNumber(fs_io.write_operations ?? 0),
          'IO读流量': formatBytes((fs_io.read_kilobytes ?? 0) * 1024),
          'IO写流量': formatBytes((fs_io.write_kilobytes ?? 0) * 1024),
        }
      };
    });

    flattenedData.sort((a, b) => (b.heap_percent ?? 0) - (a.heap_percent ?? 0));
    setData(flattenedData);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const selectNode = async () => {
      await getData()
    }

    emitter.on('selectNode', selectNode)
    getData()

    return () => {
      emitter.off('selectNode', selectNode)
    }
  }, [])

  const downloadAllDataCsv = () => {
    if (!data || data.length === 0) {
      toast.warning(t`No data to export`);
      return;
    }

    const exportColumns: CsvColumn[] = [
      { headerName: t`Name`, field: 'name' },
      { headerName: t`IP`, field: 'ip' },
      { headerName: t`Roles`, getCsvValue: (row) => row.roles.map(role => roleMap[role.charAt(0)] || role).join('/') },
      { headerName: t`CPU Load (5m)`, field: 'load_5m' },
      { headerName: t`Uptime`, getCsvValue: (row) => formatMillisToDays(row.uptime) },
      { headerName: t`Total Docs`, getCsvValue: (row) => formatNumber(row.docs_count) },
      { headerName: t`Total Segments`, getCsvValue: (row) => formatNumber(row.segments_count) },
      { headerName: t`Heap Usage (%)`, field: 'heap_percent' },
      { headerName: t`Heap Used`, getCsvValue: (row) => formatBytes(row.heap_used_in_bytes) },
      { headerName: t`Heap Max`, getCsvValue: (row) => formatBytes(row.heap_max_in_bytes) },
      { headerName: t`Disk Usage (%)`, field: 'disk_percent' },
      { headerName: t`Store Used`, getCsvValue: (row) => formatBytes(row.store_size) },
      { headerName: t`Total Disk`, getCsvValue: (row) => formatBytes(row.disk_total) },
      { headerName: t`Total Cache`, getCsvValue: (row) => formatBytes(row.stats_cache_size) },
      {
        headerName: t`Cache Details`,
        field: 'stats_cache',
        getCsvValue: (row) => (row.stats_cache || '').replace(/\s+/g, ' ').trim()
      },
    ];

    const firstRow = data[0];
    const statsToFlatten: Record<string, NodeStatKey> = {
      [t`Search`]: 'stats_search',
      [t`Merge`]: 'stats_merges',
      [t`Segments`]: 'stats_segments',
      [t`Process`]: 'stats_process',
      [t`FS`]: 'stats_fs',
    };

    for (const [prefix, dataKey] of Object.entries(statsToFlatten)) {
      if (firstRow && typeof firstRow[dataKey] === 'object' && firstRow[dataKey] !== null) {
        for (const statKey in firstRow[dataKey]) {
          exportColumns.push({
            headerName: `${prefix} - ${statKey}`,
            getCsvValue: (row) => row[dataKey]?.[statKey] ?? '',
          });
        }
      }
    }

    try {
      const csvContent = createCsvContent(data, exportColumns);
      const fileName = `es-nodes-${cluster_name || 'export'}.csv`;
      download_file(csvContent, fileName, 'text/csv;charset=utf-8;');
      toast.success(t`CSV file exported successfully`);
    } catch (e) {
      toast.error(t`Export failed: ${(e as Error).message}`);
    }
  };

  const columns = useMemo<DataTableColumn<NodeRow>[]>(() => [
    { field: 'name', headerName: t`Name`, width: 120 },
    { field: 'ip', headerName: t`IP`, width: 120 },
    {
      field: 'roles', headerName: t`Roles`, width: 120,
      renderCell: ({ row }) => row.roles.map(role => roleMap[role.charAt(0)] || role).join('/')
    },
    { field: 'load_5m', headerName: t`CPU Load`, width: 100 },
    {
      field: 'heap_percent', headerName: t`Heap Usage`, width: 160,
      renderCell: ({ row }) => (
        <div className="flex flex-col w-full">
          <p className="text-[13px]">{`${formatBytes(row.heap_used_in_bytes)} / ${formatBytes(row.heap_max_in_bytes)}`}</p>
          <Progress
            value={Math.min(row.heap_percent ?? 0, 100)}
            className={getProgressColorClass(row.heap_percent)}
          />
        </div>
      ),
    },
    {
      field: 'disk_percent', headerName: t`Disk Usage`, width: 160,
      renderCell: ({ row }) => (
        <div className="flex flex-col w-full">
          <p className="text-[13px]">{`${formatBytes(row.store_size)} / ${formatBytes(row.disk_total)}`}</p>
          <Progress
            value={Math.min(row.disk_percent ?? 0, 100)}
            className={getProgressColorClass(row.disk_percent)}
          />
        </div>
      ),
    },
    {
      field: 'perf', headerName: t`Performance`, width: 160,
      renderCell: ({ row }) => (
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="default">{t`Search`}</Badge>
            </TooltipTrigger>
            <TooltipContent>{createTooltipContent(row.stats_search)}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="default">{t`Merge`}</Badge>
            </TooltipTrigger>
            <TooltipContent>{createTooltipContent(row.stats_merges)}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="default">{t`Segments`}</Badge>
            </TooltipTrigger>
            <TooltipContent>{createTooltipContent(row.stats_segments)}</TooltipContent>
          </Tooltip>
        </div>
      ),
    },
    {
      field: 'sys', headerName: t`System`, width: 120,
      renderCell: ({ row }) => (
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="info">{t`Process`}</Badge>
            </TooltipTrigger>
            <TooltipContent>{createTooltipContent(row.stats_process)}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="info">{t`FS`}</Badge>
            </TooltipTrigger>
            <TooltipContent>{createTooltipContent(row.stats_fs)}</TooltipContent>
          </Tooltip>
        </div>
      ),
    },
    {
      field: 'cache', headerName: t`Cache`, width: 100,
      renderCell: ({ row }) => row.stats_cache,
    },
    { field: 'docs_count', headerName: t`Total Docs`, width: 100, renderCell: ({ row }) => formatNumber(row.docs_count) },
    { field: 'segments_count', headerName: t`Total Segments`, width: 100, renderCell: ({ row }) => formatNumber(row.segments_count) },
    { field: 'uptime', headerName: t`Uptime`, width: 90, renderCell: ({ row }) => formatMillisToDays(row.uptime) },
  ], []);

  const count = data.length

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="flex items-center gap-2">
        <h2>{t`Nodes`}</h2>
        <p>{t`${count} total`}</p>
        <Button variant="default" onClick={getData}><RefreshCw className="size-4" />{t`Refresh`}</Button>
        <Button variant="default" onClick={downloadAllDataCsv}><FolderInput className="size-4" />{t`Export CSV`}</Button>
        <p>{(() => { const name = cluster_name; return t`Cluster: ${name}` })()}</p>
      </div>

      <div className="relative flex-1 min-h-[400px]">
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1">
            <Spinner size={28} />
            <p className="text-[13px]">{t`Connecting...`}</p>
          </div>
        )}

        <DataTable
          rows={data}
          columns={columns}
          getRowId={(row) => `${row.name}-${row.ip}`}
          pageSize={10}
        />
      </div>
    </div>
  )
}
