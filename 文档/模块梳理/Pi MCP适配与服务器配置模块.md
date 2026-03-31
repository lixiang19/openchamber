# Pi MCP适配与服务器配置模块 Module Codemap

## Responsibility

- 为 Ridge 的 MCP 浮窗、设置页和服务器列表提供统一的数据入口，面向最终用户的 Pi MCP Adapter 配置体验。
- 负责读取与写回 Pi 标准 MCP 配置文件：全局 `~/.pi/agent/mcp.json`、项目级 `.pi/mcp.json`，并保留同文件中的其它顶层字段。
- 负责把 `mcp-cache.json` 中的缓存元信息投影成“工具数/缓存状态/刷新时间”等 UI 语义。
- 负责把设置页中的表单字段收敛为 Pi MCP Adapter 可直接消费的服务器定义，不再写入 OpenCode 风格的 `opencode.json`。
- 负责在保存配置后触发运行时重载/刷新，让 UI 与 Pi 当前运行状态尽量同步。
- 服务对象包括：设置侧边栏、MCP 详情页、顶部浮窗、运行时刷新流程。
- 不负责实现 MCP 协议本身；不负责工具执行；不负责 Pi SDK 的 agent 会话逻辑。

## Design

### Architecture Pattern

- 模式：**文件型配置宿主 + 前端状态投影 + 运行时状态旁路读取**

```text
[Header MCP Dropdown]
        |
        v
[useMcpStore] -------------------------------> [runtimeClient.mcp.status/connect/disconnect]
        |
        v
[顶部浮窗 UI]

[SettingsView / McpSidebar / McpPage]
        |
        v
[useMcpConfigStore]
        |
        v
[HTTP /api/config/mcp]
        |
        v
[packages/web/server/index.js]
        |
        v
[packages/web/server/lib/pi/mcp-config.js]
        |
        +--> ~/.pi/agent/mcp.json
        +--> <project>/.pi/mcp.json
        +--> ~/.pi/agent/mcp-cache.json
```

- 运行时状态通道：浮窗保留通过 `useMcpStore` 读取的实时状态，用于显示连接开关和状态点。
- 配置通道：设置页通过 `useMcpConfigStore` 访问 `/api/config/mcp`，所有编辑都落到 Pi MCP Adapter 的配置文件。
- 服务端通道：`mcp-config.js` 负责读写 JSON、合并全局/项目配置、解析缓存，并把配置整理成 UI 可编辑结构。
- 跨层调用方式：前端只通过 HTTP；服务端只通过文件系统，不依赖 OpenCode 配置。

### Key Abstractions

#### 1. MCP 服务器视图对象（`McpServerWithScope`）

```ts
export interface McpServerWithScope {
  name: string;
  scope: 'user' | 'project';
  type: 'local' | 'remote';
  command: string[];
  url: string;
  environment: McpEnvironmentEntry[];
  cwd: string;
  advancedJson: string;
  sourcePath?: string;
  cache?: { toolCount: number; resourceCount: number; cachedAt: number | null; isFresh: boolean } | null;
}
```

- 代表设置页和列表页直接消费的服务器模型。
- 持有基础传输信息、工作目录、环境变量、扩展高级字段以及缓存摘要。
- 由 `packages/web/server/lib/pi/mcp-config.js` 读取文件后生成，被 `useMcpConfigStore` 和 `McpPage`/`McpSidebar` 消费。
- 依据：`packages/web/server/lib/pi/mcp-config.js`、`packages/ui/src/stores/useMcpConfigStore.ts`

#### 2. MCP 草稿对象（`McpDraft`）

```ts
export interface McpDraft extends McpServerWithScope {}
```

- 代表编辑器里的待保存配置。
- 与服务器视图对象共享结构，避免双套表单字段。
- 由 `McpSidebar` 创建新草稿，由 `McpPage` 编辑后提交到 `/api/config/mcp/:name`。
- 依据：`packages/ui/src/stores/useMcpConfigStore.ts`、`packages/ui/src/components/sections/mcp/McpPage.tsx`

