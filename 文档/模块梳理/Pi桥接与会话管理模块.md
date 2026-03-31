# Pi桥接与会话管理模块 Module Codemap

## Responsibility

- 为 Ridge Web/桌面端提供 Pi SDK 驱动的会话、消息、事件与交互请求能力。
- 负责把 `@mariozechner/pi-coding-agent` 的 `AgentSession`、`SessionManager`、扩展 UI 事件，投影成 Web 可消费的 HTTP + SSE 形态。
- 负责主会话与 task 子会话的创建、父子关系持久化、列表恢复、按需加载、重命名、发消息、中断等生命周期操作。
- 负责把当前可用 task agents 以 XML 片段注入系统提示词，确保主会话在调用 `task` 工具前已知晓可委派对象与约束。
- 负责发现 Pi agents、编译权限策略，并把权限门控注入到实际运行的 session。
- 负责读取项目内 `.ridge/pi-settings.json`，把用户指定的说明文件安全注入到 Pi system prompt。
- 负责向设置界面暴露 ridge 预置的 Pi 全局配置目录模板，并支持把模板整体覆盖到 `~/.pi/agent/` 后触发运行时重载。
- 负责把 Pi 原生消息/事件规整为前端稳定语义，并把用户侧图片输入/图片消息回显按 Pi 原生 `images` / `image` block 闭环到 Web 聊天界面，但不继续维护 OpenCode RPC 兼容协议。
- 服务对象包括：浏览器端会话侧边栏、聊天消息区、状态栏、命令自动补全、服务端通知/快捷入口。
- 不负责前端 UI 渲染细节；不负责 CLI/RPC 模式；不负责旧 OpenCode 会话协议的长期兼容。

## Design

### Architecture Pattern

- 模式：**分层桥接 + 惰性加载的持久化会话宿主**

```text
[UI Components]
      |
      v
[packages/ui/src/lib/pi/client.ts]
      |
      v
[/api/pi/* + /api/pi/events]
      |
      v
[packages/ui/src/lib/pi/stateRuntime.ts]
      |
      +--> reducer(upsert/bootstrap/apply_event)
      |
      v
[packages/ui/src/hooks/useEventStream.ts]
      |
      v
[Zustand session/message stores]
      |
      v
[packages/web/server/index.js Routes]
      |
      v
[packages/web/server/lib/pi/sdk-host.js]
   |            |             |
   |            |             +--> Agent discovery / permission compile
   |            +----------------> SessionManager.listAll/open/create
   +-----------------------------> createAgentSession() + bindExtensions()
                                      |
                                      v
                           [Pi SDK AgentSession / JSONL Sessions]
```

- 前端接入层：`piClient` 只负责 HTTP/SSE 收发，不直接写 UI store。
- 前端状态层：`stateRuntime.ts` 持有唯一的 Pi reducer 状态；`getSession()/updateSession()/listSessions()/SSE` 全部先进入这里。
- 投影层：`useEventStream.ts` 只负责 bootstrap、订阅 SSE，并把 reducer 状态投影到 `sessionStore/useSessionStore/messageStore`。
- 路由层：`index.js` 仅做 HTTP 参数接入、错误码映射、SSE 分发。
- 宿主层：`sdk-host.js` 是真正的运行时编排器，管理 session 装载、订阅、事件转发与交互请求。
- SDK/存储层：Pi SDK 负责 agent 执行；`SessionManager` 负责 JSONL 持久化与会话枚举。
- 跨层调用方式：UI 永远走 HTTP/SSE；服务端永远走 Pi SDK，不走 RPC 子进程。

### Key Abstractions

#### 1. 会话视图快照（PiSessionViewState）

```ts
export interface PiSessionViewState {
  id: string;
  title: string;
  cwd: string;
  parentID?: string | null;
  createdAt: number;
  updatedAt: number;
  status: 'idle' | 'streaming' | 'error' | 'retrying' | 'compacting';
  messages: PiMessageViewState[];
  interactiveRequests: PiInteractiveRequestViewState[];
}
```

