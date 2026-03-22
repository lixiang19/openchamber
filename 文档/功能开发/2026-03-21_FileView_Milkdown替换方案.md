# FileView Milkdown 替换方案

- 状态：草案
- 日期：2026-03-21
- Owner：AI 协作
- 目标版本/里程碑：FileView Markdown 编辑器升级

## 1. 背景与问题

- 背景：当前 FileView 已支持 Markdown 预览，但编辑态仍沿用通用 `CodeMirrorEditor`，Markdown 编辑体验与预览体验割裂。
- 现象/痛点：`packages/ui/src/components/views/FilesView.tsx:1724` 仅把 `.md/.markdown` 识别为可预览文本，`packages/ui/src/components/views/FilesView.tsx:2739` 仍统一渲染 `CodeMirrorEditor`，导致 Markdown 编辑缺少更强的结构化编辑能力。
- 成功定义：仅对 Markdown 文件在编辑模式切换到 Milkdown，保留现有读取、脏状态、自动保存、预览与非 Markdown 文件编辑行为不变。

## 2. 目标与非目标

- 目标：
  - 仅在 `FileView` 的 Markdown 编辑态接入 Milkdown。
  - 继续复用现有 `draftContent -> saveDraft -> files.writeFile` 的字符串保存链路。
  - 保持 Markdown 预览模式、HTML 预览、普通文本/代码文件的 CodeMirror 路径不变。
- 非目标：
  - 不替换非 Markdown 文件的编辑器。
  - 不在本期重做 FileView 的搜索、行号、行级评论挂件等 CodeMirror 专属能力到 Milkdown。
  - 不改动服务端 `/api/fs/write` 或文件协议。

## 3. 现状探索（Explorer）

- 入口与调用链：
  - `packages/ui/src/components/views/FilesView.tsx:43` - FileView 主入口引入 `CodeMirrorEditor`、`PreviewToggleButton`、`SimpleMarkdownRenderer`。
  - `packages/ui/src/components/views/FilesView.tsx:281` - `isMarkdownFile()` 目前只识别 `.md` / `.markdown`。
  - `packages/ui/src/components/views/FilesView.tsx:1723` - `canEdit`、`isMarkdown`、`isPreviewableText`、`previewContent` 在同一处决定编辑/预览分支。
  - `packages/ui/src/components/views/FilesView.tsx:2045` - `editorExtensions` 为 CodeMirror 动态注入主题、语言、换行和移动端行为。
  - `packages/ui/src/components/views/FilesView.tsx:2701` - 桌面文件区：Markdown 预览走 `SimpleMarkdownRenderer`，编辑态走 `CodeMirrorEditor`。
  - `packages/ui/src/components/views/FilesView.tsx:3244` - 移动端文件区也复用了相同分支。
- 关键数据结构/状态：
  - `packages/ui/src/components/views/FilesView.tsx:1206` - `isDirty` 直接比较 `draftContent` 与 `displayedContent`。
  - `packages/ui/src/components/views/FilesView.tsx:1208` - `saveDraft()` 直接把 `draftContent` 字符串写回文件。
  - `packages/ui/src/components/views/FilesView.tsx:1262` - 自动保存基于 `draftContent` debounce 1.5s。
  - `packages/ui/src/components/views/FilesView.tsx:1291` - 全局快捷键里 `Cmd/Ctrl+S` 立即保存，`Cmd/Ctrl+F` 打开 CodeMirror 搜索。
  - `packages/ui/src/components/ui/CodeMirrorEditor.tsx:19` - 现有编辑器 props 包含 `extensions`、`blockWidgets`、`enableSearch`、`highlightLines` 等 CodeMirror 专属能力。
  - `packages/web/src/api/files.ts:126` - `writeFile()` 仍是纯文本写入 API，无需为 Milkdown 新增后端契约。
- 约束与坑点：
  - Markdown 编辑器必须以字符串 Markdown 为单一事实来源，否则现有脏状态、自动保存会失效。
  - `MAX_VIEW_CHARS` 限制在 `packages/ui/src/components/views/FilesView.tsx:275`，超大文件当前不可编辑，Markdown 路径也应继续遵守。
  - 工具栏的查找按钮和 `Cmd/Ctrl+F` 目前绑定 CodeMirror 搜索；若 Markdown 改成 Milkdown，需显式禁用或改为编辑器内方案，不能留“假可用”入口。
  - Markdown 预览仍由 `SimpleMarkdownRenderer` 承担，编辑态与预览态渲染库不同，需保证切换时内容一致。

