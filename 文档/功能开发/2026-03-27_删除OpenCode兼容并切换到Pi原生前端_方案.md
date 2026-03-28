# 删除OpenCode兼容并切换到Pi原生前端 方案

- 状态：草案
- 日期：2026-03-27
- Owner：Codex / OpenChamber 前端重构
- 目标版本/里程碑：Pi 原生前端第一阶段

## 0. 当前进度更新（2026-03-28）

- 已完成：`QuestionCard` 已完全切到 `interactiveRequests`，旧 `questionStore` 与 `QuestionRequest` 类型已删除。
- 已完成：服务端 `Pi -> OpenCode-shaped payload` 主投影层已删除，`packages/web/server/lib/pi/runtime.js` 不再存在。
- 已完成：`useSessionStore` / `sessionStore` 已开始持有 `piSessions`，聊天主视图、时间线、上下文侧栏、语音相关入口已优先围绕 Pi snapshot 读取。
- 已完成：`messageStore` 内部关键读取路径（历史加载、stream 补全、消息强制完成、同步与上下文计算桥接）已优先从 `piSessions` 回投影，不再默认把旧 `messages` 缓存当唯一真相。
- 已完成：`useEventStream` 不再把所有 Pi session 全量灌入 `messageStore.messages`，只同步已有缓存的会话；`contextStore` 缺消息时会直接回看 `piSessions`。
- 已完成：语音上下文、浏览器语音回复跟踪、时间线用户消息、输入框用户历史、内存面板统计、子任务 in-flight 工具判断等入口已开始直接读取 Pi 原生 messages / toolExecutions / workingMessage。
- 已完成：`useAssistantStatus` 已改为直接围绕 Pi assistant content blocks 与 `toolExecutions` 推导状态；`ContextSidebarTab` 的原始消息面板与主要统计已改为直接读取 Pi 原生 messages / usage。
- 已完成：前端消息适配已从 `runtime/projections.ts` 剥离到 `packages/ui/src/lib/pi/uiMessageProjection.ts`；`runtime/projections.ts` 现在只保留 session/status 投影，不再承担旧 runtime message 投影职责。
- 已完成：`ChatContainer` 不再直接持有消息投影逻辑，旧 `info + parts[]` 适配边界已继续下沉到 `useCurrentUiMessages`、`useChatScrollManager`、`useChatTimelineController` 等更窄的聊天渲染 hook。
- 已完成：`turns` 链路已开始接入 `PiSessionViewState`，`projectTurnSummary` 优先直接读取 Pi assistant 原生文本块，turn stream state 也开始优先参考 Pi assistant stopReason/timestamp。
- 已完成：`ChatMessage` 的 provider/model/finish/completed/error/agent 等 header 相关元信息，已开始优先读取原始 Pi message，而不是仅依赖旧 `info` 投影字段。
- 已完成：`contextStore` 缺消息时不再回退到 runtime message projection，而是直接基于 Pi session 构造最小分析输入；`useSessionStore` 的 assistant 创建会话、undo/redo/fork 等高层动作也已优先围绕 Pi 原生 messages 工作。
- 已完成：会话创建与标题更新不再走 `runtimeClient.createSession()` / `runtimeClient.updateSession()`，而是直接走 `piClient`。
- 进行中：消息 UI 仍通过前端专用的 `uiMessageProjection` 派生旧 `info + parts[]` 结构，`messageStore` 仍承担历史缓存与流式局部变更职责，但其读路径已退居 Pi snapshot 之后；当前主要剩余是 `MessageList/ChatMessage/MessageBody` 主消息渲染边界，以及 `messageStore` 内部局部流式过渡状态。
- 保持不变：`permission` 本轮冻结实现，不删 UI、不降级体验；后续按现有 Permission UI 反向设计 Pi-native permission 协议。

## 1. 背景与问题

