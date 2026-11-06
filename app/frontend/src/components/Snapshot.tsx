import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { t } from '@lingui/macro'
import { toast } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { DataTable } from '@/components/ui/data-table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirm } from '../utils/feedback'
import emitter from '../utils/eventBus'
import {
  GetSnapshots, GetSnapshotRepositories, CreateSnapshotRepository, DeleteSnapshotRepository,
  VerifySnapshotRepository, CreateSnapshot, DeleteSnapshot, GetSnapshotDetail,
  RestoreSnapshot, GetSnapshotRestoreStatus,
  GetSLMPolicies, CreateSLMPolicy, DeleteSLMPolicy, ExecuteSLMPolicy,
  GetILMPolicies, CreateILMPolicy, DeleteILMPolicy,
} from '../../wailsjs/go/service/ESService'

// 下列局部类型只描述本页用到的字段：wailsjs 返回体是 any，断言成这些形状即可。
// 快照仓库（GetSnapshotRepositories）
interface SnapshotRepository {
  name: string
  type: string
  settings?: unknown
}

// 快照（GetSnapshots）
interface SnapshotItem {
  snapshot: string
  repository: string
  state: string
  start_time: string
  end_time: string
  indices: string[]
  total_shards: number
  successful_shards: number
}

// 恢复进度（GetSnapshotRestoreStatus 的 result：indexName -> { shards: [...] }）
interface RestoreStatusShard {
  id: string | number
  type: string
  stage: string
  source?: { name?: string }
  target?: { name?: string }
  index?: { size?: { recovered_in_bytes?: number; total_in_bytes?: number } }
}

interface RestoreStatusIndex {
  shards?: RestoreStatusShard[]
}

// 恢复进度表格行
interface RestoreRow {
  id: string
  index: string
  shard: string | number
  type: string
  stage: string
  source_node: string
  target_node: string
  bytes_recovered: number
  bytes_total: number
}

// SLM 策略（GetSLMPolicies）
interface SlmPolicyItem {
  name: string
  policy?: { repository?: string; schedule?: string; name?: string }
  next_execution?: string | number
  last_success?: { time_string?: string }
  last_failure?: { time_string?: string }
}

// ILM 策略（GetILMPolicies）
interface IlmPolicyItem {
  name: string
  policy?: { phases?: Record<string, unknown> }
  in_use_by?: { indices?: string[] }
  modified_date?: string
}

// 下拉选项
interface SelectOption {
  label: string
  value: string
}

// MUI Chip 颜色名 → Badge variant
type ChipColor = 'success' | 'error' | 'info' | 'warning'
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'info' | 'outline'

// useConfirm 的默认值是零参函数，这里按实际调用方式补上参数类型（仅类型）
type ConfirmFn = (options: { title?: string; content?: string; type?: string }) => Promise<boolean>

// JSON 详情展示（替代 n-code）
function JsonBlock({ content }: { content: ReactNode }) {
  return (
    <pre
      className="m-0 max-h-[65vh] overflow-auto text-left whitespace-pre-wrap break-all font-[Consolas,Monaco,monospace] text-[13px]"
    >
      {content}
    </pre>
  )
}

function TabPanel({ value, name, children }: { value: string; name: string; children: ReactNode }) {
  if (value !== name) return null
  return <div className="pt-2">{children}</div>
}

const toBadgeVariant = (color: ChipColor): BadgeVariant => (color === 'error' ? 'destructive' : color)