## 4. 资料与依据（Librarian）

- 关键结论：
  - Milkdown 是 Markdown-first 的 ProseMirror/Remark 方案，Markdown 往返可靠性优于 TipTap、Lexical 这一类富文本优先框架，更适合文件型 `.md` 编辑。
  - TipTap 虽然 React 集成更成熟，但 Markdown 不是核心能力；对 FileView 这种“直接读写 Markdown 文件”的场景，Milkdown 更符合主诉求。
  - `@uiw/react-md-editor` 更轻，但能力上不是“更厉害”的升级；BlockNote/MDXEditor 更偏块编辑或内容平台，不适合保持本地 Markdown 文件语义。
  - Milkdown 接入时建议使用 React 绑定并把外层状态保持为 Markdown 字符串，而不是把 ProseMirror JSON 当作持久化格式。

## 5. 方案概览（主方案）

### 5.1 方案摘要

- 一句话：新增 `MilkdownMarkdownEditor` 包装组件，仅在 `FileView` 的 Markdown 编辑态替换 `CodeMirrorEditor`，继续让 `draftContent` 作为唯一保存源。
- 取舍：优先满足“只换 Markdown”与“最小影响面”，不把 CodeMirror 的全部能力强行搬到 Milkdown；对 Markdown 编辑态暂时关闭 CodeMirror 专属搜索入口，减少伪兼容。
- 影响面：`packages/ui/src/components/views/FilesView.tsx` 的条件分支与工具栏，新增一个 Markdown 编辑器包装组件，补充 `packages/ui/package.json` 依赖。

### 5.2 风险与回滚

- 风险：
  - Milkdown React 集成与现有布局高度、焦点、移动端键盘避让可能存在适配成本：先做独立包装组件，把高度/滚动/主题边界封在组件内。
  - Markdown 序列化若与初始字符串不完全一致，可能导致频繁脏状态：以“初始化即用原始 Markdown、编辑变更后再回写字符串”为准，重点验证空文档、Frontmatter、任务列表、代码块。
  - `Cmd/Ctrl+F` 当前全局拦截会错误打开 CodeMirror 搜索：在 Markdown 编辑态下改为 no-op 或后续接 Milkdown 内部查找，不保留无效按钮。
- 回滚：
  - 保留 FileView 原有 CodeMirror 分支，Markdown 分支单独条件切换；若 Milkdown 表现不稳定，移除 Markdown 分支即可回到当前实现。

## 6. 详细设计（Spec）

### 6.1 交互/行为（如适用）

- 用户流程：打开 `.md` 文件 -> 默认仍可在预览/编辑之间切换 -> 编辑态进入 Milkdown -> 修改内容触发 `draftContent` 更新 -> 现有自动保存和 `Cmd/Ctrl+S` 保存继续生效。
- 边界条件：
  - 大于 `MAX_VIEW_CHARS` 的 Markdown 文件继续不可编辑，保持现有降级行为。
  - 预览模式仍使用 `SimpleMarkdownRenderer`，不切到 Milkdown 的只读模式，避免一套库兼顾两种职责。
  - `.mdx` 暂不纳入首期，除非同步扩展 `isMarkdownFile()` 与渲染能力评估。
  - Markdown 编辑态下隐藏或禁用“查找”按钮，避免调用 CodeMirror 搜索面板。

### 6.2 接口与契约

- API/函数签名：
  - `MilkdownMarkdownEditor`：`value: string` -> `onChange(markdown: string)`。
  - `FilesView`：根据 `isMarkdown && getPreviewMode() !== 'preview'` 走 Markdown 专用编辑分支，其余分支不变。
  - `saveDraft()`：保持 `selectedFile.path + draftContent` 写入，不变更入参/出参。
- 错误码/异常：
  - Milkdown 初始化失败时不吞错，交给 `ErrorBoundary` 或明确 UI 错误提示，避免静默回退到错误状态。

### 6.3 数据与存储（如适用）

- Schema/字段：
  - 无新增后端数据结构；持久化内容仍是 Markdown 字符串。
  - 本地 `previewMode` 的 `localStorage` 规则保持不变。
- 迁移策略：
  - 无数据迁移；只替换编辑态渲染组件。

### 6.4 兼容性与发布

