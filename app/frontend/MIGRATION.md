# MUI → shadcn/Radix + Tailwind 迁移约定

本文件是 UI 框架迁移的**唯一约定来源**。目标：UI 层从 MUI 换为 shadcn/ui（Radix + Tailwind），React 升级 19。**业务逻辑、Lingui 文案、wailsjs 调用、事件总线行为一律不得改变。**

> 2026-09-30 起前端已全量 JS → **TypeScript**（`strict: true`），源码里不再有 `.js`/`.jsx`。
> 本文档中的代码片段仍以 JSX 语法示意（`.tsx` 下的 JSX 写法完全相同），类型约定见下面的「TypeScript 约定」一节。

## 硬性规则

1. **保留** 所有 `t\`...\`` Lingui 宏、`setLocale` 调用，msgid 文案一字不改。**不要新增** `i18n._('字面量')` 写法（已有的一律换成 `t` 宏，见 i18n 一节）。
2. **保留** 所有 `wailsjs/go/**`、`wailsjs/runtime` 调用及其参数。
3. **保留** 所有 `emitter.on/off/emit` 事件名与载荷。
4. **保留** `--wails-draggable` 内联样式（Header/Aside 区域的 drag/no-drag）。
5. **不得** 引入 `@mui/*`、`@emotion/*`、`notistack`、`styled-components`。迁移后文件中不允许出现 `sx=`、`makeStyles`。
6. 不新增第三方依赖，只用现有依赖（`src/components/ui/*` 已备齐，见下）。
7. 保持组件导出签名不变（`export default function Xxx()`），文件名不变。
8. 逻辑代码（useEffect/useRef/handler/state）原样保留，只改 JSX 结构与样式写法。

## TypeScript 约定（2026-09-30 起：全量 JSX → TSX）

前端已从 JS 全量迁移到 TypeScript（`strict: true`），源码里**不再有 `.js` / `.jsx`**。

### 工具链

| 项目 | 约定 |
|---|---|
| 配置 | `tsconfig.json`：`strict`、`jsx: react-jsx`、`moduleResolution: bundler`、`paths: {"@/*": ["src/*"]}`、`resolveJsonModule`、`skipLibCheck` |
| 脚本 | `pnpm typecheck`（tsc --noEmit）· `pnpm lint`（eslint src/ test/）· `pnpm test`（vitest）· `pnpm build`（vite build） |
| 扩展名 | 组件 `.tsx`；纯逻辑/工具 `.ts`；测试 `test/**/*.test.ts`；配置 `vite.config.ts` / `vitest.config.ts` / `lingui.config.ts` |
| 入口 | `index.html` 的 `<script>` 必须写 `./src/main.tsx`（曾残留 `main.jsx`，靠 Vite 的扩展名回退才侥幸构建成功，已修） |
| 类型来源 | wailsjs 自带 `.d.ts`：`types.ResultResp = {result:any; err:string}`、`types.ResultsResp = {results:any[]; err:string}`、`types.Config`、`types.Connect`、`types.History`、`types.Tag` |

### 硬规则

1. **零运行时改动**：迁移只加类型，不改逻辑 / className / 文案 / 事件名 / 内联样式。
2. 后端响应体是 `any`：用到字段时在**使用它的文件内**定义局部 `interface` 再断言，不要新建共享类型文件。
3. 事件总线类型表在 `src/utils/eventBus.ts` 的 `AppEvents`：**必须是 type alias（不能写 interface）**——mitt 的泛型约束要求隐式索引签名。新增事件要先把载荷类型写进 `AppEvents`。
4. `--wails-draggable` 不在 `CSSProperties` 里，内联样式写成 `style={{ '--wails-draggable': 'drag' } as CSSProperties}`。
5. Badge 没有 `error` 变体：naive-ui/MUI 的 `error` 一律映射成 `destructive`（`variant === 'error' ? 'destructive' : variant`）。
6. `catch (e)` 里 `e` 是 `unknown`，统一 `(e as Error).message`。
7. 未类型化的第三方库（jsoneditor）用一行 `// @ts-expect-error <原因>` 放行，并在本文件写最小接口描述实例成员；**不要**为此安装新依赖。
8. 别用 `any` 大面积糊过去；确需兜底时限定最小范围并加注释说明原因。

### 验证链

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