#### 3. 配置包（`readConfigBundle()` 返回值）

```ts
{
  directory,
  globalConfigPath,
  projectConfigPath,
  cachePath,
  settings,
  imports,
  mcpServers,
}
```

- 代表服务端一次性读到的 MCP 配置快照。
- 既包含文件路径，也包含合并后的服务器列表与缓存信息。
- 由 `mcp-config.js` 聚合全局/项目配置文件，再由路由返回给前端。
- 依据：`packages/web/server/lib/pi/mcp-config.js`

#### 4. 缓存摘要（`cache`）

```ts
{
  toolCount: number;
  resourceCount: number;
  cachedAt: number | null;
  isFresh: boolean;
}
```

- 代表 `~/.pi/agent/mcp-cache.json` 中对某个服务器的最近缓存状态。
- 用于在列表中显示工具数量、区分新鲜/过期缓存，辅助用户判断是否需要刷新。
- 由服务端根据缓存 hash 与配置 hash 匹配后生成。
- 依据：`packages/web/server/lib/pi/mcp-config.js`

### Design Patterns

- **文件型真源（File-backed source of truth）**
  - 实现：`mcp-config.js` 直接读写 `~/.pi/agent/mcp.json` 与 `.pi/mcp.json`，前端不再依赖 OpenCode 的 MCP 配置接口。
  - 原因：Pi MCP Adapter 本身就以配置文件驱动，UI 应该与它的真实配置边界保持一致。

- **全局覆盖项目的合并策略（Global-overridden-by-project merge）**
  - 实现：`readConfigBundle()` 先读全局配置，再用项目配置覆盖同名服务器。
  - 原因：与 Pi MCP Adapter 的项目配置优先级一致，用户在项目里改动不应被全局配置覆盖。

- **原样保留未知字段（Unknown-field preservation）**
  - 实现：写回时只替换已知字段，`advancedJson` 与 `preservedRaw` 会保留未建模字段。
  - 原因：Adapter 的配置项会扩展，UI 不应因为只编辑部分字段而丢掉用户的高级设置。

- **原子写入（Atomic write）**
  - 实现：`writeJsonFileAtomic()` 先写临时文件，再 `rename` 覆盖目标文件。
  - 原因：避免配置文件在写入中途损坏，尤其适用于同时存在 UI 编辑和运行时读取的场景。

- **运行时状态旁路读取（Runtime side-channel status）**
  - 实现：顶部浮窗仍走 `useMcpStore -> runtimeClient.mcp.status()`，不把状态判断硬编码到配置页。
  - 原因：配置文件只负责静态定义；是否连接、是否失败、是否需要认证属于运行时状态。

## Flow

### 1. MCP 配置加载流程

场景：设置页打开后，需要同时看到项目/全局服务器列表与缓存信息。

```text
[1] SettingsView 打开 MCP 页
    packages/ui/src/components/views/SettingsView.tsx
        |
        v
[2] useMcpConfigStore.loadMcpConfigs()
    packages/ui/src/stores/useMcpConfigStore.ts
        |
        v
[3] GET /api/config/mcp?directory=...
    packages/web/server/index.js
        |
        v
[4] readConfigBundle(directory)
    packages/web/server/lib/pi/mcp-config.js
        |
        +--> ~/.pi/agent/mcp.json
        +--> <project>/.pi/mcp.json
        +--> ~/.pi/agent/mcp-cache.json
        |
        v
[5] 返回 McpServerWithScope[]
        |
        v
[6] Sidebar / Page 渲染
```

- 第 1 步：设置页根据当前页签触发加载。
- 第 2 步：前端 store 发起拉取并保留选择态。
- 第 3-4 步：服务端合并全局和项目配置，同时附带缓存摘要。
- 第 5 步：前端拿到标准化服务器列表。
- 第 6 步：侧边栏用于列出服务器，详情页用于编辑。

### 2. 新建/保存 MCP 服务器流程