- 代表 Web 端消费的 Pi 会话快照。
- 包含会话元数据、父会话标识、消息列表、交互请求、运行状态。
- 由 `sdk-host.js` 产出，经 `packages/ui/src/lib/pi/client.ts` 拉取，被 Zustand store 与消息列表消费。
- 依据：`packages/ui/src/lib/pi/types.ts`、`packages/web/server/lib/pi/sdk-host.js`

#### 2. 会话宿主记录（sdk-host 内部 record）

```ts
{
  id,
  title,
  cwd,
  createdAt,
  updatedAt,
  session,
  toolExecutions: new Map(),
  interactiveRequests: new Map(),
  selectedPermissionPolicy,
  turnBudget,
}
```

- 代表服务端内存中的“已装载会话运行时”。
- 同时持有 Pi `AgentSession` 实例与 Web 所需的增量状态（工具执行、交互请求、状态栏、widget）。
- 由 `createManagedSessionRecord()` 创建，后续被 `attachSession()` 订阅事件流。
- 依据：`packages/web/server/lib/pi/sdk-host.js`

#### 3. 持久化会话索引（SessionManager + persistedSessionIndex）

```ts
const listed = await SessionManager.listAll();
persistedSessionIndex.set(info.id, info);
const sessionManager = SessionManager.open(info.path);
```

- 代表磁盘上 Pi JSONL 会话的全局索引能力。
- 用于解决“进程重启后内存为空，但历史会话仍应可列出和可恢复”的问题。
- `listSessions()` 用它枚举历史 session，`ensureSessionLoaded()` 用它按需打开具体 session 文件。
- 依据：`packages/web/server/lib/pi/sdk-host.js`、Pi SDK session 文档

#### 4. Task 父子关系索引

```ts
Map<string, {
  sessionId: string;
  parentID: string;
  rootID: string;
  createdAt: number;
}>
```

- 代表 Ridge 自己维护的 task 会话父子关系索引，不依赖 Pi 原生 session 元数据格式。
- 解决 Pi SDK 会话列表不包含产品级 task 层级的问题，使侧边栏、父会话返回按钮、通知过滤都能恢复父子语义。
- 由 `packages/web/server/lib/pi/task-relations.js` 读写，`sdk-host.js` 在创建/恢复 session 时注入到 `PiSessionViewState.parentID`。
- 依据：`packages/web/server/lib/pi/task-relations.js`、`packages/web/server/lib/pi/sdk-host.js`

#### 5. 权限策略编译结果

```ts
const permissionPolicy = compileAgentPermission(
  record.cwd,
  agent?.permission,
  record.defaultToolNames,
);
record.session.setActiveToolsByName(permissionPolicy.activeToolNames);
```

- 代表从 agent frontmatter 权限声明编译出的实际运行权限。
- 既决定可用工具集合，也通过扩展 gate 控制 `tool_call`。
- 由 agent 选择流程创建，被 `sdk-host` 与 `task` 工具共享使用。
- 依据：`packages/web/server/lib/pi/permissions.js`、`packages/web/server/lib/pi/sdk-host.js`

#### 6. 项目级指令注入配置

```js
{
  instructions: {
    enabled: true,
    files: ['SOUL.md', 'IDENTITY.md', 'USER.md'],
    maxFileBytes: 8192,
    maxTotalBytes: 32768,
    onMissingFile: 'warn',
  },
}
```

- 代表项目目录 `.ridge/pi-settings.json` 中声明的系统提示词注入规则。
- 持有启用开关、文件顺序、单文件与总字节上限、缺失文件策略等配置。
- 由模板创建流程写入默认文件，运行时由 `instructions.js` 做沙箱校验和内容拼接，再由 `sdk-host.js` 通过 `appendSystemPromptOverride` 注入。
- 关联文件与依据：`packages/web/server/lib/projects/template.js`、`packages/web/server/lib/projects/templates/general-assistant/.ridge/pi-settings.json`、`packages/web/server/lib/pi/instructions.js`