> ⚠️ `vite build` 会清空 `dist/`，在 WorkBuddy 沙箱内会被 file-delete 拦截而中途被杀 —— **必须非沙箱前台执行**。
> 逐页冒烟脚本：`.workbuddy/smoke/es-king-smoke.mjs`（从 `wailsjs/go/**.d.ts` 自动生成 `window.go` stub，用 Chromium 遍历 14 个菜单页并收集 console/page 错误；同样需非沙箱）。

## 可用 UI 组件（`@/components/ui/*`）

| 组件 | 导入 | 要点 |
|---|---|---|
| Button | `@/components/ui/button` | `variant: default(主色)/destructive/outline/secondary/ghost/link`，`size: default/sm/lg/icon/icon-sm`；MUI `variant="contained"`→`default`，`"outlined"`→`outline`，`"text"`→`ghost`；`color="error"`→`variant="destructive"`；`startIcon`→内容前放 `<Icon className="size-4" />` |
| Input | `@/components/ui/input` | MUI TextField（普通输入）→ Input，`type/value/onChange/placeholder` 直通 |
| Textarea | `@/components/ui/textarea` | 多行输入 |
| Label | `@/components/ui/label` | 表单标签 |
| Select | `@/components/ui/select` | shadcn 模式：`<Select value onValueChange><SelectTrigger className="w-[120px]"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="x">X</SelectContent></Select>`。MUI `<TextField select>`/`<Select>`+`<MenuItem>` 用它替换。注意 onValueChange 直接给 value 字符串 |
| Dialog | `@/components/ui/dialog` | `Dialog/DialogTrigger/DialogContent/DialogHeader/DialogTitle/DialogDescription/DialogFooter/DialogClose`。受控：`<Dialog open={x} onOpenChange={(v)=>!v&&close()}>`；MUI `onClose={()=>setOpen(false)}`→`onOpenChange`。宽度：DialogContent 默认 max-w-lg，可用 `className="sm:max-w-[600px]"` 调整 |
| AlertDialog | `@/components/ui/alert-dialog` | 强确认场景（删除等）可用，一般确认用 Dialog |
| DropdownMenu | `@/components/ui/dropdown-menu` | MUI `<Menu>`+`<MenuItem>` → `DropdownMenu`+`DropdownMenuTrigger`+`DropdownMenuContent`+`DropdownMenuItem onClick` |
| Tabs | `@/components/ui/tabs` | `<Tabs value onValueChange><TabsList><TabsTrigger value>`，内容用 `<TabsContent value>`；若原代码手动控制显隐，可保留原逻辑、仅把 Tab 头换成 TabsTrigger+TabsList（value 对齐即可） |
| Badge | `@/components/ui/badge` | MUI Chip → Badge；`variant: default/secondary/destructive/success/warning/info/outline`。success→success，warning→warning，error→destructive，info→info，default→secondary |
| Tooltip | `@/components/ui/tooltip` | `<Tooltip><TooltipTrigger asChild>{原元素}</TooltipTrigger><TooltipContent>{title 文本}</TooltipContent></Tooltip>`。**必须 asChild** 且触发元素要能接收 ref（div/按钮等原生元素或 forwardRef 组件）；TooltipProvider 已在 App 根部挂好，页面无需再包。MUI `placement="right"`→`side="right"` |
| Card | `@/components/ui/card` | Card/CardHeader/CardTitle/CardContent |
| Alert | `@/components/ui/alert` | `variant: default/info/success/warning/destructive`，配 `AlertTitle/AlertDescription` |
| Accordion | `@/components/ui/accordion` | `<Accordion type="single" collapsible>` |
| Switch/Checkbox/RadioGroup | 同路径 | Radix 模式，`checked onCheckedChange`（注意不是 onChange） |
| Progress | `@/components/ui/progress` | `value={0-100}` |
| Spinner | `@/components/ui/spinner` | 替代 CircularProgress；`<Spinner size={20} />` 或包在 flex 里居中 |
| Separator | `@/components/ui/separator` | 替代 Divider |
| Skeleton | `@/components/ui/skeleton` | 加载占位 |
| DataTable | `@/components/ui/data-table` | 替代 MUI DataGrid，**API 见下节** |
| toast | `@/components/ui/sonner` | `import { toast } from '@/components/ui/sonner'`，见下节 |

