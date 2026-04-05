# AI对话信息流渲染架构诊断 Module Codemap

## Responsibility

- 负责把 Pi session 快照投影成 ridge 聊天界面需要的 turn 结构。
- 负责管理 turn 级时间线窗口、历史加载、live tail 常驻 DOM 与虚拟列表配合。
- 负责根据 `live` / `sorted` 两种实时模式决定 assistant 消息可见性。
- 负责在已完成 turn 上渲染“最后文本展开 + 单总折叠条”的终态。
- 负责把消息体渲染限制在单条消息上下文，不再在 `MessageBody` 内做 activity 聚合。
- 不负责 Pi SSE 状态归并本身，Pi 状态同步由 `useEventStream`、`sessionStore`、`piClientReducer` 处理。
- 不负责工具真实执行，只消费 `toolExecutions` 和 Pi message content 生成显示内容。

## Design

### Architecture Pattern

- 模式：分层投影 + turn 窗口化 + 列表可见性决策

```text
PiSessionViewState
  -> usePiNativeTurns
  -> projectTurnRecords
  -> stabilizeTurnProjection
  -> ChatContainer
  -> useChatTimelineController
  -> MessageList
  -> TurnItem / TurnAssistantBlock
  -> ChatMessage / MessageBody
```

- 投影层：把 session 变成稳定的 `TurnProjectionResult`，只保留 turn、索引、未分组消息、stream 状态。
- 时间线层：按 turn 窗口裁剪消息，处理恢复历史、滚动锚点、live tail 拆分。
- 列表层：只决定当前哪些 assistant 消息应该可见，完成态只保留最后文本和单总折叠条。
- 消息层：只渲染单条消息，不再基于 activity group 重组 reasoning / tool / justification。

### Key Abstractions

1. `TurnProjectionResult`

```ts
export interface TurnProjectionResult {
  turns: TurnRecord[];
  indexes: TurnIndexes;
  lastTurnId: string | null;
  ungroupedMessageIds: Set<string>;
  piMessages?: Map<string, PiMessageViewState>;
}
```

- 表示一份 session 在聊天 UI 里的稳定投影结果。
- 由 `usePiNativeTurns` 创建，被 `ChatContainer`、`MessageList`、时间线窗口消费。
- 关联文件：[types.ts](/Users/admin/Documents/GitHub/openchamber/packages/ui/src/components/chat/lib/turns/types.ts)、[usePiNativeTurns.ts](/Users/admin/Documents/GitHub/openchamber/packages/ui/src/components/chat/hooks/usePiNativeTurns.ts)、[projectTurnRecords.ts](/Users/admin/Documents/GitHub/openchamber/packages/ui/src/components/chat/lib/turns/projectTurnRecords.ts)

2. `TurnRecord`

```ts
export interface TurnRecord {
  turnId: string;
  userMessage: ChatMessageEntry;
  assistantMessages: ChatMessageEntry[];
  stream: TurnStreamState;
  summaryText?: string;
  signature?: string;
}
```

- 表示一个 turn 的原始消息链。
- 当前不再携带 `activityParts`、`activitySegments` 等派生展示结构。
- `signature` 仅用于已完成 turn 的增量复用判断。
- 关联文件：[types.ts](/Users/admin/Documents/GitHub/openchamber/packages/ui/src/components/chat/lib/turns/types.ts)、[projectTurnRecords.ts](/Users/admin/Documents/GitHub/openchamber/packages/ui/src/components/chat/lib/turns/projectTurnRecords.ts)

3. `TurnGroupingContext`

```ts
export interface TurnGroupingContext {
  turnId: string;
  isFirstAssistantInTurn: boolean;
  isLastAssistantInTurn: boolean;
  headerMessageId?: string;
  isWorking: boolean;
}
```