### Design Patterns

- **惰性加载（Lazy load persisted sessions）**
  - 实现：`sdk-host.js` 中 `listSessions()` 只枚举持久化元数据，`getSession()/prompt()/abort()/renameSession()` 通过 `ensureSessionLoaded()` 再 `SessionManager.open()`。
  - 原因：会话列表需要完整，真实运行时只在用户进入或操作该会话时才装载，避免全量打开所有 JSONL。

- **内存态覆盖持久化元数据（Live overlay on persisted index）**
  - 实现：`listSessions()` 先读 `SessionManager.listAll()`，再把 `task-relations.js` 的父子索引合入持久化快照，最后用 `sessions` Map 中已装载 record 覆盖同 id 条目。
  - 原因：列表既要包含历史会话，也要反映当前 streaming / retrying / widget 等运行时状态，还要恢复 task 父子结构。

- **前端单一 Pi 状态源（Single Pi reducer source of truth）**
  - 实现：`packages/ui/src/lib/pi/stateRuntime.ts` 维护全局 `PiClientState`；`useEventStream.ts` 只接入 SSE 和 bootstrap；`sessionStore.setPiSessionSnapshot()` 改为委托 `upsertPiClientSession()`，不再直接改 `piSessions`。
  - 原因：避免 `getSession()` 快照、轮询结果和 SSE 分别写不同 store，导致旧快照覆盖新状态、重置 `seenEventIds`，进而制造历史消息重复。

- **产品级 task 关系外置持久化（Product-owned task hierarchy persistence）**
  - 实现：`task-relations.js` 以 Ridge 自己的 JSON 文件保存 `sessionId -> parentID/rootID`，`sdk-host.js` 在创建 task 子会话和恢复历史会话时统一读写。
  - 原因：Pi SDK 原生 session 文件不提供 Ridge 所需的 task 父子会话树语义，必须由产品层补齐。

- **动态 task agents XML 提示注入（Dynamic task-agent XML injection）**
  - 实现：`sdk-host.js` 在 `appendSystemPromptOverride` 中把当前可调用 task agents 列表渲染成 `<available_task_agents>...</available_task_agents>`，并在 agent 列表变化时触发 session reload。
  - 原因：task 工具是否能被正确使用，依赖模型事先知道有哪些 task agents 可调用、它们的 mode/description/model/steps 等约束。

- **首段 provider + 剩余 modelID 解析（First-slash model spec parsing）**
  - 实现：`packages/web/server/lib/pi/model-spec.js` 与 `packages/ui/src/lib/modelSpec.ts` 统一按第一个 `/` 解析模型字符串；`task.js`、`sdk-host.js`、`runtime/client.ts`、`useConfigStore.ts`、新建会话/Issue 对话框都复用该规则。
  - 原因：Fireworks/OpenRouter 等 provider 下，真实 `modelID` 可能自带多级路径；若强制两段式 `provider/model`，task 子会话、agent frontmatter 与默认模型设置会在全链路解析失败。

- **项目级指令安全注入（Project-scoped instructions injection）**
  - 实现：`instructions.js` 读取 `.ridge/pi-settings.json`，按白名单扩展名、realpath 沙箱、字节上限和 UTF-8 校验读取文件；`sdk-host.js` 把拼接结果追加进 `DefaultResourceLoader.appendSystemPromptOverride`。
  - 原因：人格/工作流说明属于项目事实，必须跟项目走，同时不能绕开 Pi 默认 prompt 和工具说明。

- **扩展 UI 归一化（Extension UI normalization）**
  - 实现：`createExtensionUiContext()` 把 `notify/setStatus/setWidget/setTitle/setEditorText` 映射为统一 `pi_ui_event`；阻塞交互统一走自定义 `question` 工具。
  - 原因：Web 产品只承接少数可产品化交互，避免直接暴露 TUI/RPC 级 UI API。

