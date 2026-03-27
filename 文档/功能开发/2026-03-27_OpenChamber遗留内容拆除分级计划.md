# OpenChamber 遗留内容拆除分级计划

- 状态：草案
- 日期：2026-03-27
- Owner：Codex
- 目标：把仓库中仍然存活的 `OpenChamber / openchamber / OPENCHAMBER / @openchamber` 命名、设置存储、检查链路、构建发布标识按难易度拆分，供后续逐步彻底替换。
- 决策前提：本项目允许直接删改，不保留 OpenChamber 兼容，不做过渡桥接，不维护旧路径与旧命名双写。
- 现状结论：当前仓库里，代码/脚本/配置层大约有 173 个文件仍包含 OpenChamber 相关内容；它们不是纯文案残留，而是覆盖了 UI、桌面端、服务端、持久化、更新检查、Docker、安装脚本、包名与发布链路。
- 备注：仓库当前不存在根目录 `文档/模块梳理/` 目录，因此本次只新增功能规划文档，不更新模块梳理。

## 1. 拆除原则

- 原则 1：先拆“显示层和内部标识”，再拆“持久化和发布链路”；不要一上来就改配置目录和二进制名。
- 原则 2：同一层改动必须一次改透；例如改事件名，就同时改发送端和监听端，不能保留双命名。
- 原则 3：本项目不做兼容，所以每一轮都要有明确的“切换完成点”，不能留下旧路径兜底。
- 原则 4：凡是会影响用户磁盘数据、安装方式、更新链路的改动，都放在后半程集中处理。
- 原则 5：OpenChamber 拆除与 OpenCode 拆除虽然相关，但不是一回事；本文件只把 OpenChamber 相关内容作为主轴，OpenCode 桥接残留只作为并行注意项。

## 2. 分级标准

| 等级 | 难度定义 | 典型影响 | 是否建议优先处理 |
| --- | --- | --- | --- |
| D1 | 低 | 只影响文案、显示名、前端别名、纯静态文档 | 是 |
| D2 | 中低 | 影响仓库内部事件名、局部存储键名、前后端内部路由 | 是 |
| D3 | 中 | 影响跨包命名、workspace 包名、构建脚本、开发脚本、Docker 内部命名 | 中期处理 |
| D4 | 高 | 影响用户持久化配置、环境变量、鉴权文件、更新检查输入输出 | 后期集中处理 |
| D5 | 极高 | 影响 CLI 命令、安装/更新方式、二进制名、外部仓库地址、发布生态 | 最后处理 |

## 3. 分级清单

### D1：低难度，先清理用户可见残留

这类改动通常只涉及前端文案、标题、文档和少量 URL 别名，不影响运行时状态和磁盘数据，适合作为第一轮清理。

- 典型范围：
  - 侧边栏与设置页文案：`packages/ui/src/constants/sidebar.ts:67`
  - 设置路由别名中的 `openchamber`：`packages/ui/src/lib/router/parseRoute.ts:102`
  - Web 页面中的设置深链：`packages/web/index.html:142`
  - 桌面空白页标题与 noscript 文案：`packages/desktop/noop-dist/index.html:6`
  - README、安装文档、Troubleshooting、Themes、Quickstart、Deployment、Security、Contributing 等文档
- 代表性问题：
  - 用户仍能在 UI 上直接看到 OpenChamber 品牌。
  - 文档仍在教用户使用 `openchamber` 命令和 OpenChamber 路径。
  - 某些设置入口仍把“应用设置”表述成 OpenChamber 设置。
- 建议动作：
  - 先把所有用户可见的品牌文案统一替换掉。
  - 直接删掉 `?settings=openchamber` 这种旧别名，只保留真正的新路由语义。
  - 同步改 README、docs、desktop shell loading 页面，避免 UI 改完后文档仍指向旧品牌。
- 风险：
  - 低；主要风险是漏改文案导致品牌混用。

### D2：中低难度，改内部事件名、局部存储键与内部检查路径

这类改动已经进入运行时链路，但多数还停留在仓库内部，只要发送端和消费端同批次修改，就可以快速切掉。

