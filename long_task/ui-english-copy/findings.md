# 发现与决策

## 需求
- 将界面中直接显示给用户的中文改为英文。
- 保持现有功能和交互不变。
- 完成类型检查、lint 和 build 验证。

## 研究发现
- `packages/ui/src/components/mobile/MobileChatShell.tsx` 是中文最集中的界面文件，包含移动端页面标题、按钮、空状态、相对时间和 toast。
- `packages/ui/src/components/views/InboxView.tsx` 包含收件箱筛选开关的 `aria-label`、项目选择 placeholder、会话默认标题和空状态文案。
- `packages/ui/src/components/layout/NavRail.tsx` 包含 “收件箱” 按钮、tooltip 与 `aria-label`。
- `packages/ui/src/lib/projectTodoFile.ts` 包含会显示到界面的错误消息，需要一并改英文。
- `packages/ui/src/components/sections/openaurora/VoiceSettings.tsx` 中 `zh-CN` 语言标签当前为“中文”。
- 当前未发现独立 i18n 文案文件；中文主要是直接硬编码在组件中。
- 二次搜索后，剩余中文只在 `VoiceSettings.tsx` 的 `日本語` 语言名与 `SessionAuthGate.tsx` 注释中；均不属于“界面上的中文”范围。

## 技术决策
| 决策 | 依据 |
|----------|-----------|
| 使用全仓库中文字符搜索确认范围 | 当前没有集中式 i18n 文件 |
| 将 `MobileChatShell` 的日期格式 locale 从 `zh-CN` 改为英文 locale | 避免日期格式继续输出中文 |
| 保持其他非中文本地化语言名不变 | 请求仅针对中文界面文案 |

## 遇到的问题
| 问题 | 解决方案 |
|-------|------------|
| 范围可能遗漏服务端/客户端错误提示 | 同时搜索 `packages/ui/src/lib` 并纳入修改范围 |
| 搜索结果包含注释与非中文本地化标签 | 复查文件内容后按用户可见范围筛除 |

## 资源
- `packages/ui/src/components/mobile/MobileChatShell.tsx`
- `packages/ui/src/components/views/InboxView.tsx`
- `packages/ui/src/components/layout/NavRail.tsx`
- `packages/ui/src/lib/projectTodoFile.ts`
- `packages/ui/src/components/sections/openaurora/VoiceSettings.tsx`

## 视觉/浏览器发现
- 本轮未使用浏览器。

---
*每 2 次查看/浏览器/搜索操作后更新此文件*
