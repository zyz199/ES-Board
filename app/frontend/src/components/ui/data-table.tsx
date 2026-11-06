import * as React from 'react'
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type { CellContext, ColumnDef, RowData, SortingState } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/**
 * 基于 TanStack Table 的数据表格（shadcn Table 风格）。
 * API 与原 MUI DataGrid 尽量对齐，便于平滑迁移：
 *
 * columns: [{ field, headerName, width, flex, align, sortable, renderCell({ row, value }), valueGetter }]
 * rows:    对象数组
 * pagination: false 关闭分页；默认开启，pageSize 默认 25（原 DataGrid 页码从 0 起，这里从 1 起）
 * autoHeight: true 时不固定高度、不出现纵向滚动条（自然撑开）
 * onRowClick({ row })
 */

type DataTableAlign = 'left' | 'center' | 'right'

/** 列上除 TanStack 原生配置外，额外允许携带的对齐信息。 */
interface DataTableColumnMeta {
  align?: DataTableAlign
}

/** MUI DataGrid 风格的列定义（内部会转成 TanStack 的 ColumnDef）。 */
interface DataTableColumn<TData, TValue = unknown> {
  id?: string
  field: string
  headerName?: React.ReactNode
  width?: number | string
  flex?: number
  align?: DataTableAlign
  sortable?: boolean
  renderCell?: (params: { row: TData; value: TValue; field: string }) => React.ReactNode
  valueGetter?: (row: TData) => TValue
  /** 其余字段（如 minWidth/maxWidth 等）原样透传给 TanStack */
  [key: string]: unknown
}

/** 组件内部真正交给 TanStack 的列定义：在 ColumnDef 基础上补上透传的 width / align。 */
type DataTableColumnDef<TData extends RowData> = ColumnDef<TData, unknown> & {
  width?: number | string
  meta?: DataTableColumnMeta
}

export interface DataTableProps<TData, TValue = unknown>
  extends Omit<React.ComponentProps<'div'>, 'children'> {
  columns?: DataTableColumn<TData, TValue>[]
  rows?: TData[]
  pagination?: boolean
  pageSize?: number
  autoHeight?: boolean
  getRowId?: (row: TData) => string | number
  onRowClick?: (params: { row: TData }) => void
  emptyMessage?: React.ReactNode
}

// 把 MUI DataGrid 列定义转成 TanStack 列定义
function toTanStackColumns<TData extends RowData, TValue>(
  columns: DataTableColumn<TData, TValue>[],
): ColumnDef<TData, unknown>[] {
  return columns.map((col) => {
    const { field, headerName, renderCell, valueGetter, sortable = true, align, ...rest } = col
    const column = {
      ...rest,
      id: col.id || field,
      accessorKey: field,
      header: headerName ?? field,
      enableSorting: sortable,
      meta: { align },
      cell: ({ row, getValue }: CellContext<TData, TValue>) => {
        const value = typeof valueGetter === 'function' ? valueGetter(row.original) : getValue()
        if (renderCell) {
          return renderCell({ row: row.original, value, field })
        }
        return value == null ? '' : String(value)
      },
    }
    return column as unknown as ColumnDef<TData, unknown>
  })
}

const alignClass = { center: 'text-center', right: 'text-right', left: 'text-left' }

export function DataTable<TData extends RowData, TValue = unknown>({
  columns,
  rows,
  pagination = true,
  pageSize = 25,
  autoHeight = true,
  getRowId,
  onRowClick,
  className,
  emptyMessage = 'No data',
  ...rest
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [internalPage, setInternalPage] = React.useState(1)

  const totalRows = rows?.length || 0
  const maxPage = Math.max(Math.ceil(totalRows / pageSize), 1)

  const tanColumns = React.useMemo(
    () => toTanStackColumns<TData, TValue>(columns || []),
    [columns],
  )

  const table = useReactTable<TData>({
    data: rows || [],
    columns: tanColumns,
    getRowId: getRowId ? (row) => String(getRowId(row)) : undefined,
    state: {
      sorting,
      pagination: { pageIndex: internalPage - 1, pageSize },
    },
    onPaginationChange: (updater) => {
      setInternalPage((p) => {
        const current = { pageIndex: p - 1, pageSize }
        const next = typeof updater === 'function' ? updater(current) : updater
        return Math.min(Math.max(next.pageIndex + 1, 1), maxPage)
      })
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: pagination ? getPaginationRowModel() : undefined,
  })

  const pageCount = table.getPageCount()

  const headers = table.getHeaderGroups()

  return (
    <div className={cn('flex flex-col gap-2', className)} {...rest}>
      <div className={cn('rounded-md border bg-card overflow-hidden', !autoHeight && 'flex-1 min-h-0 overflow-y-auto')}>
        <Table>
          <TableHeader>
            {headers.map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((header) => {
                  const columnDef = header.column.columnDef as DataTableColumnDef<TData>
                  const canSort = header.column.getCanSort()
                  const sorted = header.column.getIsSorted()
                  const align = columnDef.meta?.align
                  return (
                    <TableHead
                      key={header.id}
                      style={{ width: columnDef.width ? columnDef.width : undefined }}
                      className={cn(align && alignClass[align], canSort && 'select-none')}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' ? (
                            <ArrowUp className="size-3" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="size-3" />
                          ) : (
                            <ArrowUpDown className="size-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(onRowClick && 'cursor-pointer')}
                  onClick={onRowClick ? () => onRowClick({ row: row.original }) : undefined}
                >
                  {row.getVisibleCells().map((cell) => {
                    const align = (cell.column.columnDef as DataTableColumnDef<TData>).meta?.align
                    return (
                      <TableCell key={cell.id} className={cn(align && alignClass[align])}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={headers[0]?.headers.length || 1} className="h-24 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {pagination && totalRows > 0 && (
        <div className="flex items-center justify-between text-[13px] text-muted-foreground px-1">
          <span>
            {totalRows} rows · page {internalPage} / {pageCount}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={internalPage <= 1}
              onClick={() => setInternalPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={internalPage >= pageCount}
              onClick={() => setInternalPage((p) => Math.min(pageCount, p + 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default DataTable