- **权限注入而不是调用点打补丁（Permission injection）**
  - 实现：`createPermissionGateExtension()` 在 session 创建阶段注入，`applySessionAgentSelection()` 切换 active tools。
  - 原因：权限属于运行时基础约束，不应在单个工具调用处零散判断。

## Flow

### 1. 会话列表加载流程

场景：侧边栏打开后，前端需要获取全部 Pi 会话，而不是仅获取当前进程内存中的会话。

```text
[1] UI loadSessions()/bootstrap
    packages/ui/src/stores/sessionStore.ts
        |
        v
[2] GET /api/pi/sessions
    packages/web/server/index.js
        |
        v
[3] PI_SDK_HOST.listSessions()
    packages/web/server/lib/pi/sdk-host.js
        |
        +--> [3.1] SessionManager.listAll()
        |         读取磁盘 JSONL 元数据
        |
        +--> [3.2] sessions Map overlay
        |         已装载会话覆盖持久化静态信息
        |
        v
[4] 返回 PiSessionViewState[]
```

- 第 1 步：前端 store/hook 启动列表加载。
- 第 2 步：服务端路由只负责 await 与错误映射。
- 第 3.1 步：从 Pi 持久化 session 目录枚举历史会话。
- 第 3.2 步：若某会话当前已被装载，则返回实时状态；否则返回 metadata-only snapshot。
- 输出：侧边栏能稳定看到已有历史会话，不再因服务端重启而变空。

### 2. 打开历史会话详情流程

场景：用户点击一个历史会话，需要看到完整消息与上下文。

```text
[1] UI loadMessages(sessionId)
    packages/ui/src/stores/messageStore.ts
        |
        v
[2] GET /api/pi/sessions/:id
    packages/web/server/index.js
        |
        v
[3] PI_SDK_HOST.getSession(id)
    sdk-host.js
        |
        v
[4] ensureSessionLoaded(id)
    sdk-host.js
        |
        +--> persistedSessionIndex miss? refresh listAll()
        +--> SessionManager.open(info.path)
        +--> buildProjectInstructionsContext(cwd)
        +--> createAgentSession({ sessionManager })
        +--> attachSession(record)
        |
        v
[5] buildSessionSnapshot(record)
        |
        v
[6] upsertPiClientSession(snapshot)
    packages/ui/src/lib/pi/stateRuntime.ts
        |
        v
[7] useEventStream 投影到 stores
```

- 输入：sessionId。
- 关键分支：
  - 已在内存：直接返回快照。
  - 未在内存：从持久化索引找到 path，再惰性装载。
- 前端关键约束：`getSession()` 返回的快照不能直接写 `piSessions`，必须先进入 `stateRuntime` reducer，再由统一投影更新 UI store。
- 输出：前端拿到完整 `messages`，且不会因为旁路快照写入重置事件状态。

### 3. 创建新会话流程

场景：用户点击新建会话或首次发送消息需要自动建会话。

```text
[1] POST /api/pi/sessions
    index.js
        |
        v
[2] PI_SDK_HOST.createSession({ cwd, title, agent, model, thinkingLevel })
    sdk-host.js
        |
    +--> buildProjectInstructionsContext(cwd)
        +--> SessionManager.create(cwd)
    +--> DefaultResourceLoader.appendSystemPromptOverride(base + project instructions + agent append)
    +--> createAgentSession(..., sessionManager)
        +--> bind question/task/permission extension
  +--> 若调用方显式提供 title，则 session.setSessionName(title)
  +--> 若调用方显式提供 agent/model，则创建阶段直接 applySessionAgentSelection(...)
  +--> 若调用方显式提供 thinkingLevel，则以显式值覆盖 agent/default thinking
        |
        v
[3] emit session_created
        |
        v
[4] 返回完整 session snapshot
```

