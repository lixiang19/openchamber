# 发现与决策

## 需求
- 新建一个仓库内的 `opencode` 配置目录，包含 `opencode.json`、`agent`、`skill` 等内容。
- 在设置界面增加一个新页面或分区，提供“覆盖式安装”按钮。
- 点击后，将仓库内模板目录覆盖式写入用户本地 `~/.config/opencode`。
- 提供“上传文件夹”能力，用户选择一个本地文件夹后，将该文件夹内容覆盖式写入同一目标目录。
- 这是长期改造的第一个任务，需要留下可持续扩展的实现结构。

## 研究发现
- 设置页入口由 `packages/ui/src/lib/settings/metadata.ts` 注册，主渲染在 `packages/ui/src/components/views/SettingsView.tsx`。
- 单页型设置可直接挂到 `SettingsView.tsx` 的 `renderPageContent`，无需额外 sidebar。
- OpenCode 用户配置根目录常量已在 `packages/web/server/lib/opencode/shared.js` 中定义为 `~/.config/opencode`。
- 现有 skills 安装逻辑 `packages/web/server/lib/skills-catalog/install.js` 已有 `copyDirectoryNoSymlinks`，可复用其无软链复制与路径穿越保护思路。
- 桌面端已有原生目录选择能力，入口在 `packages/ui/src/lib/desktop.ts` 的 `requestDirectoryAccess()`。
- 服务端已有 `/api/fs/*` 与 `/api/config/*` 模式，适合新增专用配置安装接口，而不是让前端拼装大量文件写入请求。
- `/api/config/*` 只有白名单路由会自动走 JSON body 解析，因此新增 `/api/config/opencode/*` 时需要同步扩展中间件白名单。
- `packages/web/package.json` 的发布文件列表包含整个 `server/` 目录，因此放在 `packages/web/server/opencode-template/` 的模板资源会随产物一起发布。

## 技术决策
| 决策 | 依据 |
|----------|-----------|
| 新功能作为独立设置页接入 Settings 导航 | 用户要求“设置界面增加一个界面”，独立页面更清晰，也方便后续扩展更多平台定制能力 |
| 覆盖安装由服务端专用接口执行 | 目标目录在用户主目录下，服务端更适合集中做路径校验、覆盖策略与错误返回 |
| 目录复制逻辑优先抽成服务端共享工具 | 仓库模板安装与用户上传目录安装都需要同一套安全复制/清理语义 |
| 预置模板目录放在 `packages/web/server/opencode-template/` | `packages/web/package.json` 只会打包 `server`/`dist`/`public` 等目录，模板必须位于可分发路径内 |
| 上传目录优先走“桌面端原生选目录 + 非桌面端文件夹上传”双通路 | 这样既能在本机桌面端保留真实目录复制，也能给浏览器运行时保留可用入口 |
| 覆盖安装采用“清空目标目录后重建” | 用户明确要求覆盖式安装，只有整体替换才能保证旧配置残留不会污染新模板 |
| 目标目录替换采用“先构建 staging，再 rename 替换” | 这样比直接删除后复制更可靠，安装失败时可以尽量恢复原目录 |

## 遇到的问题
| 问题 | 解决方案 |
|-------|------------|
| 如何让模板在生产构建后仍可访问 | 将模板放入 `packages/web/server/` 下，由服务端模块通过相对路径解析 |

## 资源
- `packages/ui/src/lib/settings/metadata.ts`
- `packages/ui/src/components/views/SettingsView.tsx`
- `packages/ui/src/components/sections/opencode-config/OpencodeConfigInstallPage.tsx`
- `packages/ui/src/components/sections/openaurora/OpenAuroraPage.tsx`
- `packages/ui/src/components/sections/openaurora/OpenCodeCliSettings.tsx`
- `packages/ui/src/lib/desktop.ts`
- `packages/web/server/lib/opencode/DOCUMENTATION.md`
- `packages/web/server/lib/opencode/install.js`
- `packages/web/server/opencode-template/`
- `packages/web/server/lib/opencode/shared.js`
- `packages/web/server/lib/skills-catalog/DOCUMENTATION.md`
- `packages/web/server/lib/skills-catalog/install.js`

## 视觉/浏览器发现
- 当前 Settings 导航已支持新增单页设置入口，导航图标和顺序都在 `SettingsView.tsx` 内集中维护。
- OpenAurora 现有设置页普遍采用简洁标题、紧凑表单、按钮+辅助说明的样式，不需要额外卡片层级。

---
*每 2 次查看/浏览器/搜索操作后更新此文件*
*这可以防止丢失视觉信息*