- 兼容策略：非 Markdown 文件、Markdown 预览态、HTML 预览态保持原样；Markdown 编辑态新旧切换只发生在前端分支。
- 发布步骤：
  - 先引入依赖与包装组件。
  - 再改 `FilesView` 分支与工具栏条件。
  - 最后跑类型检查、lint、build 做回归验证。

### 6.5 可观测性

- 日志：仅在开发期保留必要的初始化错误日志，不新增冗余运行时埋点。
- 指标：无新增业务指标，重点靠手动回归验证编辑/保存/切换链路。
- 告警：无。

## 7. 验收标准（必须可验证）

- 功能验收：
  - [ ] 打开 `.md` / `.markdown` 文件时，编辑模式显示 Milkdown，预览模式仍显示当前 Markdown 预览。
  - [ ] 修改 Markdown 内容后，`draftContent` 正常更新，1.5 秒自动保存与 `Cmd/Ctrl+S` 立即保存都能写回文件。
  - [ ] 切换到其他文件类型时继续使用现有 `CodeMirrorEditor` / Shiki / 图片 / HTML 预览分支，无行为回归。
  - [ ] Markdown 编辑态不会再展示失效的 CodeMirror 搜索入口，`Cmd/Ctrl+F` 不触发错误 UI。
  - [ ] Frontmatter、标题、列表、任务列表、表格、代码块的编辑后保存内容可再次正确预览。
- 非功能验收：
  - [ ] 性能：普通大小 Markdown 文件首次进入编辑态无明显卡顿，切换文件不引入长时间白屏。
  - [ ] 可靠性：初始化失败时有明确报错或边界保护，不出现无响应空白区域。
  - [ ] 安全：不新增 HTML 直出或新的文件写入路径，继续复用现有 `/api/fs/write`。

## 8. 里程碑与任务（Milestones）

> 原则：只拆 1-3 个里程碑；每个里程碑都必须有可验证的交付物与退出标准。里程碑内再列任务，但不要过度细碎。

### M1：接入 Milkdown 基础编辑链路

- 交付物：Markdown 专用编辑器包装组件 + FileView 条件接线。
- 退出标准：`.md` 文件编辑态已切到 Milkdown，修改内容可驱动 `draftContent`。
- 任务：
  - [ ] 新增 Markdown 编辑器包装组件（文件/模块：`packages/ui/src/components/ui/*`）验收：组件仅暴露字符串 `value/onChange` 契约。
  - [ ] 引入 Milkdown 依赖并完成最小初始化（文件/模块：`packages/ui/package.json`、新组件）验收：类型检查通过，编辑器可渲染。
  - [ ] 在 `FilesView` 中仅为 Markdown 编辑态接入新组件（文件/模块：`packages/ui/src/components/views/FilesView.tsx`）验收：非 Markdown 分支不变。

### M2：补齐 FileView 交互与兼容细节

- 交付物：工具栏/快捷键/错误边界与 Markdown 分支行为一致。
- 退出标准：预览切换、保存、快捷键、移动端/桌面布局均可用，且无失效入口。
- 任务：
  - [ ] 调整工具栏对 Markdown 编辑态的按钮显示（文件/模块：`packages/ui/src/components/views/FilesView.tsx`）验收：不再暴露失效搜索按钮。
  - [ ] 校正全局快捷键与 Markdown 编辑态兼容性（文件/模块：`packages/ui/src/components/views/FilesView.tsx`）验收：`Cmd/Ctrl+S` 可用，`Cmd/Ctrl+F` 不报错。
  - [ ] 为 Milkdown 初始化/渲染增加边界处理（文件/模块：新组件或 `FilesView`）验收：异常时有明确提示。

### M3：回归验证与收尾

- 交付物：通过类型检查、lint、build 的可交付改动。
- 退出标准：验收标准全部勾选，主流程回归完成。
- 任务：
  - [ ] 手动回归 Markdown 编辑/预览/保存/切文件（文件/模块：FileView）验收：主流程通过。
  - [ ] 执行 `bun run type-check`、`bun run lint`、`bun run build`（文件/模块：仓库级）验收：命令全部成功。

## 9. 执行计划与闭环

- 执行顺序：M1 -> M2 -> M3
- 每个里程碑验证：
  - M1：本地打开 Markdown 文件，验证编辑器渲染、内容变更与 `draftContent` 同步。
  - M2：验证预览切换、自动保存、快捷键、桌面/移动端布局、错误提示。
  - M3：运行 `bun run type-check`、`bun run lint`、`bun run build`。
- 最终回报：变更摘要 + 验收勾选 + 风险残留 + 下一步