- 背景：项目已经开始切换到底层 Pi SDK，但前端主状态树、服务端 SSE 投影、runtime facade 仍深度保留 OpenCode 语义与结构。
- 现象/痛点：同一份 Pi 原生状态被重复投影成旧 `Session / Message / Part / Question / Permission` 结构，导致 question、permission、tool、status 的真实状态入口分裂；后续每改一处 Pi 能力都要同时维护旧兼容层。
- 成功定义：前端保留现有全部 UI 与交互能力，但彻底删除 `Pi -> OpenCode-shaped payload` 与 `Pi -> 旧 runtime facade` 兼容层，改为直接消费 Pi-native 多事件状态模型。

## 2. 目标与非目标

- 目标：
  - 删除服务端 `Pi -> OpenCode` SSE / message 投影层，统一走 Pi SSE。
  - 删除前端对旧 `Session / Message / Part / Question / Permission` 兼容模型的长期依赖。
  - 保留现有 UI 页面、卡片、消息表现、侧栏、通知、权限与问题入口，不删功能，只改字段和状态来源。
  - 把“UI 对不上”的问题集中登记到 `文档/功能开发/2026-03-27_前端Pi原生化对不上清单.md`，执行中严格对照。
- 非目标：
  - 不重做视觉设计。
  - 不删除任何现有 UI 能力边界。
  - 不为迁移速度保留长期 OpenCode 兼容桥。
  - 不在本轮解决与前端原生化无关的历史杂项。

## 3. 现状探索（Explorer）

- 入口与调用链：
  - `packages/ui/src/lib/pi/client.ts:89` - 前端已经直接订阅 `/api/pi/events`，说明 SSE 通道本身已具备 Pi-native 基础。
  - `packages/ui/src/lib/pi/reducer.ts:496` - `applyUiEvent()` 直接处理 `interactiveRequests / statusEntries / widgets`。
  - `packages/ui/src/lib/pi/reducer.ts:554` - `applyPiEvent()` 直接处理消息与工具事件。
  - `packages/ui/src/hooks/useEventStream.ts:25` - `projectPiStateToStores()` 把 Pi-native state 再投影回旧 stores，是当前前端兼容层核心入口。
  - `packages/web/server/lib/pi/sdk-host.js:567` - 服务端 host 已直接订阅 Pi session 事件，但仍先经过 `normalizePiRpcEnvelope()`。
- 关键数据结构/状态：
  - `packages/ui/src/lib/pi/types.ts:142` - `toolExecutions` 已是一等状态。
  - `packages/ui/src/lib/pi/types.ts:143` - `interactiveRequests` 已是一等状态。
  - `packages/ui/src/lib/pi/types.ts:144` - `statusEntries` 已是一等状态。
  - `packages/ui/src/lib/pi/types.ts:145` - `widgets` 已是一等状态。
  - `packages/ui/src/hooks/useEventStream.ts:97` - question 已开始直接并入 `interactiveRequests`，但消息主链路仍未完全脱离旧 runtime projection。
  - `packages/ui/src/stores/permissionStore.ts:15` - permission 仍被单独维护为旧 `PermissionRequest` store。
  - `packages/ui/src/lib/runtime/projections.ts:200` - 仍在生成旧 `info + parts[]` 消息结构。
  - `packages/web/server/lib/pi/runtime.js:426` - 仍在生成 OpenCode-shaped message records。
- 约束与坑点：
  - 现有 UI 功能不能删，只能替换字段与状态来源。
  - permission UI 当前仍依赖旧 `/permission/list`、`/permission/reply` 链路，不能靠“暂时移除”绕过。
  - `packages/ui/src/components/mobile/MobileChatShell.tsx` 当前存在无关语法错误，会阻断全量 `packages/ui` type-check；本方案不能以该错误为由继续保留兼容层。
  - `packages/web/server/index.js:5314` 仍按 `question.asked` / `permission.asked` 风格发送通知，属于服务端残留兼容点。

## 4. 资料与依据（Librarian）