- 表示消息组件渲染当前所需的最小 turn 上下文。
- 只服务视觉拼接、header/footer 与 working 状态，不再承载 activity 折叠控制。
- 由 `MessageList` 在可见消息集合上按需构造，传给 `ChatMessage`。
- 关联文件：[types.ts](/Users/admin/Documents/GitHub/openchamber/packages/ui/src/components/chat/lib/turns/types.ts)、[MessageList.tsx](/Users/admin/Documents/GitHub/openchamber/packages/ui/src/components/chat/MessageList.tsx)

4. `TurnWindowModel`

```ts
type TurnWindowModel = {
  turnIds: string[];
  turnIndexById: Map<string, number>;
  messageToTurnId: Map<string, string>;
  messageToTurnIndex: Map<string, number>;
  turnCount: number;
}
```

- 表示基于 turn 的历史窗口模型，用于加载更早消息和按 turn 跳转。
- 由 `useChatTimelineController` 基于当前 projection 展开消息后构建。
- 关联文件：[windowTurns.ts](/Users/admin/Documents/GitHub/openchamber/packages/ui/src/components/chat/lib/turns/windowTurns.ts)、[useChatTimelineController.ts](/Users/admin/Documents/GitHub/openchamber/packages/ui/src/components/chat/hooks/useChatTimelineController.ts)

### Design Patterns

- 单一投影来源
  - `ChatContainer` 通过 `usePiNativeTurns` 统一构建一次 `TurnProjectionResult`，再传给 `MessageList` 和 `useChatTimelineController`。
  - 这样避免同一份 session 在多个 UI 分支重复全量投影。
- 已完成 turn 的签名复用
  - `projectTurnRecords.ts` 通过 `signature` 比较 assistant 消息 id、stopReason、toolExecution 状态决定是否复用上一轮 turn 计算结果。
  - 这样把增量更新成本集中在变化 turn 上。
- 渲染层后置可见性决策
  - `projectTurnRecords.ts` 只保留原始 turn 数据，不提前整理 activity。
  - `MessageList.tsx` 和 `TurnAssistantBlock.tsx` 在最终渲染前才决定 live/sorted/完成态哪些消息可见。
- live tail 脱离虚拟列表
  - `MessageList.tsx` 会把最后一个 streaming turn 从历史虚拟列表拆出来单独常驻 DOM。
  - 这样减少流式过程中虚拟列表测量抖动。

## Flow

### Session 到 Turn 投影流程

```text
1. ChatContainer
   -> usePiNativeTurns
2. usePiNativeTurns
   -> projectTurnRecords
3. projectTurnRecords
   -> stabilizeTurnProjection
4. ChatContainer
   -> currentTurnProjection
```

- 输入：`PiSessionViewState`
- 第 1 步在容器层获取当前 session。
- 第 2 步调用 `projectTurnRecords` 构建原始 turn 结构。
- 第 3 步做稳定化复用，尽量复用未变化的 turn 引用。
- 输出：共享给列表和时间线的唯一 `TurnProjectionResult`。

### 时间线窗口流程

```text
1. ChatContainer
   -> useChatTimelineController(projection)
2. useChatTimelineController
   -> buildTurnWindowModel(messages)
3. windowMessagesByTurn
   -> renderedMessages
4. MessageList
   -> turnStart / history entries / live tail
```

- 输入：共享 projection、历史元信息、滚动容器。
- `useChatTimelineController` 从 projection 展开出消息序列，再构建 turn 窗口模型。
- `turnStart` 控制当前历史窗口起点，向上加载时优先揭示缓冲 turn，不够再请求更早历史。
- 输出：当前窗口消息、turn 跳转能力、滚动恢复能力。

### 实时模式渲染流程

```text
1. MessageList
   -> TurnBlock
2. TurnBlock
   -> buildVisibleAssistantMessages
3. TurnAssistantBlock
   -> render visible messages
4. ChatMessage / MessageBody
   -> render single message body
```

