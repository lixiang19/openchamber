# 发现与决策

## 需求
- 设置中增加 UI 显示控制项。
- 会话列表顶部一排按钮要能逐个控制显示。
- 顶部按钮默认隐藏。
- 右侧 `git`、`files`、`todo` 标签也要能控制显示。
- 右侧 `git` 默认隐藏。

## 研究发现
- 会话列表顶部按钮集中在 `packages/ui/src/components/session/sidebar/SidebarHeader.tsx`，包含 `worktree`、`multi-run`、`project notes`、`search sessions`、`display mode`。
- 右侧标签集中在 `packages/ui/src/components/layout/RightSidebarTabs.tsx`，当前固定渲染 `git/files/todo` 三项。
- 现有设置 UI 统一走 `packages/ui/src/components/sections/openaurora/OpenAuroraVisualSettings.tsx`，并通过 `visibleSettings` 控制在不同设置页展示哪些项。
- 持久化模式是：`useUIStore` 存运行时状态，`updateDesktopSettings()` 写入服务端 settings，`applyDesktopUiPreferences()` 在启动/同步时把服务端设置回灌到 store。
- `useUIStore` 当前已通过 zustand persist 保存大量 UI 偏好，适合继续承载本次的显示控制状态。
- `SidebarHeader.tsx` 中“Display mode”入口有两处：项目选择行右侧一处，按钮行右侧一处；隐藏 display 时两处都要一起受控。
- `setRightSidebarTab()` 已是右侧标签切换的统一入口，改这里即可同时影响标签条、快捷键和命令面板发起的切换。

## 技术决策
| 决策 | 依据 |
|----------|-----------|
| 顶部按钮与右侧标签可见性都放入 `useUIStore` | 这些都属于纯 UI 偏好，和现有 store 语义一致 |
| 同步接入 `DesktopSettings` + `persistence.ts` | 保持和其他设置项一致，避免只在 localStorage 生效 |
| 设置入口放进 `OpenAuroraVisualSettings` 的 Chat 页 | 该页已承载多项会话/侧栏显示偏好，语义最接近 |
| 顶部按钮默认值全部为隐藏 | 直接满足用户“默认隐藏”要求 |
| 右侧标签默认 `git=false, files=true, todo=true` | 满足用户仅要求 Git 默认隐藏，其他标签继续可见 |

## 遇到的问题
| 问题 | 解决方案 |
|-------|------------|
| 顶部按钮和右侧标签分散在不同组件 | 统一由 store 提供可见性状态，再分别消费 |

## 资源
- `packages/ui/src/components/session/sidebar/SidebarHeader.tsx`
- `packages/ui/src/components/session/SessionSidebar.tsx`
- `packages/ui/src/components/layout/RightSidebarTabs.tsx`
- `packages/ui/src/components/sections/openaurora/OpenAuroraVisualSettings.tsx`
- `packages/ui/src/components/sections/openaurora/OpenAuroraPage.tsx`
- `packages/ui/src/stores/useUIStore.ts`
- `packages/ui/src/lib/desktop.ts`
- `packages/ui/src/lib/persistence.ts`

## 实现结果
- `useUIStore` 新增顶部按钮与右侧标签可见性状态，默认值为顶部按钮全隐藏、右侧 Git 隐藏。
- `OpenAuroraVisualSettings` 的 Chat 页新增两组设置：`Session Sidebar Buttons`、`Right Sidebar Tabs`。
- `SidebarHeader` 现在按设置控制 `worktree`、`multi-run`、`project notes`、`search`、`display mode` 的显示。
- `RightSidebarTabs` 现在按设置过滤 `git/files/todo` 标签，并在当前标签被隐藏时自动切换到仍可见的标签。

## 视觉/浏览器发现
- `OpenAuroraVisualSettings` 已有成组 checkbox 行，适合追加“Session Sidebar Buttons”和“Right Sidebar Tabs”两个小节。
- `SidebarHeader` 的顶部按钮区和搜索输入是同一块区域，隐藏搜索按钮时也应一起隐藏搜索输入展开区。

---
*每 2 次查看/浏览器/搜索操作后更新此文件*
*这可以防止丢失视觉信息*
