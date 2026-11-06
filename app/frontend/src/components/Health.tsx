import { useEffect, useState } from 'react'
import { t } from '@lingui/macro'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { RefreshCw } from 'lucide-react'
import { toast } from '@/components/ui/sonner'
import emitter from '../utils/eventBus'
import { GetHealth } from '../../wailsjs/go/service/ESService'

export default function Health() {
  const [data, setData] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(false)

  const getTagType = (key: string, value: unknown) => {
    if (['cluster_name'].includes(key)) {
      return 'success'
    }
    if (['unassigned_shards', 'delayed_unassigned_shards', 'initializing_shards'].includes(key)) {
      return 'warning'
    }
    if (key === 'timed_out') {
      return value === true ? 'error' : 'success'
    }
    if (key === 'status') {
      if (value === 'green') {
        return 'success'
      } else {
        return value === 'yellow' ? 'warning' : 'error'
      }
    }
    return 'default'
  }

  const getLabel = (key: string) => {
    const descriptions: Record<string, string> = {
      cluster_name: t`Cluster name`,
      status: t`Cluster health status (green, yellow, red)`,
      timed_out: t`Whether the request timed out`,
      number_of_nodes: t`Number of nodes in the cluster`,
      number_of_data_nodes: t`Number of data nodes in the cluster`,
      active_primary_shards: t`Number of active primary shards`,
      active_shards: t`Number of active total shards`,
      relocating_shards: t`Number of shards being relocated`,
      initializing_shards: t`Number of shards being initialized`,
      unassigned_shards: t`Number of unassigned shards`,
      delayed_unassigned_shards: t`Number of delayed unassigned shards`,
      number_of_pending_tasks: t`Number of pending cluster-level tasks`,
      number_of_in_flight_fetch: t`Number of in-flight shard fetches`,
      task_max_waiting_in_queue_millis: t`Max task waiting time in queue (ms)`,
      active_shards_percent_as_number: t`Active shards percentage`,
    }
    return descriptions[key] || t`No description`
  }

  const getData = async () => {
    setLoading(true)
    try {
      const res = await GetHealth()
      if (res.err !== '') {
        toast.error(res.err)
      } else {
        setData(res.result as Record<string, unknown>)
        emitter.emit('changeTitleType', getTagType('status', res.result['status']))
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const selectNode = async () => {
    await getData()
  }

  useEffect(() => {
    emitter.on('selectNode', selectNode)
    getData()
    return () => {
      emitter.off('selectNode', selectNode)
    }
  }, [])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <h2>{t`Health`}</h2>
        <Button variant="ghost" onClick={getData}>
          <RefreshCw className="size-4" />
          {t`Refresh`}
        </Button>
      </div>
      <div className="relative">
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/60">
            <Spinner />
            <p className="text-[13px] mt-1">{t`Connecting...`}</p>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t`Health Metrics`}</TableHead>
              <TableHead>{t`Value`}</TableHead>
              <TableHead>{t`Full Key`}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(data).map(([key, value]) => {
              // Badge 没有 error 变体（naive-ui 的 error 即 shadcn 的 destructive）
              const tagType = getTagType(key, value)
              return (
                <TableRow key={key}>
                  <TableCell>{getLabel(key)}</TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant={tagType === 'error' ? 'destructive' : tagType}>{String(value)}</Badge>
                      </TooltipTrigger>
                      <TooltipContent side="left">{String(value)}</TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell>{key}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
