# 进度日志

## 会话：2026-03-20

### 第 1 阶段：需求与方案收敛
- **状态：** complete
- **开始时间：** 2026-03-20
- 已采取的操作：
  - 梳理项目列表、settings 同步、首次启动提示与新增项目入口
  - 确认默认模板实例使用可见目录 `~/OpenAurora/OpenAurora Home`
  - 收敛为“服务端 bootstrap + 统一项目创建对话框 + 模板创建 API”方案
- 创建/修改的文件：
  - `long_task/project-template-bootstrap/task_plan.md` (创建)
  - `long_task/project-template-bootstrap/findings.md` (创建)
  - `long_task/project-template-bootstrap/progress.md` (创建)

### 第 2 阶段：实现
- **状态：** complete
- 已采取的操作：
  - 新增内置项目模板目录 `packages/web/server/project-template/openaurora-home/`
  - 新增服务端模板复制模块 `packages/web/server/lib/projects/template.js`
  - 在 `GET /api/config/settings` 前加入默认项目 bootstrap，使首次启动自动生成 `~/OpenAurora/OpenAurora Home`
  - 新增 `POST /api/projects/create-from-template`，用于从模板创建项目并自动注册到项目列表
  - 新增 `ProjectCreateDialog` 与 `TemplateProjectDialog`
  - 将导航栏、项目设置页、移动端、菜单动作统一改为打开项目创建对话框
  - 将空项目首次提示由“直接打开文件夹”改为“打开项目创建对话框”
- 创建/修改的文件：
  - `packages/web/server/project-template/openaurora-home/README.md` (创建)
  - `packages/web/server/project-template/openaurora-home/.gitignore` (创建)
  - `packages/web/server/project-template/openaurora-home/.opencode/*` (创建)
  - `packages/web/server/project-template/openaurora-home/docs/README.md` (创建)
  - `packages/web/server/project-template/openaurora-home/notes/README.md` (创建)
  - `packages/web/server/lib/projects/template.js` (创建)
  - `packages/web/server/index.js` (修改)
  - `packages/ui/src/stores/useProjectsStore.ts` (修改)
  - `packages/ui/src/lib/sessionEvents.ts` (修改)
  - `packages/ui/src/components/session/SessionDialogs.tsx` (修改)
  - `packages/ui/src/components/session/ProjectCreateDialog.tsx` (创建)
  - `packages/ui/src/components/session/TemplateProjectDialog.tsx` (创建)
  - `packages/ui/src/components/layout/NavRail.tsx` (修改)
  - `packages/ui/src/components/sections/projects/ProjectsSidebar.tsx` (修改)
  - `packages/ui/src/components/mobile/MobileChatShell.tsx` (修改)
  - `packages/ui/src/components/chat/MobileSessionStatusBar.tsx` (修改)
  - `packages/ui/src/components/session/SessionSidebar.tsx` (修改)
  - `packages/ui/src/hooks/useMenuActions.ts` (修改)

### 第 3 阶段：验证与收尾
- **状态：** complete
- 已采取的操作：
  - 运行 `bun run type-check`
  - 运行 `bun run lint`
  - 运行 `bun run build`
  - 记录仅有既有的构建 chunk warning，无新增失败
- 创建/修改的文件：
  - `long_task/project-template-bootstrap/task_plan.md` (更新)
  - `long_task/project-template-bootstrap/findings.md` (更新)
  - `long_task/project-template-bootstrap/progress.md` (更新)

## 测试结果
| 测试 | 输入 | 预期 | 实际 | 状态 |
|------|-------|----------|--------|--------|
| Type check | `bun run type-check` | 所有 workspace 类型检查通过 | 通过 | ✓ |
| Lint | `bun run lint` | 所有 workspace lint 通过 | 通过 | ✓ |
| Build | `bun run build` | 所有 workspace 构建成功 | 通过（仅有既有 chunk warning） | ✓ |

## 错误日志
| 时间戳 | 错误 | 尝试次数 | 解决方案 |
|-----------|-------|---------|------------|
|           |       | 1       |            |

## 5问重启检查
| 问题 | 回答 |
|----------|--------|
| 我在哪里？ | 第 3 阶段之后，已完成实现与验证 |
| 我要去哪里？ | 向用户交付并根据反馈迭代模板内容 |
| 目标是什么？ | 默认模板项目自动生成 + 新增项目双模式 |
| 我学到了什么？ | settings 首次同步是最合适的 bootstrap 时机，统一创建对话框能收敛多入口逻辑 |
| 我做了什么？ | 完成服务端 bootstrap、模板创建 API、前端创建对话框与全链路接入 |