- 关键结论：
  - Pi 官方事件不是单一 message 流，而是统一的 typed protocol + 多事件家族：`agent_start/agent_end`、`turn_start/turn_end`、`message_start/message_update/message_end`、`tool_execution_*` 等，依据 `pi的相关资料/pi-mono-main/packages/coding-agent/docs/json.md:14`、`pi的相关资料/pi-mono-main/packages/coding-agent/docs/rpc.md:723`。
  - `message_update` 自带 `assistantMessageEvent` 流式 delta 子类型（`text_delta`、`thinking_delta`、`toolcall_delta` 等），依据 `pi的相关资料/pi-mono-main/packages/coding-agent/docs/rpc.md:778`。
  - 扩展 UI 请求在官方模型中是独立的 `extension_ui_request` 子协议，不属于普通 message 事件，依据 `pi的相关资料/pi-mono-main/packages/coding-agent/src/modes/rpc/rpc-types.ts:211`、`pi的相关资料/pi-mono-main/packages/coding-agent/docs/rpc.md:946`。
  - Pi 的会话消息 role 本身也是联合类型，除 `user/assistant/toolResult` 外还包括 `bashExecution`、`branchSummary`、`compactionSummary`，依据 `pi的相关资料/pi-mono-main/packages/coding-agent/docs/session.md:123`、`pi的相关资料/pi-mono-main/packages/coding-agent/docs/session.md:144`、`pi的相关资料/pi-mono-main/packages/coding-agent/docs/session.md:151`。
  - 因此正确方向不是“把所有内容塞回一种旧事件”，而是让前端直接消费 Pi-native 多事件状态模型。

## 5. 方案概览（主方案）

### 5.1 方案摘要

- 一句话：删除所有 `Pi -> OpenCode` 投影层，保留现有 UI 不变，把前端状态主链路改为 `Pi SSE -> Pi reducer/store -> 现有 UI 组件`。
- 取舍：这会导致前端字段、store、selector、通知入口大改，但能从根上结束“改一处 Pi 还要同步维护旧 OpenCode 兼容层”的结构性问题。
- 影响面：`packages/web/server/lib/pi/*.js`、`packages/ui/src/lib/pi/*`、`packages/ui/src/hooks/useEventStream.ts`、聊天相关 stores 与消息渲染层、通知入口、question/permission 状态入口。

### 5.2 风险与回滚

- 风险：
  - permission UI 当前没有完整 Pi-native request 协议：通过单列“对不上清单”并将其作为独立里程碑对齐项，禁止借机删除 PermissionCard。
  - 聊天消息 UI 与 Tool UI 目前大量依赖 `info + parts[]`：通过“先平移字段入口、后删除投影函数”的两步法缓冲一次性重写风险。
  - 通知、会话列表、历史操作可能还偷偷依赖旧事件名：通过全仓搜索与分批替换控制范围。
- 回滚：
  - 不做运行时兼容开关。
  - 若某个里程碑失败，仅通过 Git 提交粒度回退该里程碑，不保留双轨兼容实现。

## 6. 详细设计（Spec）

### 6.1 交互/行为（如适用）

- 用户流程：
  - 会话列表、消息列表、QuestionCard、PermissionCard、StatusRow、Tool UI、通知入口都继续保留现有视觉和交互。
  - 用户对 question 的提交/拒绝，仍通过统一 Pi SSE 主链路反馈到前端状态树，而不是本地删卡片式短路。
  - permission 交互继续保留当前卡片与通知体验，但**本轮不改 permission 实现**；后续以现有 Permission UI 为准，反向设计 Pi-native permission request 协议，而不是继续沿用旧 `/permission/list` 轮询语义。
- 边界条件：
  - 当前 Pi 原生没有与现有 Permission UI 对齐的细粒度 permission ask，本轮先冻结 Permission UI 与旧链路，不删除、不降级、不误改；后续单独按 UI 反向实现 Pi-native permission event/request。
  - 对于当前确实没有底层支持但 UI 必须保留的项，统一记录进 `文档/功能开发/2026-03-27_前端Pi原生化对不上清单.md`，作为执行边界，不允许静默删除。

### 6.2 接口与契约

