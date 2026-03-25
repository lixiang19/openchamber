# Pi 前端 OpenCode 耦合清单

- 日期：2026-03-25
- 目的：作为 Pi 原生前端重构的拆除清单
- 结论：聊天主链路原先深度耦合 OpenCode，本次改造已绕开主链路，但仓库内仍有大量历史残留待继续删除

## 1. 必须重写的主链路

### 1.1 发送消息入口

- `packages/ui/src/lib/opencode/client.ts`
  - 原先负责 `prompt_async`、session、question、permission、health 全链路
  - 本质上是 OpenCode SDK 包装器
- `packages/ui/src/stores/messageStore.ts`
  - 原先通过 `opencodeClient.sendMessage()` / `sendCommand()` 发送消息
- `packages/ui/src/components/chat/ChatInput.tsx`
  - 原先强依赖 provider/model 已选中才允许发送

处理结论：必须整体替换，不可继续扩展。

### 1.2 事件流入口

- `packages/ui/src/hooks/useEventStream.ts`
  - 原先直接处理 `message.part.updated`、`question.asked`、`permission.asked` 等 OpenCode 事件名
  - 这是旧聊天主链路最深的协议耦合点

处理结论：不能继续作为 Pi 主链路事件入口。

### 1.3 会话与消息真相源

- `packages/ui/src/stores/useSessionStore.ts`
- `packages/ui/src/stores/sessionStore.ts`
- `packages/ui/src/stores/types/sessionTypes.ts`
- `packages/ui/src/stores/messageStore.ts`

这些模块原先直接把 `@opencode-ai/sdk` 的 `Session/Message/Part` 当作核心数据模型。

处理结论：必须从主链路退役。

### 1.4 配置前置依赖

- `packages/ui/src/stores/useConfigStore.ts`
  - 依赖 OpenCode providers / agents / defaults
- `packages/ui/src/stores/useAgentsStore.ts`
- `packages/ui/src/stores/useCommandsStore.ts`
- `packages/ui/src/stores/useSkillsStore.ts`
- `packages/ui/src/stores/questionStore.ts`
- `packages/ui/src/stores/permissionStore.ts`

处理结论：这些都不能再作为聊天主路径的前置条件。

## 2. 可以复用外壳，但不能复用旧数据模型的部分

- `packages/ui/src/components/chat/message/parts/ToolPart.tsx`
  - 可参考视觉布局，但不能再吃 OpenCode `ToolPart`
- `packages/ui/src/components/chat/message/parts/AssistantTextPart.tsx`
  - 可参考 custom message 区块表达，但不能再吃 OpenCode `Part`
- `packages/ui/src/components/chat/QuestionCard.tsx`
  - 可参考交互卡片布局，但不能再当作 OpenCode question 兼容组件继续长大

## 3. 可以暂缓处理的历史残留

这些模块不是新的 Pi 主链路所必需，但仍在仓库中存在，需要后续继续删除：

- `packages/ui/src/lib/openCodeStatus.ts`
- `packages/ui/src/components/onboarding/OnboardingScreen.tsx`
- `packages/ui/src/stores/useMcpStore.ts`
- `packages/ui/src/stores/useProjectsStore.ts`
- `packages/ui/src/components/session/*` 中仍直接调用 `opencodeClient` 的部分

## 4. 本次已完成的主链路切换

- `packages/ui/src/App.tsx`
  - 改为直接进入 Pi 原生聊天界面，不再初始化旧的 OpenCode 聊天主链路
- `packages/ui/src/components/views/ChatView.tsx`
  - 改为挂载新的 `PiChatApp`
- `packages/ui/src/components/pi/PiChatApp.tsx`
  - 新的 Pi 原生会话、消息、工具执行、交互请求界面
- `packages/ui/src/lib/pi/client.ts`
  - 新的 Pi 原生前端客户端
- `packages/ui/src/lib/pi/types.ts`
  - 新的 Pi 原生前端状态类型

## 5. 后续删除优先级

1. 删除旧的 OpenCode 事件流处理
2. 删除旧的 `opencodeClient` 主路径使用
3. 删除旧的 OpenCode onboarding 和状态弹窗
4. 删除旧的聊天 store 对 `@opencode-ai/sdk` 的核心依赖
5. 再逐步清理配置、skills、commands、agents 等历史残留