## 图标：`@mui/icons-material` → `lucide-react`

```jsx
import { Search, RefreshCw } from 'lucide-react'
<Search className="size-4" />
```

映射表（含本次出现的全部图标）：

| MUI | lucide |
|---|---|
| House / Home | House |
| SystemUpdateAlt | RefreshCw |
| Remove | Minus |
| Close | X |
| CropSquare | Square |
| FilterNone | Copy |
| DarkMode | Moon |
| WbSunny | Sun |
| SmartToy | Bot |
| Add | Plus |
| AnnouncementOutlined | Megaphone |
| DriveFileMove | FolderInput |
| ExpandMore | ChevronDown |
| MoreVert | MoreVertical |
| Refresh | RefreshCw |
| Search | Search |
| HiveOutlined | Hexagon |
| AllOutOutlined | Network |
| LibraryBooksOutlined | Library |
| DescriptionOutlined | FileText |
| ApiOutlined | Plug |
| ManageSearchOutlined | TextSearch |
| MonitorHeartOutlined | HeartPulse |
| TaskAlt | CircleCheck |
| Favorite | Heart |
| BarChartOutlined | BarChart3 |
| AddAPhoto | Camera |
| AutoAwesomeMotionOutlined | LayoutGrid |
| SettingsSuggestOutlined | Settings2 |
| InfoOutlined | Info |

其他 MUI 图标：按语义就近选 lucide（lucide-react 里都有导出，不确定就选名字最接近的）。

## 消息提示：notistack → sonner

```jsx
// 旧
const { enqueueSnackbar } = useSnackbar()
enqueueSnackbar(msg, { variant: 'error' })
// 新
import { toast } from '@/components/ui/sonner'
toast.error(msg)
// variant 映射：success→toast.success, error→toast.error, info→toast.info, warning→toast.warning, default→toast(msg)
```

`closeSnackbar(key)` 场景基本只出现在 action 按钮，sonner 的 toast 会自动可关闭，直接删掉即可。带 action 的 toast：

```jsx
toast.success(msg, { duration: Infinity, action: { label: t`Download Now`, onClick: () => BrowserOpenURL(url) } })
```

> ⚠️ 注意：**版本更新类提示（Header 的"发现新版本/检查失败"）不使用 Infinity**，
> 统一用 `UPDATE_TOAST_DURATION = 5000`（5 秒后自动消失，对齐旧版 naive-ui notification 行为），
> 常量定义在 `Header.tsx` 顶部。普通错误提示用 sonner 默认 4 秒即可。

## DataGrid → DataTable

```jsx
import { DataTable } from '@/components/ui/data-table'

<DataTable
  columns={[
    { field: 'name', headerName: 'Name', width: 150, align: 'left',
      renderCell: ({ row, value }) => <Badge>{value}</Badge> }, // row 是原始行对象，value 是该行 field 的值
  ]}
  rows={rows}
  getRowId={(row) => row.id}          // 原来靠 dataGridId/id 的就传 getRowId
  pagination                           // 默认开启；原 pagination={false} 就传 false
  pageSize={25}                        // 可选，默认 25（不再有 100 上限限制）
  onRowClick={({ row }) => {}}         // 可选
  emptyMessage={t`No data`}            // 可选
/>
```

迁移要点：
- MUI `renderCell: (params) => ...` 中 `params.row` → 解构出的 `row`；`params.value` → `value`。
- `sortable: false` 保留；`flex: 1`/`width` 列宽→直接填 `width` 数字（px），flex 列给个大 width 或省略（表格自动布局）。
- 原 `sx` 样式（斑马纹、边框等）丢弃，DataTable 已内置 hover 与边框。
- 包着 DataGrid 且用来定高的 `<Box sx={{height:480}}>` 可以去掉（DataTable 默认 autoHeight 自然撑开）；确需固定高度滚动时给 DataTable 传 `className="max-h-[480px] overflow-y-auto"`。

## 布局/文本 MUI → Tailwind 对照