场景：用户在设置页新建或更新一个服务器定义。

```text
[1] McpPage 表单提交
    packages/ui/src/components/sections/mcp/McpPage.tsx
        |
        v
[2] useMcpConfigStore.createMcp / updateMcp
    packages/ui/src/stores/useMcpConfigStore.ts
        |
        v
[3] POST /api/config/mcp/:name 或 PATCH /api/config/mcp/:name
    packages/web/server/index.js
        |
        v
[4] persistServerConfig(directory, existingName, draft)
    packages/web/server/lib/pi/mcp-config.js
        |
        +--> 解析 advancedJson
        +--> 保留未知字段
        +--> 原子写入目标 mcp.json
        |
        v
[5] 前端重新 loadMcpConfigs()
        |
        v
[6] 尝试刷新运行时配置
```

- 输入：草稿对象（name/scope/type/command/url/environment/cwd/advancedJson）。
- 关键分支：本地服务器必须有 command；远程服务器必须有 URL；高级 JSON 必须是对象。
- 输出：配置文件更新，列表刷新，运行时尽量同步。
- 这样可以把设置页的写入行为直接映射到 Pi MCP Adapter 的文件约定。

### 3. 删除 MCP 服务器流程

场景：用户在详情页删除某个服务器。

```text
[1] McpPage / McpSidebar 点击删除
    packages/ui/src/components/sections/mcp/McpPage.tsx
    packages/ui/src/components/sections/mcp/McpSidebar.tsx
        |
        v
[2] DELETE /api/config/mcp/:name
    packages/web/server/index.js
        |
        v
[3] deleteServerConfig(directory, name)
    packages/web/server/lib/pi/mcp-config.js
        |
        +--> 定位 sourcePath
        +--> 从对应 JSON 中移除该服务器
        |
        v
[4] 重新加载列表 + 刷新运行时
```

- 删除操作只移除当前匹配到的源文件条目。
- 若同名服务器在全局与项目都存在，项目条目优先显示；删除项目条目后，全局条目可能重新出现。
- 这是与配置合并策略一致的结果，不做额外补丁兜底。

### 4. 顶部浮窗状态读取流程

场景：用户打开顶部 MCP 浮窗，需要看到当前连接状态。

```text
[1] Header 打开 MCP 下拉
    packages/ui/src/components/layout/Header.tsx
        |
        v
[2] McpDropdownContent
    packages/ui/src/components/mcp/McpDropdown.tsx
        |
        v
[3] useMcpStore.refresh / getStatusForDirectory
    packages/ui/src/stores/useMcpStore.ts
        |
        v
[4] runtimeClient.mcp.status()
    packages/ui/src/lib/runtime/client.ts
        |
        v
[5] 渲染状态点、开关、刷新按钮
```

- 该流程与设置页不同，读取的是运行时状态而不是文件配置。
- 浮窗保留开关交互，适合快速连接/断开与查看状态。
- 当状态为空时，文案已切换为 Pi MCP Adapter 配置路径提示。

## Integration

### External Dependencies

| Module/File | Dependency | Purpose |
|---|---|---|
| `packages/web/server/lib/pi/mcp-config.js` | Node `fs/promises`, `path`, `os`, `crypto` | 读取、合并、写回 MCP 配置与缓存文件 |
| `packages/web/server/index.js` | Express | 暴露 `/api/config/mcp` CRUD 路由 |
| `packages/ui/src/stores/useMcpConfigStore.ts` | `fetch`, `reloadRuntimeConfiguration` | 拉取/保存 MCP 配置并刷新运行时 |
| `packages/ui/src/stores/useMcpStore.ts` | `runtimeClient` | 获取顶部浮窗所需的运行时状态 |
| `packages/ui/src/components/mcp/McpDropdown.tsx` | `Switch`, `Tooltip`, `MobileOverlayPanel` | 运行时状态展示与快速连接交互 |
| `packages/ui/src/components/sections/mcp/McpPage.tsx` | `Input`, `Textarea`, `Select`, `Dialog` | 服务器配置表单与高级 JSON 编辑 |
| `packages/ui/src/components/sections/mcp/McpSidebar.tsx` | `SettingsProjectSelector`, `DropdownMenu` | 服务器列表、项目切换、删除入口 |

