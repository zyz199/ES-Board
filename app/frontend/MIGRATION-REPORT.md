# ES-King 前端迁移报告：Vue 3 → React 18（Wails 后端不动）

日期：2026-09-28 ｜ 构建：`pnpm build` ✅ 通过（vite 7.3.6，dist 2.6MB / gzip 747KB）

## 技术栈

| 层 | 旧 | 新 |
|---|---|---|
| 包管理 | npm | **pnpm 10.2.1**（`packageManager` 已锁） |
| 框架 | Vue 3.5 | **React 18.3**（hooks + JSX） |
| UI | naive-ui + @vicons | **MUI 6.5 + @mui/icons-material + @mui/x-data-grid 7** |
| i18n | vue-i18n | **Lingui 5.9**（msgid = en.json 英文原文，catalog 见 `src/locales/{locale}/messages.json`） |
| 提示 | naive provider | **notistack 3** + 自建 `useConfirm`（utils/feedback.jsx） |
| 构建 | vite 7 (plugin-vue) | vite 7 (**plugin-react 5** + `@lingui/babel-plugin-lingui-macro` + @lingui/vite-plugin) |
| 保留 | mitt / jsoneditor / ace-builds / highlight.js / wailsjs 绑定 | 原样 |

## 目录

- `frontend/` 新 React 前端（`pnpm install && pnpm dev|build`；Node ≥ 22.12，nvm 有 v22.23.3）
- `frontend-vue/` 旧 Vue 前端完整备份（对照参考）
- `gen_wailsjs.py` 本机无 Go/wails CLI，脚本解析 Go 源码生成 `frontend/wailsjs/` 绑定 stub（AppConfig 10 / ESService 66 / Update 3 / App 2 / runtime 51）
- `gen_lingui_catalogs.py` vue-i18n JSON → Lingui catalog 转换脚本（426 条 × 3 语言）

## 组件迁移（16 个文件全部完成）

App 壳（主题/I18n/notistack/ConfirmProvider/侧边菜单 + **display 切换实现 keep-alive**：首次访问后常驻）、Header（窗口控制/更新检查）、Aside（图标菜单）为主代理手写；
Conn、Nodes、Index、Docs、Rest、Analyze、Diag、Task、Health、Core、Snapshot、Templates、Settings、About 由子代理并行迁移，业务逻辑（查询 DSL、批量导入 CSV/JSON、reindex、快照/SLM/ILM、诊断等）一行未丢，emitter 事件名与 wailsjs 调用逐字保留。

## 构建期踩坑（已全部解决）

1. `||` 与 `??` 混用需加括号（Docs.jsx 两处）
2. `@lingui/vite-plugin` 不编译宏 → 需在 plugin-react 的 `babel.plugins` 加 `@lingui/babel-plugin-lingui-macro`
3. `lingui.config.js` 必须存在（format: json, sourceLocale: en）
4. assets 拷贝时 `cp -R` 嵌套了一层（已修复）
5. pnpm 安装被 WorkBuddy 沙箱拦截 → 前台 + 非沙箱执行（见 workbuddy-sandbox-pitfalls skill）
6. Rest.jsx 直接 import ace-builds → 依赖已补回 1.4.12（与 jsoneditor 内置 ace 版本匹配）

## 已知边界 / 后续

- **端到端运行需要 Go 工具链**：`wails dev` / `wails build` 本机暂不可用（无 go、无 wails CLI）。
  建议安装后先跑 `wails doctor`，再 `wails dev` 验证界面与绑定真机调用。
  装好 wails CLI 后可用官方 `wails generate module` 重新生成绑定，替换脚本产物即可（目录结构一致）。
- wails.json 已改为 pnpm 命令。
- naive-ui 的 tab 切换动画未复刻（MUI Tabs 无内置）；Conn 导出确认框由三按钮 naive dialog 改为局部 MUI Dialog 三按钮，逻辑不变。
- 已知未翻译：Snapshot 的 5 个表单 label 原版就是硬编码中文（无 locale key），React 版按约定显示英文。

---

## 后续演进（本文档之后发生，仅作索引）

| 日期 | 变更 | 详见 |
|---|---|---|
| 2026-09-29 | UI 层 MUI → shadcn/ui（Radix + Tailwind v4），React 升 19；i18n 目录改由 `lingui extract` 维护 | `MIGRATION.md` |
| 2026-09-30 | 下线 ja，只保留 zh-CN / en | `MIGRATION.md` i18n 一节 |
| 2026-09-30 | 单测统一收口到 `test/`（镜像 src 结构） | `vitest.config.ts` |
| 2026-09-30 | 全量 JS → **TypeScript**（strict），源码 `.tsx`/`.ts`；配置文件也改 `.ts` | `MIGRATION.md`「TypeScript 约定」 |