- 典型范围：
  - 前端运行时事件：
    - `openchamber:settings-synced`：`packages/ui/src/lib/persistence.ts:898`、`packages/ui/src/contexts/ThemeSystemContext.tsx:651`
    - `openchamber:app-ready`：`packages/ui/src/App.tsx:358`
    - `openchamber:installed-apps-updated`：`packages/ui/src/stores/useOpenInAppsStore.ts:195`
  - 桌面更新相关事件：
    - `openchamber:check-for-updates`：`packages/desktop/src-tauri/src/main.rs:86`
    - `openchamber:update-progress`：`packages/desktop/src-tauri/src/main.rs:2211`
  - localStorage / IndexedDB / store 键名：
    - `openchamber.github-pr-status`：`packages/ui/src/stores/useGitHubPrStatusStore.ts:14`
    - `openchamber-inline-comment-drafts`：`packages/ui/src/stores/useInlineCommentDraftStore.ts:209`
  - Web 侧内部检查路径：`/api/openchamber/update-check`，调用入口见 `packages/ui/src/stores/useUpdateStore.ts:94`
- 代表性问题：
  - 即使 UI 文案换掉，内部仍在大量广播 `openchamber:*` 事件。
  - 本地缓存仍使用 OpenChamber 命名，会继续污染浏览器侧状态。
  - 前后端之间的更新检查接口仍带 OpenChamber 路径。
- 建议动作：
  - 把运行时事件名整组统一改名，不保留双发双收。
  - 本地存储键名直接切新名字，接受旧缓存失效。
  - 更新检查 API 路径与前端调用一起改，确保前后端单次切换完成。
- 风险：
  - 中低；如果只改一边，会直接造成监听失效、更新按钮无反应、设置同步失效。

### D3：中等难度，改包名、脚本名、工作区命名和内部运行时命名

这类改动会跨多个包和脚本联动，虽然不一定触及用户磁盘数据，但会影响开发、构建、import 路径与本地运行脚本。

- 典型范围：
  - 根包名与 workspace 包名：
    - `package.json:2` 的 `openchamber-monorepo`
    - `packages/ui/package.json:2` 的 `@openchamber/ui`
    - `packages/web/package.json:2` 的 `@openchamber/web`
    - `packages/desktop/package.json:2` 的 `@openchamber/desktop`
  - TS 路径别名：`tsconfig.json:16`、`tsconfig.json:17`、`tsconfig.json:18`
  - 代码 import：例如 `packages/web/src/api/files.ts:6`、`packages/web/src/api/git.ts:1`
  - 开发脚本与 Docker 内部命名：
    - `docker-compose.yml:2`、`docker-compose.yml:6`
    - `Dockerfile:38`
    - `packages/desktop/scripts/build-sidecar.mjs:96`
    - `packages/desktop/scripts/dev-web-server.mjs:35`
- 代表性问题：
  - 当前整个 monorepo 的包命名空间仍是 `@openchamber/*`。
  - 改掉包名之后，所有 import、打包脚本、发布脚本、构建产物命名都要跟着变。
  - Docker 与桌面 dev 脚本内部还把服务进程和容器叫做 openchamber。
- 建议动作：
  - 在 D1/D2 完成后，再集中做一次 workspace 命名重写。
  - 同一批次改 `package.json`、`tsconfig`、源码 import、脚本字符串，避免出现“包名已变但 import 还没变”的中间态。
  - Docker 的 service/container 名可以和包名一起改，不要单独先动。
- 风险：
  - 中；主要风险是构建脚本断裂、import 找不到、桌面 sidecar 开发脚本失配。

### D4：高难度，改持久化配置、环境变量与安全/集成状态文件

这类改动会碰到用户磁盘数据和服务端配置事实源，是最容易引发“应用还能启动，但状态全丢”或“某些集成无声失效”的部分。

