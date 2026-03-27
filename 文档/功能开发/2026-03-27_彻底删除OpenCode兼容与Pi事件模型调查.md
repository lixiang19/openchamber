# 彻底删除 OpenCode 兼容与 Pi 事件模型调查

## 一、背景与目标

当前仓库处于从 OpenCode 底层迁移到 Pi SDK 的阶段。

现状问题不在于 `question` 功能本身复杂，而在于历史上同时叠加了三层东西：

1. OpenCode 时代前端直接消费的旧 SSE / message 协议
2. Pi SDK / RPC / session 的原始事件与消息模型
3. 迁移阶段为了维持旧前端可运行而引入的桥接/投影层

本轮结论必须明确：

- **Web 产品层只保留 Pi 原生支持的、自定义 `question` 工具驱动的交互模型**
- **彻底删除对 OpenCode 交互协议的兼容心智**
- **不再为了维持旧前端协议而继续扩大桥接层职责**
- **宁愿前端大改，也不继续维护“Pi -> OpenCode-shaped payload” 这类过渡结构**

## 二、核心结论

### 2.1 `bridge-schema` 不是 `question` 的本体

`bridge-schema` 的本质是“协议边界层”，不是产品交互层。

它的职责应该仅限于：

- 把 Pi 原始事件识别成少量稳定类别
- 做最小字段整理
- 显式保留 unknown / unsupported / deferred
- 让上层代码不用到处手写 `if (event.type === ...)`

它**不应该**负责：

- 决定 `QuestionCard` 怎么渲染
- 决定 `question` 怎么回答
- 决定 legacy dialog 要不要被产品支持
- 把 `input/select/confirm/editor` 伪装成产品能力

### 2.2 Pi 确实不是“单一事件流”

这不是 Pi “不统一”，而是 Pi 的协议层本来就把不同语义分成不同事件家族。

Pi 的统一性体现在：

- 都是明确的 typed event / typed message
- 各自职责清晰
- 文档和源码一致

Pi 的“不是单一流”体现在：

- 生命周期事件一套
- 消息流式更新事件一套
- 工具执行事件一套
- 扩展 UI 请求一套
- 会话持久化里的消息 role 还有一套消息联合类型

也就是说，Pi 是**分层建模**，不是“全都塞进一种 message 里”。

### 2.3 以前 OpenCode 时期基本不需要这层

OpenCode 时期，服务端吐给前端的协议，基本就是前端直接消费的协议：

- `message.updated`
- `message.part.updated`
- `question.asked`
- `permission.asked`
- `session.status`

所以那时不存在今天这种明显的“Pi 原始协议 -> bridge-schema -> runtime projection -> 旧前端协议”链路。

换句话说：

- **`bridge-schema` 基本是 Pi 迁移阶段的产物**
- 不是 `question` 功能天然需要的层
- 也不是 OpenCode 时代就有的同等抽象

## 三、Pi 事件模型事实调查

以下结论来自 Pi 官方源码 / 文档，而不是本项目臆测。

### 3.1 JSON / RPC 模式里，Pi 明确有多类事件

依据：
- `pi的相关资料/pi-mono-main/packages/coding-agent/docs/json.md`
- `pi的相关资料/pi-mono-main/packages/coding-agent/docs/rpc.md`

在 `docs/json.md` 中，`AgentSessionEvent` / `AgentEvent` 被明确定义为多个事件分支：

- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `message_start`
- `message_update`
- `message_end`
- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`
- 以及 `auto_compaction_*`、`auto_retry_*`

这说明 Pi 的会话事件从一开始就不是“只有 message 一种”。

### 3.2 `message_update` 本身又包含流式 delta 子事件

依据：
- `pi的相关资料/pi-mono-main/packages/coding-agent/docs/rpc.md`

`message_update` 里还有 `assistantMessageEvent`，其子类型包括：

- `start`
- `text_start`
- `text_delta`
- `text_end`
- `thinking_start`
- `thinking_delta`
- `thinking_end`
- `toolcall_start`
- `toolcall_delta`
- `toolcall_end`
- `done`
- `error`

这说明“消息流式增量”在 Pi 里是专门建模的，不是普通 message append。

### 3.3 工具执行事件是单独的，不混进消息流

依据：
- `pi的相关资料/pi-mono-main/packages/coding-agent/docs/rpc.md`
- `pi的相关资料/pi-mono-main/packages/coding-agent/docs/json.md`

Pi 单独提供：

- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`

这些事件带：

- `toolCallId`
- `toolName`
- `args`
- `partialResult` / `result`

也就是说，Pi 没有把工具进度伪装成 assistant text，而是显式当作工具执行流来发。

### 3.4 扩展 UI 请求也是单独协议

依据：
- `pi的相关资料/pi-mono-main/packages/coding-agent/src/modes/rpc/rpc-types.ts`
- `pi的相关资料/pi-mono-main/packages/coding-agent/docs/rpc.md`

`RpcExtensionUIRequest` 明确定义了独立的 `extension_ui_request` 协议，方法包括：

- `select`
- `confirm`
- `input`
- `editor`
- `notify`
- `setStatus`
- `setWidget`
- `setTitle`
- `set_editor_text`