- 输入：当前 turn、`chatRenderMode`、stream 状态。
- `live + streaming`：显示全部 assistant 消息。
- `sorted + streaming`：只显示最后一条 assistant 消息。
- `MessageBody` 只渲染单条消息自身的 text / reasoning / tool parts，不再做 activity group。

### 完成态与恢复态流程

```text
1. TurnAssistantBlock
   -> resolve final text message
2. collapsed count
   -> render collapse bar
3. default closed
   -> only final message visible
4. user expand
   -> show full historical assistant flow
```

- 输入：已完成 turn 的 assistant 消息链。
- 默认只保留最后一条有可见文本的 assistant 消息。
- 其它 assistant 消息统一折叠成一条总入口，例如 `13 条消息`。
- 重新进入会话时折叠状态重置，不记住上次临时展开结果。

## Integration

### External Dependencies

| Module/File | Dependency | Purpose |
| --- | --- | --- |
| `MessageList.tsx` | `@tanstack/react-virtual` | 虚拟列表与行测量 |
| `ChatContainer.tsx` | `zustand` | 读取会话、UI、滚动相关状态 |
| `usePiNativeTurns.ts` | React | 记忆化和稳定化 projection |
| `useChatTimelineController.ts` | React | turn 窗口状态与滚动恢复 |

### Internal Dependencies

```text
ChatContainer
  -> usePiNativeTurns
    -> projectTurnRecords
    -> stabilizeTurnProjection
  -> useChatTimelineController
    -> windowTurns
  -> MessageList
    -> applyRetryOverlay
    -> useStageTurns
    -> TurnItem
      -> TurnAssistantBlock
      -> ChatMessage
        -> MessageBody
```

### Configuration Files

| File | Location | Purpose |
| --- | --- | --- |
| `useUIStore.ts` | `packages/ui/src/stores/useUIStore.ts` | 保存 `chatRenderMode`、`stickyUserHeader` 等聊天显示配置 |
| `persistence.ts` | `packages/ui/src/lib/persistence.ts` | 持久化 UI 设置并在启动时恢复 |

### Consumers

- ridge 聊天主界面 `ChatContainer`
- turn 时间线导航和“跳转到回合/消息”功能
- 会话恢复时的默认折叠终态显示
- 流式对话中的 live tail 展示

### Data Flow Summary

```text
PiSessionViewState
  -> TurnProjectionResult
  -> windowed ChatMessageEntry[]
  -> visible assistant subset
  -> ChatMessage DOM
```

## Key Files Reference

| File | Lines | Purpose |
| --- | --- | --- |
| `packages/ui/src/components/chat/MessageList.tsx` | 1691 | 聊天列表主入口，负责 staging、虚拟列表、turn entry 与 live tail |
| `packages/ui/src/components/chat/lib/turns/projectTurnRecords.ts` | 906 | 把 Pi session 投影成 turn 结构和索引 |
| `packages/ui/src/components/chat/ChatContainer.tsx` | 556 | 聊天容器，统一装配 projection、滚动、时间线和消息列表 |
| `packages/ui/src/components/chat/message/MessageBody.tsx` | 1426 | 单条消息正文渲染入口 |
| `packages/ui/src/components/chat/hooks/useChatTimelineController.ts` | 440 | turn 窗口、历史加载、滚动恢复与跳转控制 |
| `packages/ui/src/components/chat/lib/turns/types.ts` | 115 | turn 投影核心类型 |
| `packages/ui/src/components/chat/hooks/usePiNativeTurns.ts` | 48 | 当前 session 的单一 projection 构建入口 |
| `packages/ui/src/components/chat/components/TurnAssistantBlock.tsx` | 108 | 实现 live/sorted 过程态与完成态折叠逻辑 |
| `packages/ui/src/components/chat/components/TurnItem.tsx` | 58 | turn 级容器，负责 user header 与 assistant 区布局 |
| `packages/ui/src/components/chat/lib/turns/stabilizeTurnProjection.ts` | 75 | 稳定化未变化 turn 的引用，降低重渲染 |