export default function Snapshot() {
  const confirm = useConfirm() as ConfirmFn

  const [activeTab, setActiveTab] = useState('repo')

  // ==================== 仓库管理 ====================
  const [repoLoading, setRepoLoading] = useState(false)
  const [repoData, setRepoData] = useState<SnapshotRepository[]>([])
  const [repoForm, setRepoForm] = useState({ show: false, name: '', type: 'fs', settings: '' })

  const repoTypeOptions = [
    { label: 'fs ' + t`Repository Type`, value: 'fs' },
    { label: 's3 (AWS S3)', value: 's3' },
    { label: 'hdfs (Hadoop HDFS)', value: 'hdfs' },
    { label: 'azure (Azure Blob)', value: 'azure' },
    { label: 'gcs (Google Cloud Storage)', value: 'gcs' },
    { label: 'url ' + t`Repository Type`, value: 'url' },
  ]

  const repoSelectOptions = repoData.map(r => ({ label: r.name, value: r.name }))

  const getRepos = async () => {
    setRepoLoading(true)
    try {
      const res = await GetSnapshotRepositories()
      if (res.err !== '') {
        toast.error(res.err)
      } else {
        setRepoData(res.results || [])
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRepoLoading(false)
    }
  }

  const handleCreateRepo = async () => {
    const res = await CreateSnapshotRepository(repoForm.name, repoForm.type, repoForm.settings)
    if (res.err !== '') {
      toast.error(res.err)
      return
    }
    toast.success(t`Repository created successfully`)
    setRepoForm({ show: false, name: '', type: 'fs', settings: '' })
    await getRepos()
  }

  const handleDeleteRepo = async (name: string) => {
    const ok = await confirm({
      title: t`Warning`,
      content: t`Are you sure you want to delete snapshot repository "${name}"? Existing snapshot data files won't be deleted, but the repository registration will be removed from the ES cluster.`,
      type: 'error',
    })
    if (!ok) return
    const res = await DeleteSnapshotRepository(name)
    if (res.err !== '') {
      toast.error(res.err)
    } else {
      toast.success(t`Repository deleted`)
      await getRepos()
    }
  }

  const handleVerifyRepo = async (name: string) => {
    const res = await VerifySnapshotRepository(name)
    if (res.err !== '') {
      const msg = res.err
      toast.error(t`Verification failed: ${msg}`)
    } else {
      toast.success(t`Repository verified, all nodes can access`)
    }
  }

  const repoColumns = [
    { field: 'name', headerName: t`Repository`, width: 180 },
    { field: 'type', headerName: t`Type`, width: 100 },
    {
      field: 'settings',
      headerName: t`Settings`,
      renderCell: ({ row }: { row: SnapshotRepository }) => (row.settings ? JSON.stringify(row.settings) : '-'),
    },
    {
      field: 'actions',
      headerName: t`Actions`,
      width: 180,
      sortable: false,
      renderCell: ({ row }: { row: SnapshotRepository }) => (
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" className="text-info" onClick={() => handleVerifyRepo(row.name)}>
            {t`Verify`}
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeleteRepo(row.name)}>
            {t`Delete`}
          </Button>
        </div>
      ),
    },
  ]

  // ==================== 快照管理 ====================
  const [snapLoading, setSnapLoading] = useState(false)
  const [snapData, setSnapData] = useState<SnapshotItem[]>([])
  const [snapForm, setSnapForm] = useState<{
    show: boolean
    repository: string | null
    snapshot: string
    indices: string
    includeGlobalState: boolean
  }>({
    show: false, repository: null, snapshot: '', indices: '', includeGlobalState: false,
  })
  const [snapDetail, setSnapDetail] = useState({ show: false, content: '' })

  const getSnapshots = async () => {
    setSnapLoading(true)
    try {
      const res = await GetSnapshots()
      if (res.err !== '') {
        toast.error(res.err)
        return []
      }
      const list = ((res.results || []) as SnapshotItem[]).sort((a, b) => {
        return (b.start_time || '').localeCompare(a.start_time || '')
      })
      setSnapData(list)
      // 返回最新列表：调用方不能依赖闭包里的 snapData（setState 后本帧仍是旧值）
      return list
    } catch (e) {
      toast.error((e as Error).message)
      return []
    } finally {
      setSnapLoading(false)
    }
  }

  const handleCreateSnapshot = async () => {
    const res = await CreateSnapshot(
      snapForm.repository as string,
      snapForm.snapshot,
      snapForm.indices,
      snapForm.includeGlobalState
    )
    if (res.err !== '') {
      toast.error(res.err)
      return
    }
    toast.success(t`Snapshot creation started (async), please refresh to check status`)
    setSnapForm({ show: false, repository: null, snapshot: '', indices: '', includeGlobalState: false })
    await getSnapshots()
  }

  const handleDeleteSnapshot = async (repository: string, snapshot: string) => {
    const repo = repository
    const snap = snapshot
    const ok = await confirm({
      title: t`Warning`,
      content: t`Are you sure you want to delete snapshot "${snap}" from repository "${repo}"? This operation is irreversible.`,
      type: 'error',
    })
    if (!ok) return
    const res = await DeleteSnapshot(repository, snapshot)
    if (res.err !== '') {
      toast.error(res.err)
    } else {
      toast.success(t`Snapshot deleted`)
      await getSnapshots()
    }
  }

  const handleViewDetail = async (repository: string, snapshot: string) => {
    const res = await GetSnapshotDetail(repository, snapshot)
    if (res.err !== '') {
      toast.error(res.err)
    } else {
      setSnapDetail({ show: true, content: JSON.stringify(res.result, null, 2) })
    }
  }

  const stateChipColor = (state: string): ChipColor =>
    state === 'SUCCESS' ? 'success' : state === 'FAILED' ? 'error' :
      state === 'IN_PROGRESS' ? 'info' : 'warning'

  const snapColumns = [
    { field: 'snapshot', headerName: t`Snapshot`, width: 160 },
    { field: 'repository', headerName: t`Repository`, width: 130 },
    {
      field: 'state', headerName: t`State`, width: 130,
      renderCell: ({ row }: { row: SnapshotItem }) => (
        <Badge variant={toBadgeVariant(stateChipColor(row.state))}>{row.state}</Badge>
      ),
    },
    { field: 'start_time', headerName: t`Start Time`, width: 170 },
    { field: 'end_time', headerName: t`End Time`, width: 170 },
    {
      field: 'indices', headerName: t`Indices`, width: 80,
      renderCell: ({ row }: { row: SnapshotItem }) => (Array.isArray(row.indices) ? row.indices.length : 0),
    },
    { field: 'total_shards', headerName: t`Total Shards`, width: 90 },
    { field: 'successful_shards', headerName: t`Successful Shards`, width: 130 },
    {
      field: 'actions', headerName: t`Actions`, width: 220, sortable: false,
      renderCell: ({ row }: { row: SnapshotItem }) => (
        <div className="flex gap-1">
          <Button
            size="sm" variant="ghost" className="text-info"
            onClick={() => handleViewDetail(row.repository, row.snapshot)}
          >
            {t`Details`}
          </Button>
          <Button
            size="sm" variant="ghost" className="text-warning"
            onClick={async () => {
              setRestoreForm(f => ({ ...f, repository: row.repository }))
              await onRestoreRepoChange(row.repository)
              setRestoreForm(f => ({ ...f, snapshot: row.snapshot }))
              setActiveTab('restore')
            }}
          >
            {t`Execute`}
          </Button>
          <Button
            size="sm" variant="ghost" className="text-destructive"
            onClick={() => handleDeleteSnapshot(row.repository, row.snapshot)}
          >
            {t`Delete`}
          </Button>
        </div>
      ),
    },
  ]

  // ==================== 快照恢复 ====================
  const [restoreForm, setRestoreForm] = useState<{
    repository: string | null
    snapshot: string | null
    indices: string
    renamePattern: string
    renameReplacement: string
    includeGlobalState: boolean
  }>({
    repository: null, snapshot: null, indices: '',
    renamePattern: '', renameReplacement: '', includeGlobalState: false,
  })
  const [restoreSnapOptions, setRestoreSnapOptions] = useState<SelectOption[]>([])
  const [restoreStatusLoading, setRestoreStatusLoading] = useState(false)
  const [restoreStatusData, setRestoreStatusData] = useState<RestoreRow[]>([])

  const onRestoreRepoChange = async (repo: string | null) => {
    setRestoreSnapOptions([])
    setRestoreForm(f => ({ ...f, snapshot: null }))
    // snapData 是本帧闭包值，getSnapshots 只更新 state 不会改变它，必须用返回值
    const list = snapData.length > 0 ? snapData : await getSnapshots()
    const filtered = (list || []).filter(s => s.repository === repo && s.state === 'SUCCESS')
    setRestoreSnapOptions(filtered.map(s => ({ label: s.snapshot, value: s.snapshot })))
  }

  const handleRestore = async () => {
    if (!restoreForm.repository || !restoreForm.snapshot) {
      toast.warning(t`Please select a repository and snapshot`)
      return
    }
    const repo = restoreForm.repository
    const snap = restoreForm.snapshot
    const ok = await confirm({
      title: t`Warning`,
      content: t`About to restore snapshot "${snap}" from repository "${repo}". The restore operation will create index data in the cluster. Please confirm you understand the impact.`,
      type: 'error',
    })
    if (!ok) return
    const res = await RestoreSnapshot(
      restoreForm.repository,
      restoreForm.snapshot,
      restoreForm.indices,
      restoreForm.renamePattern,
      restoreForm.renameReplacement,
      restoreForm.includeGlobalState
    )
    if (res.err !== '') {
      toast.error(res.err)
    } else {
      toast.success(t`Restore task submitted (async), please check restore progress`)
      await getRestoreStatus()
    }
  }

  const getRestoreStatus = async () => {
    setRestoreStatusLoading(true)
    try {
      const res = await GetSnapshotRestoreStatus()
      if (res.err !== '') {
        toast.error(res.err)
        setRestoreStatusData([])
      } else {
        const data = (res.result || {}) as Record<string, RestoreStatusIndex>
      const list: RestoreRow[] = []
      for (const [indexName, info] of Object.entries(data)) {
        const shards = info.shards || []
        for (const shard of shards) {
          list.push({
            id: `${indexName}-${shard.id}-${list.length}`,
            index: indexName,
            shard: shard.id,
            type: shard.type,
            stage: shard.stage,
            source_node: shard.source?.name || '-',
            target_node: shard.target?.name || '-',
            bytes_recovered: shard.index?.size?.recovered_in_bytes || 0,
            bytes_total: shard.index?.size?.total_in_bytes || 0,
          })
        }
      }
      setRestoreStatusData(list)
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRestoreStatusLoading(false)
    }
  }

  const stageChipColor = (stage: string): ChipColor =>
    stage === 'DONE' ? 'success' : stage === 'INDEX' ? 'info' : 'warning'

  const restoreColumns = [
    { field: 'index', headerName: t`Index`, width: 160 },
    { field: 'shard', headerName: t`Shard`, width: 60 },
    { field: 'type', headerName: t`Type`, width: 100 },
    {
      field: 'stage', headerName: t`Stage`, width: 110,
      renderCell: ({ row }: { row: RestoreRow }) => (
        <Badge variant={toBadgeVariant(stageChipColor(row.stage))}>{row.stage}</Badge>
      ),
    },
    { field: 'source_node', headerName: t`Source Node`, width: 120 },
    { field: 'target_node', headerName: t`Target Node`, width: 120 },
    {
      field: 'progress', headerName: t`Progress`, width: 120,
      renderCell: ({ row }: { row: RestoreRow }) => {
        if (row.bytes_total === 0) return '-'
        const pct = Math.round(row.bytes_recovered / row.bytes_total * 100)
        return pct + '%'
      },
    },
  ]

  // ==================== SLM 策略管理 ====================
  const [slmLoading, setSlmLoading] = useState(false)
  const [slmData, setSlmData] = useState<SlmPolicyItem[]>([])
  const [slmForm, setSlmForm] = useState<{
    show: boolean
    policyId: string
    name: string
    schedule: string
    repository: string | null
    indices: string
    expireAfter: string
    minCount: number | string
    maxCount: number | string
  }>({
    show: false, policyId: '', name: '<daily-snap-{now/d}>', schedule: '0 30 1 * * ?',
    repository: null, indices: '', expireAfter: '30d', minCount: 5, maxCount: 50,
  })

  const getSLMPolicies = async () => {
    setSlmLoading(true)
    try {
      const res = await GetSLMPolicies()
      if (res.err !== '') {
        toast.error(res.err)
      } else {
        setSlmData(res.results || [])
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSlmLoading(false)
    }
  }

  const handleCreateSLM = async () => {
    const f = slmForm
    const res = await CreateSLMPolicy(
      f.policyId, f.name, f.schedule, f.repository as string, f.indices,
      f.expireAfter, (f.minCount || 0) as number, (f.maxCount || 0) as number
    )
    if (res.err !== '') {
      toast.error(res.err)
      return
    }
    toast.success(t`SLM policy created successfully`)
    setSlmForm({
      show: false, policyId: '', name: '<daily-snap-{now/d}>', schedule: '0 30 1 * * ?',
      repository: null, indices: '', expireAfter: '30d', minCount: 5, maxCount: 50
    })
    await getSLMPolicies()
  }

  const handleDeleteSLM = async (policyId: string) => {
    const ok = await confirm({
      title: t`Warning`,
      content: t`Are you sure you want to delete SLM policy "${policyId}"? Existing snapshots won't be deleted.`,
      type: 'error',
    })
    if (!ok) return
    const res = await DeleteSLMPolicy(policyId)
    if (res.err !== '') {
      toast.error(res.err)
    } else {
      toast.success(t`Policy deleted`)
      await getSLMPolicies()
    }
  }

  const handleExecuteSLM = async (policyId: string) => {
    const ok = await confirm({
      title: t`Warning`,
      content: t`Are you sure you want to immediately execute policy "${policyId}" to create a snapshot?`,
    })
    if (!ok) return
    const res = await ExecuteSLMPolicy(policyId)
    if (res.err !== '') {
      toast.error(res.err)
    } else {
      toast.success(t`Policy executed, snapshot is being created`)
    }
  }

  const slmColumns = [
    { field: 'name', headerName: t`Policy ID`, width: 160 },
    {
      field: 'repository', headerName: t`Repository`, width: 130,
      renderCell: ({ row }: { row: SlmPolicyItem }) => (row.policy && row.policy.repository) || '-',
    },
    {
      field: 'schedule', headerName: t`Schedule`, width: 160,
      renderCell: ({ row }: { row: SlmPolicyItem }) => (row.policy && row.policy.schedule) || '-',
    },
    {
      field: 'snapshot_name', headerName: t`Snapshot Name Template`, width: 200,
      renderCell: ({ row }: { row: SlmPolicyItem }) => (row.policy && row.policy.name) || '-',
    },
    {
      field: 'next_execution_millis', headerName: t`Next Execution`, width: 170,
      renderCell: ({ row }: { row: SlmPolicyItem }) => (row.next_execution ? row.next_execution : '-'),
    },
    {
      field: 'last_success', headerName: t`Last Success`, width: 170,
      renderCell: ({ row }: { row: SlmPolicyItem }) => {
        if (row.last_success && row.last_success.time_string) {
          return row.last_success.time_string
        }
        return '-'
      },
    },
    {
      field: 'last_failure', headerName: t`Last Failure`, width: 170,
      renderCell: ({ row }: { row: SlmPolicyItem }) => {
        if (row.last_failure && row.last_failure.time_string) {
          return <Badge variant="destructive">{row.last_failure.time_string}</Badge>
        }
        return '-'
      },
    },
    {
      field: 'actions', headerName: t`Actions`, width: 180, sortable: false,
      renderCell: ({ row }: { row: SlmPolicyItem }) => (
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" className="text-info" onClick={() => handleExecuteSLM(row.name)}>
            {t`Execute`}
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeleteSLM(row.name)}>
            {t`Delete`}
          </Button>
        </div>
      ),
    },
  ]

  // ==================== ILM 索引生命周期管理 ====================
  const [ilmLoading, setIlmLoading] = useState(false)
  const [ilmData, setIlmData] = useState<IlmPolicyItem[]>([])
  const [ilmForm, setIlmForm] = useState({ show: false, policyId: '', policy: '', saving: false })
  const [ilmDetail, setIlmDetail] = useState({ show: false, title: '', content: '' })

  const getILMPolicies = async () => {
    setIlmLoading(true)
    try {
      const res = await GetILMPolicies()
      if (res.err !== '') {
        toast.error(res.err)
      } else {
        setIlmData(((res.results || []) as IlmPolicyItem[]).sort((a, b) => (a.name || '').localeCompare(b.name || '')))
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setIlmLoading(false)
    }
  }

  const openCreateILM = () => {
    setIlmForm({ show: true, policyId: '', policy: '', saving: false })
  }

  const handleCreateILM = async () => {
    if (!ilmForm.policyId || !ilmForm.policy) {
      toast.warning(t`Please fill in the policy ID and policy content`)
      return
    }
    setIlmForm(f => ({ ...f, saving: true }))
    try {
      const res = await CreateILMPolicy(ilmForm.policyId, ilmForm.policy)
      if (res.err !== '') {
        toast.error(res.err)
      } else {
        toast.success(t`ILM policy created successfully`)
        setIlmForm(f => ({ ...f, show: false }))
        await getILMPolicies()
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setIlmForm(f => ({ ...f, saving: false }))
    }
  }

  const viewILMDetail = (row: IlmPolicyItem) => {
    setIlmDetail({
      show: true,
      title: row.name,
      content: JSON.stringify({ policy: row.policy, in_use_by: row.in_use_by }, null, 2),
    })
  }

  const handleDeleteILM = async (policyId: string) => {
    const ok = await confirm({
      title: t`Warning`,
      content: t`Are you sure you want to delete ILM policy "${policyId}"? Indices using it will no longer be lifecycle-managed.`,
      type: 'error',
    })
    if (!ok) return
    const res = await DeleteILMPolicy(policyId)
    if (res.err !== '') {
      toast.error(res.err)
    } else {
      toast.success(t`ILM policy deleted`)
      await getILMPolicies()
    }
  }

  const renderPhases = (row: IlmPolicyItem) => {
    const phases = row.policy && row.policy.phases
    if (!phases || typeof phases !== 'object') return '-'
    return Object.keys(phases).join(', ')
  }

  const renderIlmIndices = (row: IlmPolicyItem) => {
    const indices = row.in_use_by && row.in_use_by.indices
    if (!Array.isArray(indices) || indices.length === 0) return '-'
    return indices.join(', ')
  }

  const ilmColumns = [
    { field: 'name', headerName: t`Policy ID`, width: 160 },
    {
      field: 'phases', headerName: t`Phases`,
      renderCell: ({ row }: { row: IlmPolicyItem }) => renderPhases(row),
    },
    {
      field: 'in_use_by', headerName: t`Indices In Use`,
      renderCell: ({ row }: { row: IlmPolicyItem }) => renderIlmIndices(row),
    },
    {
      field: 'modified_date', headerName: t`Modified At`, width: 170,
      renderCell: ({ row }: { row: IlmPolicyItem }) => row.modified_date || '-',
    },
    {
      field: 'actions', headerName: t`Actions`, width: 180, sortable: false,
      renderCell: ({ row }: { row: IlmPolicyItem }) => (
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" className="text-info" onClick={() => viewILMDetail(row)}>
            {t`Details`}
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeleteILM(row.name)}>
            {t`Delete`}
          </Button>
        </div>
      ),
    },
  ]

  // ==================== 生命周期 ====================
  useEffect(() => {
    const selectNode = async () => {
      setRepoData([])
      setSnapData([])
      setSlmData([])
      setIlmData([])
      await loadAllData()
    }
    const loadAllData = async () => {
      await getRepos()
      await getSnapshots()
      await getSLMPolicies()
      await getILMPolicies()
    }
    emitter.on('selectNode', selectNode)
    loadAllData()
    return () => emitter.off('selectNode', selectNode)
  }, [])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center">
        <h2>{t`Snapshot Management`}</h2>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v)}>
        <TabsList>
          <TabsTrigger value="repo">{t`Repository`}</TabsTrigger>
          <TabsTrigger value="snapshot">{t`Snapshots`}</TabsTrigger>
          <TabsTrigger value="restore">{t`Restore`}</TabsTrigger>
          <TabsTrigger value="slm">{t`SLM Policy`}</TabsTrigger>
          <TabsTrigger value="ilm">{t`Lifecycle (ILM)`}</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* ==================== 仓库 ==================== */}
      <TabPanel value={activeTab} name="repo">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={getRepos}><RefreshCw className="size-4" />{t`Refresh`}</Button>
            <Button onClick={() => setRepoForm(f => ({ ...f, show: true }))}>
              <Plus className="size-4" />{t`Create Repository`}
            </Button>
          </div>
          <div className="relative">
            <DataTable
              columns={repoColumns}
              rows={repoData}
              getRowId={(row) => row.name}
              pagination={false}
            />
            {repoLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                <Spinner />
              </div>
            )}
          </div>
        </div>

        <Dialog
          open={repoForm.show}
          onOpenChange={(v) => { if (!v) setRepoForm(f => ({ ...f, show: false })) }}
        >
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>{t`Create Repository`}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-2 mt-1">
              <div className="flex flex-col gap-1.5">
                <Label>{t`Repository Name`}</Label>
                <Input
                  placeholder="my_backup_repo"
                  value={repoForm.name}
                  onChange={(e) => setRepoForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t`Repository Type`}</Label>
                <Select
                  value={repoForm.type}
                  onValueChange={(v) => setRepoForm(f => ({ ...f, type: v }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {repoTypeOptions.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t`Settings (JSON)`}</Label>
                <Textarea
                  rows={3}
                  placeholder='例如: {"location": "/mount/backups/my_backup"}'
                  value={repoForm.settings}
                  onChange={(e) => setRepoForm(f => ({ ...f, settings: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRepoForm(f => ({ ...f, show: false }))}>{t`Cancel`}</Button>
              <Button onClick={handleCreateRepo}>{t`Confirm`}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TabPanel>

      {/* ==================== 快照 ==================== */}
      <TabPanel value={activeTab} name="snapshot">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={getSnapshots}><RefreshCw className="size-4" />{t`Refresh`}</Button>
            <Button onClick={() => setSnapForm(f => ({ ...f, show: true }))}>
              <Plus className="size-4" />{t`Create Snapshot`}
            </Button>
          </div>
          <div className="relative">
            <DataTable
              columns={snapColumns}
              rows={snapData}
              getRowId={(row) => `${row.repository}/${row.snapshot}`}
              pagination={false}
            />
            {snapLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                <Spinner />
              </div>
            )}
          </div>
        </div>

        <Dialog
          open={snapForm.show}
          onOpenChange={(v) => { if (!v) setSnapForm(f => ({ ...f, show: false })) }}
        >
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>{t`Create Snapshot`}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-2 mt-1">
              <div className="flex flex-col gap-1.5">
                <Label>{t`Repository Name`}</Label>
                <Select
                  value={snapForm.repository ?? ''}
                  onValueChange={(v) => setSnapForm(f => ({ ...f, repository: v || null }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t`Select target repository`} />
                  </SelectTrigger>
                  <SelectContent>
                    {repoSelectOptions.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t`Snapshot Name`}</Label>
                <Input
                  placeholder="snapshot_2026"
                  value={snapForm.snapshot}
                  onChange={(e) => setSnapForm(f => ({ ...f, snapshot: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t`Indices (comma separated)`}</Label>
                <Input
                  placeholder={t`Leave empty for all indices`}
                  value={snapForm.indices}
                  onChange={(e) => setSnapForm(f => ({ ...f, indices: e.target.value }))}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="snap-include-global-state"
                  checked={snapForm.includeGlobalState}
                  onCheckedChange={(v) => setSnapForm(f => ({ ...f, includeGlobalState: v }))}
                />
                <Label htmlFor="snap-include-global-state">{t`Include Global State`}</Label>
              </div>
            </div>
            <p className="text-[13px] text-muted-foreground mt-2">
              {t`Snapshot will be created asynchronously in the background. Check the snapshot list for progress.`}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSnapForm(f => ({ ...f, show: false }))}>{t`Cancel`}</Button>
              <Button onClick={handleCreateSnapshot}>{t`Confirm`}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={snapDetail.show}
          onOpenChange={(v) => { if (!v) setSnapDetail(d => ({ ...d, show: false })) }}
        >
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>{t`Details`}</DialogTitle>
            </DialogHeader>
            <JsonBlock content={snapDetail.content} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setSnapDetail(d => ({ ...d, show: false }))}>{t`Close`}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TabPanel>

      {/* ==================== 恢复 ==================== */}
      <TabPanel value={activeTab} name="restore">
        <div className="flex flex-col gap-2">
          <div className="flex items-center">
            <Button variant="ghost" onClick={getRestoreStatus}><RefreshCw className="size-4" />{t`Refresh`}</Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t`Restore`}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2 max-w-[680px]">
                <div className="flex flex-col gap-1.5">
                  <Label>{t`Repository Name`}</Label>
                  <Select
                    value={restoreForm.repository ?? ''}
                    onValueChange={(v) => onRestoreRepoChange(v || null)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t`Select target repository`} />
                    </SelectTrigger>
                    <SelectContent>
                      {repoSelectOptions.map(o => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t`Snapshot Name`}</Label>
                  <Select
                    value={restoreForm.snapshot ?? ''}
                    onValueChange={(v) => setRestoreForm(f => ({ ...f, snapshot: v || null }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t`Select snapshot to restore`} />
                    </SelectTrigger>
                    <SelectContent>
                      {restoreSnapOptions.map(o => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t`Indices (comma separated)`}</Label>
                  <Input
                    placeholder={t`Leave empty for all indices`}
                    value={restoreForm.indices}
                    onChange={(e) => setRestoreForm(f => ({ ...f, indices: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Rename Pattern</Label>
                  <Input
                    placeholder="例如: index_(.+)"
                    value={restoreForm.renamePattern}
                    onChange={(e) => setRestoreForm(f => ({ ...f, renamePattern: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Rename Replacement</Label>
                  <Input
                    placeholder="例如: restored_index_$1"
                    value={restoreForm.renameReplacement}
                    onChange={(e) => setRestoreForm(f => ({ ...f, renameReplacement: e.target.value }))}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="restore-include-global-state"
                    checked={restoreForm.includeGlobalState}
                    onCheckedChange={(v) => setRestoreForm(f => ({ ...f, includeGlobalState: v }))}
                  />
                  <Label htmlFor="restore-include-global-state">{t`Include Global State`}</Label>
                </div>
                <div className="flex">
                  <Button className="bg-warning text-white hover:bg-warning/90" onClick={handleRestore}>{t`Execute`}</Button>
                </div>
                <p className="text-[13px] text-muted-foreground">
                  {t`Warning: Restoring will create indices in the cluster. If an index with the same name already exists and is not closed, the restore will fail. Use rename pattern to avoid conflicts.`}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t`Result`}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <DataTable
                  columns={restoreColumns}
                  rows={restoreStatusData}
                  pagination={false}
                />
                {restoreStatusLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                    <Spinner />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </TabPanel>

      {/* ==================== SLM ==================== */}
      <TabPanel value={activeTab} name="slm">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={getSLMPolicies}><RefreshCw className="size-4" />{t`Refresh`}</Button>
            <Button onClick={() => setSlmForm(f => ({ ...f, show: true }))}>
              <Plus className="size-4" />{t`Create Policy`}
            </Button>
          </div>
          <div className="relative">
            <DataTable
              columns={slmColumns}
              rows={slmData}
              getRowId={(row) => row.name}
              pagination={false}
            />
            {slmLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                <Spinner />
              </div>
            )}
          </div>
        </div>

        <Dialog
          open={slmForm.show}
          onOpenChange={(v) => { if (!v) setSlmForm(f => ({ ...f, show: false })) }}
        >
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>{t`Create Policy`}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-2 mt-1">
              <div className="flex flex-col gap-1.5">
                <Label>{t`Policy ID`}</Label>
                <Input
                  placeholder="daily-snapshots"
                  value={slmForm.policyId}
                  onChange={(e) => setSlmForm(f => ({ ...f, policyId: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t`Snapshot Name Template`}</Label>
                <Input
                  placeholder="<daily-snap-{now/d}>"
                  value={slmForm.name}
                  onChange={(e) => setSlmForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t`Schedule`}</Label>
                <Input
                  placeholder="0 30 1 * * ?（每天凌晨1:30）"
                  value={slmForm.schedule}
                  onChange={(e) => setSlmForm(f => ({ ...f, schedule: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t`Repository Name`}</Label>
                <Select
                  value={slmForm.repository ?? ''}
                  onValueChange={(v) => setSlmForm(f => ({ ...f, repository: v || null }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t`Select target repository`} />
                  </SelectTrigger>
                  <SelectContent>
                    {repoSelectOptions.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t`Indices (comma separated)`}</Label>
                <Input
                  placeholder={t`Leave empty for all indices`}
                  value={slmForm.indices}
                  onChange={(e) => setSlmForm(f => ({ ...f, indices: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Expire After</Label>
                <Input
                  placeholder="例如: 30d"
                  value={slmForm.expireAfter}
                  onChange={(e) => setSlmForm(f => ({ ...f, expireAfter: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Min Count</Label>
                <Input
                  type="number"
                  placeholder="5"
                  value={slmForm.minCount}
                  onChange={(e) => setSlmForm(f => ({ ...f, minCount: e.target.value === '' ? '' : Number(e.target.value) }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Max Count</Label>
                <Input
                  type="number"
                  placeholder="50"
                  value={slmForm.maxCount}
                  onChange={(e) => setSlmForm(f => ({ ...f, maxCount: e.target.value === '' ? '' : Number(e.target.value) }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSlmForm(f => ({ ...f, show: false }))}>{t`Cancel`}</Button>
              <Button onClick={handleCreateSLM}>{t`Confirm`}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TabPanel>

      {/* ==================== ILM ==================== */}
      <TabPanel value={activeTab} name="ilm">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={getILMPolicies}><RefreshCw className="size-4" />{t`Refresh`}</Button>
            <Button onClick={openCreateILM}>
              <Plus className="size-4" />{t`Create ILM Policy`}
            </Button>
          </div>
          <div className="relative">
            <DataTable
              columns={ilmColumns}
              rows={ilmData}
              getRowId={(row) => row.name}
              pagination={false}
            />
            {ilmLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                <Spinner />
              </div>
            )}
          </div>
        </div>

        <Dialog
          open={ilmForm.show}
          onOpenChange={(v) => { if (!v) setIlmForm(f => ({ ...f, show: false })) }}
        >
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t`Create ILM Policy`}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-2 mt-1">
              <div className="flex flex-col gap-1.5">
                <Label>{t`Policy ID`}</Label>
                <Input
                  placeholder="logs-lifecycle"
                  value={ilmForm.policyId}
                  onChange={(e) => setIlmForm(f => ({ ...f, policyId: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t`Policy (JSON)`}</Label>
                <Textarea
                  rows={12}
                  className="json-editor-input text-left font-[Consolas,Monaco,monospace]"
                  placeholder={JSON.stringify({ "phases": { "hot": { "actions": {} }, "delete": { "min_age": "30d", "actions": { "delete": {} } } } }, null, 2)}
                  value={ilmForm.policy}
                  onChange={(e) => setIlmForm(f => ({ ...f, policy: e.target.value }))}
                />
              </div>
            </div>
            <p className="text-[13px] text-muted-foreground mt-2">
              {t`An ILM policy contains phases (hot/warm/cold/delete, etc.) and automatically performs rollover, shrink, delete and other operations on matching indices.`}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIlmForm(f => ({ ...f, show: false }))}>{t`Cancel`}</Button>
              <Button disabled={ilmForm.saving} onClick={handleCreateILM}>
                {ilmForm.saving && <Spinner className="size-4" />}{t`Save`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={ilmDetail.show}
          onOpenChange={(v) => { if (!v) setIlmDetail(d => ({ ...d, show: false })) }}
        >
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{ilmDetail.title}</DialogTitle>
            </DialogHeader>
            <JsonBlock content={ilmDetail.content} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setIlmDetail(d => ({ ...d, show: false }))}>{t`Close`}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TabPanel>
    </div>
  )
}