这说明 UI 请求不是消息事件的一部分，而是**另一套扩展 UI 子协议**。

### 3.5 会话持久化里的消息 role 也不是单一 `assistant/user`

依据：
- `pi的相关资料/pi-mono-main/packages/coding-agent/docs/session.md`

Pi 的 `AgentMessage` 联合类型不仅有：

- `user`
- `assistant`
- `toolResult`

还有扩展消息：

- `bashExecution`
- `custom`
- `branchSummary`
- `compactionSummary`

这意味着：

- Pi 的“消息”本身也是联合模型
- 并不是只有传统聊天消息
- custom / bash / branch / compaction 都是被一等建模的 message role

## 四、所以 Pi 到底是不是“不统一”？

不是。

更准确地说：

- **Pi 是统一的 typed event / typed message 系统**
- 但它不是“单一 message 流”系统

也就是说：

- 统一：类型明确、协议有文档、源码一致
- 非单一：不同语义被拆成不同事件家族

如果强行把这些都塞回一种“旧前端统一事件”里，反而是在破坏 Pi 本来的建模。

## 五、为什么本项目里会出现 `bridge-schema`

依据：
- `packages/web/server/lib/pi/DOCUMENTATION.md`
- `packages/web/server/lib/pi/runtime.js`

当前项目并不是纯 Pi-native Web。

现在实际链路更接近：

```text
Pi 原始事件
-> bridge-schema 识别/整理
-> runtime.js 投影成旧 Web 还能吃的结构
-> 前端继续消费 legacy 形状
```

例如当前 `runtime.js` 还在生成：

- `session.status`
- `message.updated`
- `message.part.updated`

这本质上还是“Pi -> 旧 OpenCode-shaped payload”的过渡桥。

因此：

- `bridge-schema` 的出现，主要是因为 **底层已经切 Pi，但上层 Web 还没有完全 Pi-native**
- 它不是 `question` 功能天然需要的
- 它是迁移阶段为了接住 Pi 原始事件而加的边界层

## 六、为什么 `question` 会被做复杂

不是因为提问本身复杂，而是因为过去混了三种目标：

1. **Pi 通用扩展 UI 能力**：`ctx.ui.input/select/confirm/editor`
2. **我们的产品交互**：`QuestionCard`
3. **OpenCode 兼容桥接**：旧 SSE / 旧 question/permission 结构

原本简单的产品链路：

```text
question tool
-> QuestionRequest
-> QuestionCard
-> string[][]
```

被历史代码扭成了：

```text
input/select/confirm/editor/question
-> bridge-schema / runtime 归一
-> 前端再特判
-> 回答后再映射旧语义
```

复杂度来源是“同时兼容多套抽象”，不是功能本身。

## 七、本项目的架构决策

### 7.1 产品层只支持一种 blocking interactive contract

Web 产品层只支持：

- **native `question` request**

不支持：

- `ctx.ui.input()`
- `ctx.ui.select()`
- `ctx.ui.confirm()`
- `ctx.ui.editor()`

这些通用扩展 UI 方法不是我们的产品能力，不能再伪装成 `QuestionCard` 的来源。

### 7.2 回答模型只保留一种

统一回答结构：

```ts
string[][]
```

语义：

- 每个问题一个答案组
- 单选 = `['A']`
- 多选 = `['A', 'B']`
- 文本 = `['free text']`
- 多题 = `[第1题答案组, 第2题答案组, ...]`

不再保留：

- `confirm -> boolean`
- `input -> string`
- `select -> string`

这种旧 UI 语义映射。

### 7.3 `bridge-schema` 保留，但必须瘦身为纯协议边界层

允许保留：

- `normalizePiRpcEnvelope()`
- `normalizePiMessage()`
- 对 unknown / unsupported 的显式标注

禁止继续扩大：

- 不再把 legacy dialog 方法归一成产品 `question`
- 不再在这里做产品交互设计
- 不再在这里做 OpenCode 兼容心智扩张

### 7.4 最终目标

真正目标不是“维护一个更聪明的桥”，而是：

```text
Pi 原始事件
-> 最薄边界整理
-> Pi-native 前端状态/组件
```

而不是：

```text
Pi 原始事件
-> bridge-schema
-> runtime.js
-> OpenCode-shaped payload
-> 旧前端
```

## 八、对后续改造的明确要求

1. 继续删除所有 Web 侧 `ctx.ui.input/select/confirm/editor` 产品支持入口
2. 继续删除前端对 OpenCode 事件名和 payload 结构的依赖
3. 继续减少 `runtime.js` 中“投影回旧 OpenCode 结构”的代码
4. 新功能一律直接围绕 Pi-native 状态模型设计，不再新增桥接兼容
5. `question` 只允许走自定义 `question` 工具，不允许再借道 legacy dialog

## 九、一句话结论

- Pi **不是单一事件流**，这是真的；但这不代表它“不统一”
- 它是**统一的 typed protocol + 多事件家族**
- `bridge-schema` 是 Pi 迁移阶段产生的边界层，不是 `question` 功能本体
- 本项目必须继续把 OpenCode 兼容彻底删掉，让前端直接面向 Pi-native 模型重写