| MUI | Tailwind |
|---|---|
| `<Box sx={{...}}>` | `<div className="...">` |
| `<Stack spacing={2}>` | `<div className="flex flex-col gap-2">` |
| `<Stack direction="row" spacing={1} alignItems="center">` | `<div className="flex items-center gap-1">` |
| `<Typography variant="body2">` | `<p className="text-[13px]">`（body 默认 13px，多数场景直接 `<p>`/`<span>`） |
| `<Typography variant="h6">`/加粗标题 | `<div className="font-semibold">` 等 |
| `<Grid container spacing={2}>` | `<div className="grid grid-cols-2 gap-2">`（按列数） |
| `<Paper>` | `<div className="rounded-lg border bg-card">` |
| MUI 颜色 `primary/error/warning/success/info` | `text-primary / text-destructive / text-warning / text-success / text-info`（bg- 同理） |
| `sx={{ display:'flex', alignItems:'center', gap:1 }}` | `className="flex items-center gap-1"` |

调色板：`background/foreground/card/popover/primary/secondary/muted/accent/destructive/border/input/ring`，附加语义色 `success/warning/info`。用法 `bg-primary text-primary-foreground`、`text-muted-foreground` 等。

## 受控弹窗模式（最常见）

```jsx
// 旧：const [open, setOpen] = useState(false); <Dialog open={open} onClose={()=>setOpen(false)}>
// 新：
<Dialog open={open} onOpenChange={(v) => { if (!v) setOpen(false) }}>
  <DialogContent className="sm:max-w-[520px]">
    <DialogHeader><DialogTitle>{t`Title`}</DialogTitle></DialogHeader>
    {/* 内容 */}
    <DialogFooter>
      <Button variant="outline" onClick={() => setOpen(false)}>{t`Cancel`}</Button>
      <Button onClick={doThing}>{t`Confirm`}</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

注意：原来把 Button 放 `DialogActions`，现在放 `DialogFooter`。原 `fullWidth maxWidth="md"` → `className="sm:max-w-2xl"`（xl→`sm:max-w-2xl`、lg→`sm:max-w-3xl` 自行就近）。

## Alert 用法与 i18n msgid 检查（2026-09-29 补充，两个真实坑）

### 1. Alert 内放裸文本必须注意布局

`Alert` 默认块级流式布局，带 `[>svg]` 图标时才切两列 grid。因此：

```jsx
// ✅ 裸文本直接放（组件修复后可正常横排）
<Alert variant="info"><a>{t`Some tip`}</a></Alert>

// ✅ 或用 AlertDescription（内部网格对齐用法，Index.tsx 采用）
<Alert variant="warning"><AlertDescription>...</AlertDescription></Alert>
```

历史坑：曾把裸文本子元素放进 `grid-cols-[0_1fr]` 的 0 宽列，导致提示一字一行竖排、被撑到 689px 高（用户报"诊断页 tips 长度太大"）。已在 `ui/alert.tsx` 修复，勿改回默认 `grid`。

### 2. 新增 t`...` 文案后必须同步语言目录

生产构建会把 t 宏的 message 字段剥离，只留 msgid（源文本的 sha256 前 6 位 base64 哈希）；目录里没有对应 key 就直接渲染哈希（如 `plhHQt`）。

**现行工作流（2026-09-29 起，catalog 由 `lingui extract` 维护）**：

```bash
pnpm i18n:extract   # 扫源码生成/更新 src/locales/{locale}/messages.po… 实为 messages.json
```

- catalog 的 key **就是宏生成的哈希 msgid**（不是源文本），每条还带 `message`（英文原文）与 `origin`（引用位置），zh-CN 缺译时运行时回落到 message 显示英文，**不会**渲染哈希
- 跑完 extract 后按统计表补译 zh-CN 的空条目即可；`pnpm i18n:clean` 可顺手清掉已无引用的 obsolete 条目
- `lingui.config.ts` 用 `@lingui/format-json` 的 `style: 'lingui'`（CLI 5.x 不再支持字符串 `'json'`/`'lingui'`）
- **必须加 `--workers 1`**（package.json 脚本已内置）：`threads` 库的 worker 在本机 Node 22 上起不来，报 "Did not receive an init message from worker"
- 代码里**不要再写 `i18n._('字面量')`**（extract 抓不到这种调用，目录会缺词）；取词一律 `t\`...\``，动态 locale 下需要响应式时用 `useLingui()` 拿 `i18n` 做依赖（参考 Index.tsx 列头）
- 插值规则不变：`${identifier}` → `{identifier}`，`${a.b}` 成员表达式 → `{0}`