- 典型范围：
  - 用户级配置目录与 settings：
    - `packages/ui/src/lib/openchamberConfig.ts:3`
    - `packages/ui/src/lib/openchamberConfig.ts:16`
    - `packages/ui/src/lib/openchamberConfig.ts:17`
    - `packages/ui/src/lib/openchamberConfig.ts:18`
    - `packages/desktop/src-tauri/src/main.rs:1324`
  - 项目级配置字段：
    - `projectNotes / projectTodos / projectActions / projectActionsPrimaryId`，见 `packages/ui/src/lib/openchamberConfig.ts:60`
  - Desktop settings 内部字段：
    - `desktopLocalPort`：`packages/desktop/src-tauri/src/main.rs:1345`
    - `desktopHosts`：`packages/desktop/src-tauri/src/main.rs:1389`
    - `desktopWindowState`：`packages/desktop/src-tauri/src/main.rs:1435`
  - GitHub / JWT / 微信桥接等落盘文件：
    - `packages/web/server/lib/github/auth.js:10`
    - `packages/web/server/lib/github/auth.js:11`
    - `packages/web/server/lib/security/ui-auth.js:277`
    - `packages/web/server/lib/security/ui-auth.js:280`
    - `packages/web/server/lib/wechat-bridge/index.js:8`
    - `packages/web/server/lib/wechat-bridge/index.js:9`
  - 环境变量：
    - `OPENCHAMBER_DATA_DIR`
    - `OPENCHAMBER_RATE_LIMIT_MAX_ATTEMPTS`
    - `OPENCHAMBER_RATE_LIMIT_NO_IP_MAX_ATTEMPTS`
    - `OPENCHAMBER_GITHUB_CLIENT_ID`
    - `OPENCHAMBER_GITHUB_SCOPES`
- 代表性问题：
  - 现在很多状态默认都落在 `~/.config/openchamber`。
  - 认证、限流、JWT secret、GitHub 授权、微信桥接状态都依赖这个目录。
  - 这不是简单文案替换，而是“事实源路径和环境配置约定”重命名。
- 建议动作：
  - 把这一级视为一次完整的“持久化域切换”。
  - 在开始前明确接受：旧目录数据可以直接废弃，不迁移。
  - 同批修改所有读写入口，不保留旧目录 fallback。
  - 同步更新所有文档、Docker mount、桌面 settings 读取逻辑。
- 风险：
  - 高；会直接导致配置丢失、GitHub 登录丢失、JWT 重建、微信桥接状态重置、桌面最近连接列表消失。

### D5：极高难度，改 CLI 命令、安装更新生态、二进制名与外部地址

这类改动已经超出仓库内部，涉及安装入口、发布物名称、桌面 sidecar、更新服务和仓库地址，是最后一轮才适合动的部分。

- 典型范围：
  - CLI 与安装脚本：
    - `scripts/install.sh:7`
    - `scripts/install.sh:198`
    - `packages/docs/content/docs/install.mdx:21`
    - `packages/docs/content/docs/troubleshooting.mdx:11`
  - 更新服务与发布链路：
    - `packages/web/server/lib/package-manager.js:11`
    - `packages/web/server/lib/package-manager.js:13`
    - `packages/web/server/lib/package-manager.js:19`
  - 桌面二进制和 sidecar：
    - `packages/desktop/src-tauri/Cargo.toml:2`
    - `packages/desktop/src-tauri/src/main.rs:1175`
    - `packages/desktop/src-tauri/tauri.conf.json:44`
    - `packages/desktop/scripts/build-sidecar.mjs:41`
    - `scripts/test-release-build.sh:222`
  - GitHub 仓库、Issue、Raw 文件地址：
    - `packages/desktop/src-tauri/src/main.rs:147`
    - `packages/desktop/src-tauri/src/main.rs:1609`
    - 文档中的 GitHub 链接与下载地址
  - Docker 与发行名：
    - `docker-compose.yml:2`
    - `packages/desktop/src-tauri/Cargo.lock:2672`
- 代表性问题：
  - 命令名 `openchamber`、npm 包 `@openchamber/web`、桌面可执行文件 `openchamber-desktop`、sidecar `openchamber-server` 目前是同一套生态。
  - 更新检查默认会访问 `https://api.openchamber.dev/v1/update/check`。
  - 桌面端还会拉取 OpenChamber GitHub 仓库的 changelog 和 issue 链接。
- 建议动作：
  - 必须等 D1-D4 都完成后，再统一切发行入口。
  - 这一级不要拆得过碎，建议一次性改命令名、包名、二进制名、更新 API、文档安装命令、GitHub 链接。
  - 如果未来仓库地址也要换，必须和更新 API、下载地址、issue 模板、桌面 About/反馈入口一起改。
