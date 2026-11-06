import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { FolderInput, RefreshCw, Trash2 } from 'lucide-react'
import { t } from '@lingui/macro'
import { toast } from '@/components/ui/sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import emitter from '../utils/eventBus'
import { createCsvContent, download_file, formatDate, formattedJson } from '../utils/common'
import { GetTasks, CancelTasks } from '../../wailsjs/go/service/ESService'

// 任务列表行（后端 GetTasks 返回的 results 元素）
interface TaskRow {
  task_id: string
  parent_task_id: string
  node_name: string
  node_ip: string
  type: string
  action: string
  start_time_in_millis: number
  running_time_in_nanos: number
  cancellable: boolean
}

export default function Task() {
  const [drawerVisible, setDrawerVisible] = useState(false)
  const [jsonData, setJsonData] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<TaskRow[]>([])
  const [, setSelectedRowKeys] = useState<string[]>([])

  const dataRef = useRef<TaskRow[]>([])
  dataRef.current = data

  const taskIdFilterRef = useRef('')
  const nodeFilterRef = useRef('')
  const actionFilterRef = useRef('')

  const [taskIdFilter, setTaskIdFilter] = useState('')
  const [nodeFilter, setNodeFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [filteredData, setFilteredData] = useState<TaskRow[]>([])

  const applyFilters = () => {
    setFilteredData(dataRef.current.filter((item) => {
      const matchesTaskId = !taskIdFilterRef.current || item.task_id.toLowerCase().includes(taskIdFilterRef.current.toLowerCase())
      const matchesNode = !nodeFilterRef.current || item.node_name.toLowerCase().includes(nodeFilterRef.current.toLowerCase())
      const matchesAction = !actionFilterRef.current || item.action.toLowerCase().includes(actionFilterRef.current.toLowerCase())
      return matchesTaskId && matchesNode && matchesAction
    }))
  }

  const getData = async () => {
    try {
      const res = await GetTasks()
      if (res.err !== '') {
        toast.error(res.err)
      } else {
        setData(res.results as TaskRow[])
        dataRef.current = res.results as TaskRow[]
        applyFilters()
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const CancelTask = async (row: TaskRow) => {
    setLoading(true)
    try {
      const res = await CancelTasks(row['task_id'])
      if (res.err !== '') {
        toast.error(res.err)
      } else {
        setJsonData(formattedJson(res.result))
        setDrawerVisible(true)
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
    await getData()
  }

  const columns = [
    { field: 'task_id', headerName: t`Task ID`, width: 220 },
    { field: 'parent_task_id', headerName: t`Parent Task ID`, width: 180 },
    { field: 'node_name', headerName: t`Node`, width: 140 },
    { field: 'node_ip', headerName: t`IP`, width: 120 },
    { field: 'type', headerName: t`Type`, width: 120 },
    {
      field: 'action',
      headerName: t`Action`,
      width: 160,
      renderCell: ({ row }: { row: TaskRow }) => <Badge variant="default">{row['action']}</Badge>,
    },
    {
      field: 'start_time_in_millis',
      headerName: t`Start Time`,
      width: 170,
      valueGetter: (row: TaskRow) => formatDate(new Date(row['start_time_in_millis'])),
    },
    { field: 'running_time_in_nanos', headerName: t`Run Time`, width: 140 },
    {
      field: 'cancellable',
      headerName: t`Cancellable`,
      width: 110,
      renderCell: ({ row }: { row: TaskRow }) => (
        <Badge variant={row['cancellable'] ? 'destructive' : 'default'}>
          {row['cancellable'] ? t`Yes` : t`No`}
        </Badge>
      ),
    },
    {
      field: 'actions',
      headerName: t`Actions`,
      width: 140,
      sortable: false,
      renderCell: ({ row }: { row: TaskRow }) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => CancelTask(row)}
          disabled={!row['cancellable']}
        >
          <Trash2 className="size-4" />
          {t`Terminate`}
        </Button>
      ),
    },
  ]

  const downloadAllDataCsv = () => {
    const csvContent = createCsvContent(data, columns)
    download_file(csvContent, t`task-list.csv`, 'text/csv;charset=utf-8;')
  }

  useEffect(() => {
    const selectNode = async () => {
      setDrawerVisible(false)
      setJsonData(null)
      setLoading(false)
      setData([])
      dataRef.current = []
      setSelectedRowKeys([])
      setFilteredData([])
      await getData()
    }
    emitter.on('selectNode', selectNode)
    getData()
    return () => {
      emitter.off('selectNode', selectNode)
    }
  }, [])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <h2 className="text-2xl font-bold">{t`Tasks`}</h2>
        <Button variant="ghost" onClick={getData}>
          <RefreshCw className="size-4" />
          {t`Refresh`}
        </Button>
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        <Input
          className="w-40"
          value={taskIdFilter}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { setTaskIdFilter(e.target.value); taskIdFilterRef.current = e.target.value }}
          placeholder={t`Task ID`}
        />
        <Input
          className="w-40"
          value={nodeFilter}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { setNodeFilter(e.target.value); nodeFilterRef.current = e.target.value }}
          placeholder={t`Node`}
        />
        <Input
          className="w-40"
          value={actionFilter}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { setActionFilter(e.target.value); actionFilterRef.current = e.target.value }}
          placeholder={t`Action`}
        />
        <Button variant="outline" onClick={applyFilters}>{t`Search`}</Button>
        <Button variant="outline" onClick={downloadAllDataCsv}>
          <FolderInput className="size-4" />
          {t`Export CSV`}
        </Button>
      </div>

      {loading && <Spinner size={24} className="self-center" />}
      <DataTable
        rows={filteredData}
        columns={columns}
        getRowId={(row: TaskRow) => row['task_id']}
        pageSize={10}
        className="max-h-[600px] overflow-y-auto"
      />

      {/* 结果抽屉 */}
      {drawerVisible && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerVisible(false)} />
          <div className="absolute inset-y-0 right-0 w-[38.2%] bg-background shadow-xl">
            <div className="p-4 text-left">
              <div className="font-semibold text-lg mb-1">{t`Result`}</div>
              <pre className="m-0 text-left whitespace-pre-wrap break-all font-mono text-[13px]">
                {jsonData}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