- API/函数签名：
  - `piClient.subscribe(sessionId?, onEvent)`：继续保留，但前端只消费 `PiServerEvent`，不再中转成旧 runtime event。
  - `piClient.listSessions()` / `getSession()`：返回 `PiSessionViewState`，前端直接入 Pi reducer/store。
  - `runtimeClient`：从“旧 runtime facade”收缩为项目层 mutation API；会话创建/更新与旧 message 读取 facade 已继续切走，剩余 mutation 能力继续收缩，最终不再承担旧 `Session/Message/Part` 主读模型。
  - `QuestionCard`：已切换为直接消费 Pi-native interactive request 字段，后续重点转向消息/工具主链路。
  - `PermissionCard`：本轮保持现有输入与表现不变；后续单列里程碑按现有 UI 反向定义 Pi-native permission request。
- 错误码/异常：
  - Web host 对 `ctx.ui.input/select/confirm/editor` 继续明确报错，调用方必须改用自定义 `question` 工具。
  - 前端 reducer 遇到未知 Pi 事件时保留日志，不再试图翻译成旧事件名。

### 6.3 数据与存储（如适用）

- Schema/字段：
  - 统一前端运行时状态源：`PiSessionViewState`、`PiMessageViewState`、`PiToolExecutionViewState`、`PiInteractiveRequestViewState`、`PiStatusEntry`、`PiWidgetEntry`。
  - 聊天消息 UI 保留现有组件，但输入字段由旧 `Message + Part` 改为 Pi-native selector 派生。
  - `questions` 旧 Map store 已退场，统一改为从 Pi-native interactive request selector 派生。
  - `permissions` 旧 Map store 本轮保留，等待后续按现有 Permission UI 反向定义 Pi-native permission 协议后再退场。
- 迁移策略：
  - 不做协议兼容迁移。
  - 先新增 Pi-native selector 与 adapter，替换 UI 读取入口；等 UI 完成切换后删除旧投影函数与旧 store。
  - “对不上清单”作为迁移过程中的唯一例外登记处，不在代码里保留兼容桥。

### 6.4 兼容性与发布

- 兼容策略：不做 OpenCode 向后兼容；前后端统一切换到 Pi-native 协议与状态模型。
- 发布步骤：
  - 先落地规划文档与对不上清单。
  - 再按里程碑分批替换前端状态入口。
  - 每个里程碑完成后删除对应旧桥接代码，不允许“先新后旧长期并存”。

### 6.5 可观测性

- 日志：
  - Pi SSE 订阅失败日志
  - 未知 Pi 事件日志
  - question / permission 响应失败日志
  - 通知触发与忽略日志
- 指标：
  - 当前会话是否存在 active assistant message
  - interactive requests 数量
  - permission requests 数量
  - tool execution running 数量
- 告警：
  - SSE 连接异常重连失败
  - question / permission request 长时间 unresolved
  - Pi-native reducer 出现未知 payload 占比异常

## 7. 验收标准（必须可验证）

- 功能验收：
  - [ ] 消息列表、Tool UI、QuestionCard、PermissionCard、StatusRow、通知入口全部保留，用户可见功能无删除。
  - [ ] 前端主链路不再依赖 `message.updated`、`message.part.updated`、`question.asked`、`permission.asked` 等 OpenCode 事件名。
  - [x] 服务端不再生成 `Pi -> OpenCode-shaped payload` 作为 Web 主消费协议。
  - [x] QuestionCard 通过统一 Pi SSE 主链路收敛与关闭。
  - [ ] PermissionCard 保留，本轮实现不退化；并在文档中明确记录“后续按现有 UI 反向实现 Pi-native permission 协议”的待办边界。
  - [ ] 所有“对不上但不能删”的能力都登记在 `文档/功能开发/2026-03-27_前端Pi原生化对不上清单.md`。
- 非功能验收：
  - [ ] 性能：消息流式渲染与当前体验持平，不引入显著滚动卡顿。
  - [ ] 可靠性：SSE 中断后能通过 session snapshot + event replay 恢复当前 Pi-native 状态。
  - [ ] 安全：permission 流程不因删除 OpenCode 兼容而绕过现有策略校验。

## 8. 里程碑与任务（Milestones）

> 原则：只拆 1-3 个里程碑；每个里程碑都必须有可验证的交付物与退出标准。里程碑内再列任务，但不要过度细碎。

