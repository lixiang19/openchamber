# PLAN

## Context
- 基于 `文档/功能开发/2026-03-22_Pi插件接入调研方案.md` 继续收敛 Pi 接入方向，目标是评估如何在尽量保留 OpenAurora 现有 Web UI 的前提下，让后端从 OpenCode 迁移到 `pi`。
- 当前代码明确围绕 OpenCode SDK + `/api/*` 代理 + SSE 事件消费构建，因此任何 Pi 接入都需要先回答“是做 server 侧兼容层，还是在前端重建一层更中立的会话/消息模型”。
- 已根据反馈调整本轮边界：首发以 Web 为主；第一阶段只关注消息列表与工具结果可见，不做 `question` / `permission`；`provider/model/agent` 的最终选择权应收敛到 Pi，Web 主要承担展示壳层。

## Approach
- 消息列表改造遵循“渲染原则优先、协议兼容次之”：先定义前端真正要渲染的稳定语义（message、part、tool activity、session link、stream state），再决定这些语义来自 OpenCode 事件兼容层，还是来自新的 Pi-native 前端数据源。
- 不把“翻译协议”当作目标本身；如果接入 Pi，会优先考虑在前端引入一层更中立的 `ConversationEvent` / `RenderableMessage` 模型，让消息列表只依赖渲染语义，而不是依赖 OpenCode 的原始事件名。
- 第一阶段目标收敛为：Pi 主会话消息、工具调用、工具结果、subagent 摘要在 Web 消息列表中可稳定显示；`question` / `permission`、extension UI request（如 `setStatus` / `setWidget` / `setEditorText`）全部后置。
- 配置策略采用“Pi 掌握选择权，Web 主要展示”的方向：前端现有 `provider/model/agent` 参数短期可作为兼容输入，但长期不再作为真源。

## Files to modify
- `packages/ui/src/hooks/useEventStream.ts`
- `packages/ui/src/components/chat/message/parts/ToolPart.tsx`
- `packages/ui/src/lib/opencode/client.ts`
- `packages/web/server/index.js`
- 可能新增：`packages/ui/src/lib/conversation/*`（若抽中立消息/事件模型）
- 可能新增：`packages/web/server/lib/pi/*`（若保留 server 侧 Pi 接入层）

## Reuse
- `packages/ui/src/hooks/useEventStream.ts:1115`、`packages/ui/src/hooks/useEventStream.ts:1283`、`packages/ui/src/hooks/useEventStream.ts:1365` 已把事件归并为消息列表可消费的 store 操作，是抽离“渲染语义层”的第一落点。
- `packages/ui/src/components/chat/message/parts/ToolPart.tsx` 已能展示 `task/subagent` 汇总与 session 跳转，可继续作为工具消息渲染承载面。
- `packages/ui/src/lib/opencode/client.ts:607` `sendMessage()` 当前直接请求 `/session/:id/prompt_async`，说明发消息入口与回流事件应拆开看：哪怕后端换成 Pi，消息列表也未必要继续绑定 OpenCode 事件名。
- `packages/web/server/index.js:6631` 与 `packages/web/server/index.js:8691` 都有 `/api/event` SSE 代理/增强逻辑，可作为“如果保留服务端事件入口”的参考，但不预设必须走协议翻译。
- `@mariozechner/pi-coding-agent/docs/sdk.md` 明确 Pi 官方推荐 Node/TypeScript 应用优先使用 `createAgentSession()` / `AgentSession` 直接嵌入，而不是默认走子进程 RPC。
- `@mariozechner/pi-coding-agent/docs/rpc.md` 说明 RPC 更适合进程集成与自定义 UI，且 extension UI 通过 `extension_ui_request` 子协议暴露，不是 HTTP/SSE 服务。

## Integration premise
- Pi 没有现成的 OpenCode 风格 HTTP/SSE server；官方支持的接入方式本质上只有两类：SDK 嵌入和 RPC 子进程。
- 对 OpenAurora 而言，推荐把 Pi 集成为 `packages/web/server/` 内的 runtime，而不是把 Pi 当远程 API 服务来“对接”。也就是说，Web server 应成为 Pi 的宿主，而不是 Pi 的代理。
- 首选路径：在 Node/Bun 服务器内直接使用 `createAgentSession()` 创建/管理 Pi 会话，订阅 `session.subscribe()` 事件，再把这些事件喂给前端自己的消息语义层。
- 备选路径：把 `pi --mode rpc` 作为 sidecar 子进程运行，Web server 负责 JSONL command/event 收发。这个路径更利于隔离与调试，但会多一层进程和协议管理。
- 不推荐路径：直接复刻 OpenCode `/api/* + SSE` 协议去“伪装” Pi，或直接依赖 Pi session JSONL 文件做 UI 驱动；这两种都会把未来演进锁死在兼容层上。

