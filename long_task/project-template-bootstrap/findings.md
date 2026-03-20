# 发现与决策

## 需求
- 提供一个内置项目模板
- 用户启动应用时自动把模板写入一个默认路径
- 左侧项目列表直接显示这个默认项目
- “新增项目”不再只有打开文件夹，还要支持“使用模板创建文件夹作为项目”

## 研究发现
- 项目列表核心状态在 `packages/ui/src/stores/useProjectsStore.ts`
- 前端启动时会先执行 `packages/ui/src/main.tsx` 中的 `syncDesktopSettings()`，再渲染应用
- 设置读取来自 `GET /api/config/settings`，实现位于 `packages/web/server/index.js`
- 空项目时当前会在 `packages/ui/src/components/session/SessionDialogs.tsx` 自动弹目录选择
- 当前多个入口都直接走“打开文件夹”，包括 `NavRail`、`ProjectsSidebar`、移动端状态栏和菜单动作
- 只要在 settings 首次读取前完成 bootstrap，左侧项目列表就能直接显示默认项目，不需要额外前端迁移逻辑
- `packages/web/package.json` 会带上 `server/` 目录资源，因此项目模板放在 `packages/web/server/project-template/` 即可随构建产物发布

## 技术决策
| 决策 | 依据 |
|----------|-----------|
| 将默认项目 bootstrap 放在服务端 settings 读取前 | 前端无需额外等待第二次同步，首屏即可拿到项目列表 |
| 为项目模板新增独立服务端模块 | 复用安全复制逻辑，但不把“项目模板”与“OpenCode 配置安装”耦合在一起 |
| 统一新增项目入口为“项目创建对话框” | 能同时承载“打开现有文件夹”和“使用模板创建项目”两条路径，并适配首屏无项目状态 |
| 模板创建 API 接受绝对路径/`~` 路径，并自动创建缺失父目录 | 让默认 `~/OpenAurora` 路径与手动输入的新父目录都能一次成功 |

## 遇到的问题
| 问题 | 解决方案 |
|-------|------------|
| 多个入口分别直接打开文件夹选择器 | 收敛为事件驱动的统一项目创建对话框 |
| 默认项目不能反复自动重建 | 通过持久化 bootstrap 状态只执行一次 |

## 资源
- `packages/ui/src/main.tsx`
- `packages/ui/src/stores/useProjectsStore.ts`
- `packages/ui/src/components/session/SessionDialogs.tsx`
- `packages/ui/src/components/session/ProjectCreateDialog.tsx`
- `packages/ui/src/components/session/TemplateProjectDialog.tsx`
- `packages/web/server/index.js`
- `packages/web/server/lib/projects/template.js`
- `packages/web/server/lib/opencode/install.js`

## 视觉/浏览器发现
- 新的项目创建入口适合用双卡片选择，而不是继续直接跳文件夹选择器
- 模板创建对话框需要显示“父目录 + 项目名 + 最终路径预览”三个关键信息