### M1：冻结兼容边界，建立 Pi-native 主状态入口

- 交付物：规划文档、对不上清单、Pi-native 前端主状态入口定义、旧桥接边界清单。
- 退出标准：团队对“保留 UI、删除 OpenCode 兼容、Question/Permission 不删但改协议”的边界没有歧义。
- 任务：
  - [ ] 固化方案文档与对不上清单（文件/模块：`文档/功能开发/2026-03-27_删除OpenCode兼容并切换到Pi原生前端_方案.md`、`文档/功能开发/2026-03-27_前端Pi原生化对不上清单.md`）验收：文档明确 UI 不删、OpenCode 兼容删除、对不上单独登记。
  - [ ] 盘点旧桥接代码（文件/模块：`packages/web/server/lib/pi/runtime.js`、`packages/ui/src/lib/runtime/projections.ts`、`packages/ui/src/hooks/useEventStream.ts`）验收：明确删除顺序与替代状态入口。

### M2：前端聊天主链路切到 Pi-native 状态模型

- 交付物：会话、消息、工具、question、status 直接消费 Pi-native state 的聊天主链路。
- 退出标准：聊天主视图不再依赖 `projectPiSessionToRuntimeMessages()` / 旧 `Session/Message/Part` 主模型；QuestionCard 直接来自 Pi-native interactive requests。
- 当前进度：当前会话相关高频入口、会话创建/标题更新、会话预取判定已切到 `piSessions`；`MessageList` 已开始把 `piSession` 直接下传给 `ChatMessage`，但消息渲染结构本身仍待从旧 `info + parts[]` 派生模型继续下沉。
- 任务：
  - [ ] 改写 `useEventStream` 与相关 store（文件/模块：`packages/ui/src/hooks/useEventStream.ts`、`packages/ui/src/lib/pi/reducer.ts`、聊天相关 stores）验收：Pi state 直接进入前端状态树，不再投影成旧 stores 主模型。当前进度：question 已切到 `interactiveRequests`，消息/工具仍在迁移。
  - [ ] 改写消息/工具/问题 UI 输入字段（文件/模块：`packages/ui/src/components/chat/**`）验收：外观保留，字段来源改为 Pi-native selectors。
  - [ ] 删除消息与问题的旧投影函数（文件/模块：`packages/ui/src/lib/runtime/projections.ts`）验收：聊天主链路不再依赖旧 `Message + Part` / `QuestionRequest` 投影函数。当前进度：`QuestionRequest` 投影已删除，消息投影仍在使用。

### M3：删除服务端 OpenCode 事件投影，处理通知残留

- 交付物：服务端仅输出 Pi-native SSE；通知入口不再依赖 OpenCode 事件命名；permission 待对齐边界单列保留。
- 退出标准：`packages/web/server/lib/pi/runtime.js` 的 OpenCode-shaped payload 主职责删除；question 与通知走 Pi-native 事件/状态模型；permission 仍可用且被明确登记为后续单独对齐项。
- 任务：
  - [x] 删除服务端 `Pi -> OpenCode-shaped payload`（文件/模块：`packages/web/server/lib/pi/runtime.js`、`packages/web/server/lib/pi/index.js`）验收：Web 主链路不再消费 `translatePiMessagesToOpenCodeMessages()` / `translateOpenCodeMessagesToSseEvents()`。
  - [ ] 重写通知触发入口（文件/模块：`packages/web/server/index.js`）验收：通知不再监听 `question.asked` / `permission.asked` payload。
  - [ ] 将 permission 对齐边界固化到文档（文件/模块：本方案文档 + 对不上清单）验收：明确“本轮不改 permission 实现，后续按现有 UI 反向实现 Pi-native permission 协议”。

## 9. 执行计划与闭环

- 执行顺序：M1 -> M2 -> M3
- 每个里程碑验证：
  - M1：人工评审文档边界与对不上清单
  - M2：前端聊天主链路手动回归 + 定向 type-check / 测试
  - M3：服务端 Pi 事件链路测试 + 前端 question/permission/通知联调
- 最终回报：变更摘要 + 验收勾选 + 风险残留 + 下一步