## Message List Principles
- 稳定渲染语义应只保留：`session/thread identity`、`role`、`renderable parts`（text/reasoning/tool/custom）、`tool execution lifecycle`（start/update/end）、`stream lifecycle`（start/delta/end）、`subagent/session link metadata`。
- Message list 不应该直接依赖 OpenCode 特有事件名：如 `message.part.updated`、`message.part.delta`、`message.updated`、`session.status`。
- Message list 不应该直接依赖 OpenCode 特有字段命名与结构：如 `sessionID/messageID/partID` 命名、`Part` 精确 schema、OpenCode 的 question/permission 请求对象。
- 第一阶段允许 `thinking`、`custom message` 以降级形态显示，但不允许丢失文本、工具状态、subagent 关联和最终结果。
- 最小改动边界应落在事件归并层与 store 写入层；`MessageList`、`ToolPart`、现有消息块组件尽量只消费中立后的 `RenderableMessage` / `RenderablePart`。

## Pi Capability Mapping
- `message_update`（`text_*` / `thinking_*` / `toolcall_*`）= 对应前端的流式消息 part；第一阶段承接。
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` = 对应工具时间线与输出面板；第一阶段承接。
- `turn_end` / `agent_end` = 对应消息定稿、tool result 汇总、会话状态收敛；第一阶段承接。
- subagent = 不是 Web 自己实现编排，而是把 Pi 扩展/工具产生的调用与结果显示出来；第一阶段承接摘要、session link、原始文本结果。
- custom message = Pi 侧可能出现；第一阶段只要求保留 payload 并做通用渲染占位，不要求一开始就做专门 UI。
- `extension_ui_request`（`select` / `confirm` / `input` / `editor` / `setStatus` / `setWidget` / `set_editor_text`）= 第二阶段，第一阶段全部后置。

## Recommended path
- 推荐主线：`Web server 内嵌 Pi SDK` + `前端最小中立消息模型`。
- 演进顺序：先让 OpenCode 现有事件也归并到中立模型，确认 message list 不再直接绑死 OpenCode；再接入 Pi SDK 作为第二个事件源；最后再移除或边缘化 OpenCode 专属 client 逻辑。
- RPC 只作为备选：当需要进程隔离、崩溃隔离、或快速验证 extension UI 子协议时，再引入 `pi --mode rpc` sidecar。
- 如果短期必须共存 OpenCode 与 Pi，建议在 server 侧只统一“会话管理与事件分发入口”，不要统一成 OpenCode 协议本身。

## Risks and verification
- 最大风险不是“Pi 能不能接”，而是 message list 继续把 OpenCode 事件细节当作 UI 语义，导致后续每加一种 Pi 事件都要继续兼容补丁。
- SDK 路径的主要风险是服务端需要自己管理 session 生命周期、订阅和资源释放；RPC 路径的主要风险是进程管理、JSONL framing 和 extension UI request/response 对接复杂度上升。
- 第一阶段降级策略：只保证文本、工具、subagent 摘要可见；`custom message` 未识别时展示通用块；`extension_ui_request` 明确标注未支持，不做伪交互。
- 验证方式：先用 OpenCode 事件源接中立模型，确认 UI 无回归；再用一个最小 Pi SDK session 跑文本 + bash/read + subagent 示例，验证消息流、工具流、session link 是否可见。
- 最小改动边界验证：若 `MessageList` 和大部分 `parts/*` 组件无需感知 OpenCode/Pi 来源，只改事件归并层和少量类型定义，则说明边界正确。

## Steps
- [x] 确认当前 OpenAurora 前端对 OpenCode SDK 与 SSE 事件的强耦合点。
- [x] 根据反馈收敛第一阶段范围：只做 Web 消息列表与工具结果显示，不做 `question` / `permission`。
- [x] 明确配置权归属方向：`provider/model/agent` 长期由 Pi runtime 掌握，Web 主要作为展示壳层。
- [x] 定义消息列表修改原则：稳定渲染语义、OpenCode 特有事件/字段解耦、最小改动边界落在事件归并层。
- [x] 对照 Pi 能力分层，映射到消息、工具、subagent、custom message、extension UI request，并明确第一阶段只承接消息/工具/subagent 与 custom message 降级显示。
- [x] 在“前端引入中立消息模型”与“服务端兼容层”之间收敛推荐路径：优先 Web server 内嵌 Pi SDK，前端引入最小中立模型，RPC 作为备选。
- [x] 产出风险、降级策略与验证方式，尤其说明 message list 的最小改动边界。

## Verification
- 文档层验证：方案需明确 Pi 的集成前提（SDK / RPC）、消息列表稳定语义、首发支持边界、未支持能力的降级策略。
- 代码层验证（后续实现时）：至少覆盖文本流、工具执行流、subagent 摘要、custom message 降级显示的端到端演练；`extension_ui_request` 单独列为后续阶段验证项。