- 新建会话允许在会话创建阶段显式写入 `agent`、`model`、`thinkingLevel`，前端草稿状态不会再丢失到 SDK 默认值。
- 优先级为：显式 `model` > agent frontmatter `model` > 系统默认模型；显式 `thinkingLevel` > agent frontmatter `thinking` > 系统默认 thinking。
- 新用户默认 thinkingLevel 为 `high`，默认 agent 为 `assistant`（可通过设置覆盖）。
- 新建会话明确落盘，不再依赖默认行为。
- 未显式命名的新会话只会先占位创建；真正的人类可读标题在首条用户消息进入时由 Pi host 生成。
- 会话建立后立即可出现在列表中，并能在后续重启后继续被列出。

### 4. 历史会话继续对话流程

场景：用户在旧会话中再次发送消息。

```text
[1] POST /api/pi/sessions/:id/prompt
        |
        v
[2] ensureSessionLoaded(id)
        |
        v
[3] 若标题仍是系统生成值，则取首条用户消息前 10 个字并调用 session.setSessionName(...)
  |
  v
[4] applySessionAgentSelection(record, agent, model)
        |
        +--> discoverAgents(cwd)
        +--> compileAgentPermission(...)
        +--> setModel / setThinkingLevel / setActiveToolsByName
        |
        v
[5] session.prompt(text, { source: 'interactive', images? })
        |
        v
[6] Agent events -> attachSession() -> SSE /api/pi/events
```

- 输入：prompt 文本、可选 agent/model/images；当仅有图片没有文本时，前端直接把图片作为 `images` 发给 Pi，宿主允许空文本 prompt 继续执行。
- 关键分支：若 session 尚未装载，先从持久化文件恢复，再继续对话；若当前标题只是系统生成值且本次 prompt 文本非空，则在真正调用 `session.prompt()` 前先写入首条用户消息标题；图片不会再被降级成 `Attachments: xxx.png` 文字提示；`/api/pi` 路由使用更高 JSON body limit 承载 base64 图片请求体。
- 输出：前端通过 SSE 收到增量事件，消息区进入 streaming 状态。

## Integration

### External Dependencies

| Module/File | Dependency | Purpose |
|---|---|---|
| `packages/web/server/lib/pi/sdk-host.js` | `@mariozechner/pi-coding-agent` | 创建 AgentSession、访问 SessionManager、SettingsManager、DefaultResourceLoader |
| `packages/web/server/lib/pi/instructions.js` | Node `fs/promises`, `path`, `crypto` | 读取 `.ridge/pi-settings.json`，安全拼接项目说明文件并计算哈希 |
| `packages/web/server/lib/pi/providers.js` | `@mariozechner/pi-coding-agent` | 读取认证与模型注册表，生成 provider/model 列表 |
| `packages/web/server/lib/pi/agents.js` | Node `fs/promises`, `path` | 扫描用户/项目 agents 目录并解析 markdown frontmatter |
| `packages/web/server/index.js` | Express / SSE | 暴露 `/api/pi/*` 路由与事件流 |
| `packages/ui/src/lib/pi/client.ts` | browser `fetch`, `EventSource` | 前端访问 Pi API 与订阅服务端事件 |
| `packages/ui/src/stores/messageStore.ts` | Zustand stores + `piClient` | 加载当前 session 详情并投影为聊天 turn/messages |

### Internal Dependencies

```text
packages/web/server/index.js
  -> packages/web/server/lib/pi/sdk-host.js
     -> bridge-schema.js
     -> agents.js
  -> instructions.js
     -> permissions.js
     -> extensions/question.js
     -> extensions/task.js
     -> Pi SDK (createAgentSession / SessionManager)
  -> packages/web/server/lib/pi/providers.js

packages/ui/src/lib/pi/client.ts
  -> /api/pi/sessions
  -> /api/pi/sessions/:id (title / thinkingLevel update)
  -> /api/pi/events

packages/ui/src/stores/sessionStore.ts
  -> piClient.listSessions()
  -> runtime/projections.ts

packages/ui/src/stores/messageStore.ts
  -> piClient.getSession()
  -> chat/lib/turns/projectTurnRecords
```

### Configuration Files

