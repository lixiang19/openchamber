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

## Steps
- [x] 确认当前 OpenAurora 前端对 OpenCode SDK 与 SSE 事件的强耦合点。
- [x] 根据反馈收敛第一阶段范围：只做 Web 消息列表与工具结果显示，不做 `question` / `permission`。
- [x] 明确配置权归属方向：`provider/model/agent` 长期由 Pi runtime 掌握，Web 主要作为展示壳层。
- [ ] 定义消息列表修改原则：哪些渲染语义必须稳定，哪些 OpenCode 特有事件/字段必须从渲染层解耦。
- [ ] 对照 Pi 能力分层，映射到消息、工具、subagent、custom message、extension UI request，并明确第一阶段只承接哪些。
- [ ] 在“前端引入中立消息模型”与“服务端兼容层”之间收敛推荐路径，说明取舍与演进顺序。
- [ ] 产出风险、降级策略与验证方式，尤其说明 message list 的最小改动边界。

## Verification
- 文档层验证：方案需明确 API/SSE 映射点、首发支持边界、未支持能力的降级策略。
- 代码层验证（后续实现时）：至少覆盖消息流、工具结果、question、permission 的端到端演练。