### Internal Dependencies

```text
packages/ui/src/components/views/SettingsView.tsx
  -> McpSidebar
  -> McpPage
  -> useMcpConfigStore

packages/ui/src/components/sections/mcp/McpSidebar.tsx
  -> useMcpConfigStore
  -> useMcpStore
  -> SettingsProjectSelector

packages/ui/src/components/sections/mcp/McpPage.tsx
  -> useMcpConfigStore
  -> useMcpStore
  -> useDirectoryStore

packages/ui/src/stores/useMcpConfigStore.ts
  -> /api/config/mcp
  -> reloadRuntimeConfiguration

packages/web/server/index.js
  -> lib/pi/mcp-config.js
     -> readConfigBundle / persistServerConfig / deleteServerConfig
```

### Configuration Files

| File | Location | Purpose |
|---|---|---|
| `~/.pi/agent/mcp.json` | 用户目录 | Pi MCP Adapter 的全局服务器配置 |
| `<project>/.pi/mcp.json` | 项目目录 | Pi MCP Adapter 的项目级服务器配置，优先于全局配置 |
| `~/.pi/agent/mcp-cache.json` | 用户目录 | MCP 工具与资源的缓存元数据，用于工具数与缓存状态展示 |
| `~/.pi/agent/settings.json` | 用户目录 | 可能通过 `packages`/`extensions` 影响 Pi MCP Adapter 资源加载 |
| `.pi/settings.json` | 项目目录 | 项目级 Pi 设置，也可能影响 Adapter 扩展/包加载 |

### Consumers

- 顶部浮窗：读取运行时状态，展示连接点和切换开关。
- 设置页 MCP 分栏：显示服务器树、状态徽标和详情编辑器。
- 项目切换器：决定项目级 MCP 配置应写入哪个目录。
- 运行时刷新流程：在写回配置后尝试重载当前 Pi 运行时。
- 用户手工编辑器：用户也可能直接编辑 `.pi/mcp.json` 或 `~/.pi/agent/mcp.json`，UI 应能重新加载。

### Data Flow Summary

```text
UI 表单 / 浮窗状态
   -> 前端 store 投影
   -> HTTP API / runtimeClient
   -> 服务端文件系统读写
   -> Pi MCP Adapter 配置/缓存文件
   -> 运行时状态与列表 UI
```

## Key Files Reference

| File | Lines | Purpose |
|---|---|---|
| `packages/web/server/lib/pi/mcp-config.js` | 464 | Pi MCP 配置的读写、合并、缓存摘要与原子写入 |
| `packages/web/server/index.js` | 10698 | 对外暴露 `/api/config/mcp` 路由并接入服务端文件逻辑 |
| `packages/ui/src/stores/useMcpConfigStore.ts` | 289 | 前端 MCP 配置 store，负责加载、创建、更新、删除与运行时刷新 |
| `packages/ui/src/components/sections/mcp/McpPage.tsx` | 761 | MCP 详情编辑页，支持基础字段与高级 JSON |
| `packages/ui/src/components/sections/mcp/McpSidebar.tsx` | 342 | MCP 服务器树与项目/用户分组列表 |
| `packages/ui/src/components/mcp/McpDropdown.tsx` | 422 | 顶部浮窗，展示运行时状态并保留快速连接交互 |
| `packages/ui/src/lib/settings/metadata.ts` | 211 | 设置页入口元数据与 MCP 页面描述/检索关键词 |
| `packages/ui/src/components/views/SettingsView.tsx` | 771 | 设置页路由分发，把 MCP 页面挂到主设置导航中 |
| `packages/ui/src/lib/configUpdate.ts` | 69 | 配置更新状态文案与全局更新提示 |