| File | Location | Purpose |
|---|---|---|
| `~/.pi/agent/` | 用户目录 | Pi 全局配置目录；运行时从其中读取 `settings.json`、`auth.json`、`models.json`、`sessions/` 与资源目录，Ridge 设置页可整体覆盖该目录 |
| `.pi/settings.json` | 项目目录 | 项目级 Pi 设置，覆盖全局设置 |
| `.ridge/pi-settings.json` | 项目目录 | Ridge 项目级指令注入配置；由模板生成，`instructions.js` 在建会话时读取 |
| `~/.pi/agent/agents/*.md` | 用户目录 | 用户级 agent 定义，由 `discoverAgents()` 读取；其中 `assistant` 为 Ridge 默认主 agent |
| `.pi/agents/*.md` | 项目目录 | 项目级 agent 定义，覆盖同名用户 agent |
| `~/.pi/agent/sessions/**` | 用户目录 | Pi JSONL 会话持久化目录，由 `SessionManager.create/open/listAll` 管理 |

### Consumers

- 会话侧边栏：读取列表与当前会话元数据。
- 聊天消息区：读取 `getSession()` 返回的完整消息内容。
- 状态栏/头部：读取 session status、model、thinking level。
- 命令自动补全：读取 `listCommands()`。
- 路由与深链：根据 session id 恢复当前会话。
- 服务端快捷入口与通知逻辑：通过 `PI_SDK_HOST.listSessions()` 读取候选会话。

### Data Flow Summary

```text
Disk JSONL Sessions
   -> SessionManager.listAll/open/create
   -> sdk-host record / AgentSession
   -> HTTP JSON + SSE events
   -> piClient / runtime client（text + images）
   -> Zustand stores / turn projector（user image block -> file part）
   -> Sidebar / Chat / Header UI
```

## Key Files Reference

| File | Lines | Purpose |
|---|---:|---|
| `packages/web/server/lib/pi/sdk-host.js` | 1293 | Pi 会话宿主，管理主会话与 task 子会话、父子关系注入、持久化列表、惰性加载、消息发送与事件桥接 |
| `packages/web/server/lib/pi/instructions.js` | 269 | Ridge 项目级指令配置读取与安全文件装载 |
| `packages/web/server/index.js` | 10698 | `/api/pi/*` 路由与 `/api/pi/events` SSE 入口 |
| `packages/web/server/lib/pi/bridge-schema.js` | 638 | Pi 事件与消息的归一化桥接层 |
| `packages/web/server/lib/pi/extensions/task.js` | 735 | SDK 化 task 工具实现，创建持久化子会话并回传 task metadata |
| `packages/web/server/lib/pi/model-spec.js` | 23 | 统一按第一个 `/` 解析 provider/model 字符串，避免多级 modelID 在 task 与 agent 解析链路失真 |
| `packages/web/server/lib/pi/permissions.js` | 256 | agent 权限声明归一化与运行时 gate 编译 |
| `packages/web/server/lib/pi/agents.js` | 200 | 扫描并合并用户/项目 agent 定义 |
| `packages/web/server/lib/pi/task-relations.js` | 129 | Ridge 自己维护的 task 父子关系持久化索引 |
| `packages/ui/src/lib/pi/client.ts` | 125 | 前端 Pi API 客户端 |
| `packages/ui/src/lib/pi/stateRuntime.ts` | 49 | 前端 Pi reducer 单例状态源，统一接收快照与 SSE 事件 |
| `packages/ui/src/lib/pi/reducer.ts` | 788 | Pi session 状态归并、事件应用与消息渲染态生成 |
| `packages/ui/src/hooks/useEventStream.ts` | 193 | bootstrap + SSE 接入，并把单一 Pi 状态投影到各 Zustand store |
| `packages/ui/src/stores/sessionStore.ts` | 1194 | 会话列表、当前会话选择，以及 Pi 快照入口委托 |
| `packages/ui/src/stores/messageStore.ts` | 3098 | 当前会话详情加载与消息投影 |