- 风险：
  - 极高；很容易出现“本地开发能跑，但安装/升级/桌面自更新全部失效”的状态。

## 4. 建议实施顺序

### M1：先清掉用户可见 OpenChamber 痕迹

- 范围：D1
- 退出标准：
  - UI 主界面、设置入口、README、docs、desktop loading 页面都不再出现 OpenChamber 品牌。
  - 路由别名里不再保留 `openchamber`。
- 不要做的事：
  - 不要在这一阶段改磁盘目录和命令名。

### M2：再切仓库内部运行时命名

- 范围：D2
- 退出标准：
  - `openchamber:*` 事件全部完成替换。
  - 浏览器侧 localStorage / draft / PR 状态键名切到新命名。
  - 更新检查内部 API 路径完成替换。
- 不要做的事：
  - 不要同时动 workspace 包名和用户配置目录。

### M3：统一改包名与开发/构建脚本命名

- 范围：D3
- 退出标准：
  - `@openchamber/*` workspace 包名全部替换。
  - `tsconfig` 路径别名与源码 import 对齐。
  - Docker service、桌面开发 sidecar、本地 dev 脚本完成新命名切换。
- 不要做的事：
  - 不要在这一阶段处理外部安装说明和发布地址。

### M4：最后切持久化和外部生态

- 范围：D4 + D5
- 退出标准：
  - 用户配置目录、settings 文件、JWT / GitHub / 微信桥接状态目录全部切新路径。
  - 所有 `OPENCHAMBER_*` 环境变量改为新前缀。
  - CLI 命令、npm 包、桌面二进制、sidecar、更新 API、GitHub 地址全部切新命名。
- 额外要求：
  - 本阶段必须成批提交，不能拆成零碎修补。

## 5. 最值得优先删除的内容

如果只看“投入最小、收益最大”，建议优先顺序如下：

1. `packages/ui/src/constants/sidebar.ts:67` 与相关 UI 文案
2. 文档中所有 `OpenChamber`、`openchamber` 命令说明
3. `packages/ui/src/lib/router/parseRoute.ts:102` 的旧品牌 settings 别名
4. `packages/ui/src/lib/persistence.ts:898` 与相关 `openchamber:*` 事件
5. `packages/ui/src/stores/useGitHubPrStatusStore.ts:14`、`packages/ui/src/stores/useInlineCommentDraftStore.ts:209` 的本地存储键
6. `packages/ui/src/stores/useUpdateStore.ts:94` 的检查路径

## 6. 最后再动的内容

以下内容不建议在前几轮就碰：

- `~/.config/openchamber` 相关所有路径和 settings 事实源
- `OPENCHAMBER_DATA_DIR`、`OPENCHAMBER_GITHUB_*`、`OPENCHAMBER_RATE_LIMIT_*` 等环境变量
- `@openchamber/web` 包名和 `scripts/install.sh`
- `openchamber-desktop`、`openchamber-server` 二进制与 sidecar 名称
- `https://api.openchamber.dev/v1/update/check` 和 GitHub 仓库地址

## 7. 并行注意项：OpenCode 残留

虽然本文件主目标是拆 OpenChamber，但仓库里还有一批与 OpenChamber 命名强绑定的 OpenCode 残留，后续会和 D3-D5 互相影响：

- `packages/desktop/scripts/opencode-cli.mjs:14`
- `packages/desktop/scripts/opencode-cli.mjs:73`
- `packages/desktop/src-tauri/src/main.rs:1878`
- `docker-compose.yml:15`

结论：OpenChamber 改名做深之后，OpenCode 桥接相关脚本大概率要一起砍掉或改成 Pi 原生运行时，否则会留下“新品牌 + 旧 OpenCode 启动器”的错层结构。

## 8. 验收标准

- [ ] 仓库不再出现新的 OpenChamber 新增引用。
- [ ] 每一级修改完成后，都能明确说出哪些旧命名已经在代码事实层彻底消失。
- [ ] 不存在“显示层改了，但事件名/路径/持久化仍在沿用 OpenChamber”的半改状态。
- [ ] 最终完成时，OpenChamber 只允许存在于历史文档或必要的迁移记录中，不允许继续存在于运行时事实源、构建入口、发布入口、更新入口。
