# Vue → React 迁移约定（子代理必读）

> ⚠️ **历史文档（2026-09-28 的 Vue→React 阶段）**：产物当时是 `.jsx`。
> 2026-09-30 起前端已全量 TypeScript 化，源码为 `.tsx` / `.ts`，类型约定以
> **`MIGRATION.md` 的「TypeScript 约定」一节为准**。本文档保留作为 naive-ui→MUI 的语义映射参考。

把 `frontend-vue/src/components/*.vue` 迁移为 React 组件（现为 `frontend/src/components/*.tsx`）。
**只写文件，不要运行 pnpm / npm / vite / wails 任何命令。**

## 目标技术栈

| Vue 现状 | React 目标 |
|---|---|
| naive-ui 组件 | `@mui/material`（v6） |
| @vicons/material | `@mui/icons-material` |
| n-data-table | `@mui/x-data-grid` 的 `<DataGrid>` |
| vue-i18n `t('a.b', {x})` | `@lingui/macro` 的 `` t`...` ``（模板字符串形式） |
| useMessage / useNotification | `notistack` 的 `useSnackbar().enqueueSnackbar` |
| useDialog 确认框 | `../utils/feedback` 的 `useConfirm()` |
| mitt eventBus | **原样保留**（`../utils/eventBus`，事件名一字不改） |
| wailsjs 绑定 | **原样保留**（路径与 Vue 版相同） |

## 文件布局（与 Vue 版一致）

```
frontend/
├── wailsjs/                  ← 已生成的绑定 stub（main/App, config/AppConfig, service/ESService, system/Update, runtime）
└── src/
    ├── App.jsx  main.jsx  i18n.js  theme.js  style.css
    ├── assets/               ← 已拷贝（images/fonts/css）
    ├── utils/
    │   ├── eventBus.js       ← mitt，原样
    │   ├── common.js         ← openUrl/flattenObject/isValidJson/formatBytes/download_file/formatDate/formatTimestamp/formatMillis/formatMillisToDays/formatNumber/createCsvContent(参数改为 columns[].headerName/field)
    │   └── feedback.jsx      ← ConfirmProvider + useConfirm()
    ├── locales/{zh-CN,en}/messages.json   ← Lingui catalog
    └── components/*.jsx      ← 你的产出
```

## 组件写法模板

```jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Button, ... } from '@mui/material'
import { t } from '@lingui/macro'
import { useLingui } from '@lingui/react'          // 仅当需要响应语言切换重渲染时
import { useSnackbar } from 'notistack'
import { useConfirm } from '../utils/feedback'
import emitter from '../utils/eventBus'

export default function Xxx() {
  const { enqueueSnackbar } = useSnackbar()
  const confirm = useConfirm()
  const [data, setData] = useState([])          // ref → useState
  // computed → useMemo；watch → useEffect(+deps)；onMounted → useEffect(..., [])
  // v-model:value → value + onChange
}
```

## i18n 硬规则（最重要）

- 翻译目录 msgid = **Vue 版 en.json 里的英文文案原文**。写 `` t`...` `` 时必须先到
  `frontend-vue/src/locales/en.json` 里 grep 对应 key，**逐字符复制英文值**（含标点、占位符、大小写），
  否则中文/日文翻译不生效。
- 带参数：Lingui 的占位符来自 `${表达式}` 插值，**插值变量名必须与 en.json 占位符名一致**：
  ```jsx
  const count = rows.length          // 变量名 = en.json 里的占位符名 {count}
  t`${count} in total`               // en 值为 '{count} in total'
  const msg = err
  t`Save failed: ${msg}`             // en 值为 'Save failed: {msg}'
  const tag = resp.tag_name
  t`New version found: ${tag}`       // en 值为 'New version found: {tag}'
  ```
- 成员表达式插值先提为局部变量：`` t`Current cluster: [${node.name}]` `` ❌ →
  `const name = node.name;` `` t`Current cluster: [${name}]` `` ✅
- 纯 UI 新增文案（原项目没有 key 的）随意写英文即可（缺翻译时显示英文原文）。

## naive-ui → MUI 映射速查

| naive-ui | MUI |
|---|---|
| n-button (type=primary/error…) | Button (variant="contained"/"text", color=) |
| n-input | TextField |
| n-input-number | TextField type="number" |
| n-select | TextField select + MenuItem，或 native select |
| n-switch | Switch |
| n-checkbox | Checkbox |
| n-radio-group | RadioGroup + Radio |
| n-form/n-form-item | Box + Typography(label) + 控件；或 FormControl |
| n-modal | Dialog |
| n-popover/n-tooltip | Tooltip / Popover |
| n-tabs | Tabs + Tab + Box |
| n-tag | Chip |
| n-alert | Alert |
| n-spin | CircularProgress |
| n-empty | Box + Typography（"No data"） |
| n-pagination | DataGrid 自带分页；独立场景用 Pagination |
| n-flex | Stack（direction/spacing）或 Box + flex |
| n-data-table | `<DataGrid>`（见下） |

### DataGrid 迁移要点

- 列：`{ field, headerName, width|flex, minWidth, renderCell: (p) => JSX }`
- 行：必须有唯一 id；`getRowId={(row) => row.xxx}` 或映射时补 id
- vue 渲染函数 `render(row)` → `renderCell: (params) => ...`（`params.row` 即原 row）
- selection：`checkboxSelection`；`rowSelectionModel` + `onRowSelectionModelChange`
- 分页：`paginationMode="client"`（默认），`initialState={{ pagination: { paginationModel: { pageSize: 20 } } }}`
- 原列配置里的 `title` → `headerName`，`key` → `field`，`render(row)` → `renderCell`
- resizable/ellipsis 等增强忽略（DataGrid 自带列宽拖拽）

## 其他规则

- 事件总线事件名**完全不变**：`selectNode`、`changeTitleType`、`update_theme`、`menu_select`、
  `change_language`、`refreshXXX` 等以 Vue 源码为准。
- emitter.on 必须在 `useEffect` 里注册并在 cleanup 里 `emitter.off(handler)`。
- wailsjs 调用返回 Promise；错误处理与 Vue 版一致（很多方法返回 [result, err] 或直接 result，看 Vue 源码怎么用就怎么用）。
- jsoneditor：`const ref = useRef(null)` + useEffect 里 `new JSONEditor(ref.current, options)`，卸载时 `.destroy()`。
- ace/monaco 没有直接依赖；REST 页的编辑器沿用 jsoneditor。
- `<style scoped>` → 组件内 `sx={{...}}` 或文件内少量 `<style>` 标签（避免全局污染，用类名前缀）。
- import 路径：组件在 `src/components/` 下，wailsjs 是 `../../wailsjs/...`，utils 是 `../utils/...`，assets 是 `../assets/...`。
- 保持文件名：`Xxx.vue` → `Xxx.tsx`（默认导出组件）。
- JSX 里 `{/* 注释 */}`；类型按 `MIGRATION.md` 的 TypeScript 约定补（`tsconfig` 已开 `strict`）。
- Vue 源码里的业务逻辑（请求参数、错误处理、CSV 导出、事件联动）**一行都不要丢**。
