# Pi Web Runtime 对话与渲染 PRD

## 1. Introduction / Overview

本 PRD 定义 OpenAurora Web 从现有 OpenCode 会话链路迁移到 Pi runtime 的产品需求。目标不是继续把 Pi 伪装成 OpenCode 后端，而是在 `packages/web` 内直接托管 Pi SDK 会话，把 Web 前端的消息摄取、状态归并和渲染输入重建为面向 Pi 事件模型的实现。

本期规划范围按“较完整的 Pi Web 接入版本”收敛，但严格排除 `question`、`permission`、`extension UI` 等交互能力，不为旧链路保留协议兼容层。用户最终看到的结果应是：Web 可以基于 Pi 完成稳定对话、流式文本展示、工具执行过程展示、工具结果展示、基础子代理摘要展示，以及围绕会话状态的可靠收敛。

## 2. Goals

- 让 Web 端以 Pi 作为唯一会话执行 runtime，不再依赖 OpenCode 的 `/api/* + SSE + SDK Part` 协议假设。
- 在前端建立独立于 OpenCode SDK 类型的消息领域模型，统一承接用户消息、assistant 文本、reasoning、工具执行和结果展示。
- 让一次完整会话稳定覆盖“发送消息 -> Pi 执行 -> 事件流归并 -> UI 渲染 -> 回合结束”。
- 明确首期不支持的交互边界，避免为了兼容旧模型而引入补丁式设计。
- 在不扩展前端 provider/model/agent 控制面的前提下，保留 Pi runtime 自主决策边界。
- 交付可被后续 AI 代理直接实施的、粒度清晰的用户故事与验收标准。

## 3. User Stories

### US-001: Web 用户发起 Pi 对话
**Description:** 作为 Web 用户，我希望在聊天输入框发送消息后，由 Pi runtime 直接接管本轮会话执行，这样我可以在浏览器里完成真实的 Pi 对话。

**Acceptance Criteria:**
- [ ] 前端发送入口改为面向 Pi 会话接口，而不是继续调用 OpenCode `prompt_async` 风格接口。
- [ ] 服务端可根据会话上下文创建或复用 Pi `AgentSession`，并接受本轮 prompt。
- [ ] 用户消息提交后，前端立即出现本轮用户消息占位，并进入流式中的会话状态。
- [ ] 当 Pi 会话启动失败时，前端收到明确错误状态，不做静默兜底重试。
- [ ] 在浏览器中验证：发送一条纯文本消息后，能够看到会话开始并进入流式状态。
- [ ] `bun run lint` 与 `bun run type-check` 通过。

### US-002: Assistant 文本与推理内容流式展示
**Description:** 作为 Web 用户，我希望 assistant 的文本内容能随 Pi 事件流逐步显示，这样我可以实时看到回答生成过程。

**Acceptance Criteria:**
- [ ] 前端消息模型支持把 Pi `message_start`、`message_update`、`message_end` 归并为单条 assistant 消息。
- [ ] 文本增量按顺序追加，不出现重复片段、错位覆盖或多条消息意外拆分。
- [ ] 若 Pi 暴露 reasoning 类内容，前端可作为独立 part 建模并按产品决策展示或折叠。
- [ ] 回合结束后，assistant 消息状态从 `streaming` 收敛到 `completed` 或 `error`。
- [ ] 在浏览器中验证：一条需要较长生成时间的消息能持续流式更新直至结束。
- [ ] `bun run lint` 与 `bun run type-check` 通过。

### US-003: 工具执行状态与结果可见
**Description:** 作为 Web 用户，我希望看到 Pi 在会话中调用了哪些工具、执行到了什么阶段、最终产生了什么结果，这样我可以理解 agent 做了什么。

**Acceptance Criteria:**
- [ ] 前端可展示工具开始、执行中、完成、失败四类状态。
- [ ] 工具名称、调用标识、输入摘要、输出摘要和错误信息有稳定的数据结构可供渲染。
- [ ] 现有工具展示组件可复用或被等价替换，但不能继续依赖 OpenCode 原始 `Part` 结构。
- [ ] 工具结果写入 assistant 消息或关联 part 后，刷新页面时不会导致同一工具结果重复归并。
- [ ] 在浏览器中验证：执行至少一次 `read` 或 `bash` 工具调用时，界面可见完整状态变化与结果摘要。
- [ ] `bun run lint` 与 `bun run type-check` 通过。

### US-004: 子代理摘要可被会话消息消费
**Description:** 作为 Web 用户，我希望当 Pi 触发子代理或任务型工具时，聊天界面可以显示基础摘要，这样我能理解任务链路的推进情况。

**Acceptance Criteria:**
- [ ] 会话消息模型支持记录子代理/任务型工具的摘要字段和阶段状态。
- [ ] 现有 `ToolPart` 或替代组件可展示基础子代理摘要，不要求完整复刻 Pi TUI。
- [ ] 若子代理有最终总结文本，前端能够以工具结果或附加摘要形式展示。
- [ ] 在浏览器中验证：包含子代理摘要的回合能够正常展示，不出现空白 part 或崩溃。
- [ ] `bun run lint` 与 `bun run type-check` 通过。

### US-005: 会话状态与中断行为可收敛
**Description:** 作为 Web 用户，我希望在 Pi 会话结束、失败或被中断时，界面状态能正确收敛，这样我不会看到卡死的“仍在生成中”状态。

**Acceptance Criteria:**
- [ ] 服务端能明确下发回合结束、agent 结束和会话中断事件。
- [ ] 前端流式状态机至少覆盖 `idle`、`streaming`、`completed`、`error`、`aborted`。
- [ ] 网络中断、会话异常、用户取消时，消息状态与输入框状态都能同步恢复。
- [ ] 未支持事件不会打断已存在的消息列表渲染，而是进入日志或调试事件通道。
- [ ] 在浏览器中验证：中断一次流式会话后，界面可以恢复可继续发送的状态。
- [ ] `bun run lint` 与 `bun run type-check` 通过。

### US-006: Web 彻底摆脱 OpenCode 协议绑定
**Description:** 作为维护者，我希望 Web 端的会话主链路不再依赖 OpenCode 协议和类型，这样后续 Pi 能力扩展不会被兼容层长期锁死。

**Acceptance Criteria:**
- [ ] `packages/web` 的新会话主入口以 Pi runtime 为中心建模，而不是先翻译为 OpenCode API 再处理。
- [ ] `packages/ui` 的主消息领域模型不再直接持有 `@opencode-ai/sdk` 的 `Message` / `Part` 作为渲染真相来源。
- [ ] 与聊天主链路强耦合的 OpenCode 事件消费逻辑被替换或降级为非主路径实现。
- [ ] PRD 实施完成后，Pi 作为 Web 默认会话链路时不需要额外协议兼容层。
- [ ] 在浏览器中验证：默认 Web 对话链路运行于 Pi，而不是旧的 OpenCode prompt/event 语义。
- [ ] `bun run lint` 与 `bun run type-check` 通过。

## 4. Functional Requirements

1. FR-1: 系统必须在 `packages/web` 内直接托管 Pi SDK 会话能力，并以此作为 Web 唯一会话执行 runtime。
2. FR-2: 系统必须提供面向 Pi 的消息发送接口，输入至少支持文本消息，并允许扩展到文件输入。
3. FR-3: 系统必须提供面向 Pi 的会话事件流接口，前端只消费稳定的 Web 会话语义事件。
4. FR-4: 前端必须定义独立消息模型，至少支持 `user`、`assistant`、`system` 三类消息角色。
5. FR-5: 前端消息 part 必须至少支持 `text`、`reasoning`、`tool`、`custom` 四类语义。
6. FR-6: 系统必须把 Pi 的消息事件归并为稳定的 UI 渲染输入，不能把原始 Pi 事件对象直接泄漏给视图组件。
7. FR-7: 系统必须把 Pi 的工具事件归并为稳定的工具执行状态模型，包含 `pending`、`running`、`completed`、`error`。
8. FR-8: 系统必须支持回合结束、agent 结束和异常中断后的状态收敛。
9. FR-9: 系统必须对未知事件进行显式记录，并保证消息列表不会因此崩溃。
10. FR-10: 系统必须复用共享包能力，优先把通用消息模型和归并逻辑放在 `packages/ui` 或共享 workspace 包中，而不是复制实现。
11. FR-11: 系统必须保持 provider、model、agent 的实际决策边界在 Pi runtime 内，不在本期把该控制面下沉给 Web 前端。
12. FR-12: 系统必须将 OpenCode 协议依赖从聊天主链路中移除，而不是通过长期兼容翻译层保留。
13. FR-13: 系统必须支持基础子代理摘要展示，但不要求实现 Pi TUI 的全部交互能力。
14. FR-14: 系统必须为日志、性能与归并异常提供最小可观测性信息。

## 5. Non-Goals (Out of Scope)

- 不实现 `question`、`permission` 相关的前端交互、确认流程或 UI。
- 不实现 `ctx.ui`、`extension_ui_request`、`setWidget`、`setStatus`、`select`、`input` 等扩展交互能力。
- 不在本期把 provider、model、agent 选择器开放给 Web 前端。
- 不继续维护“Pi 伪装成 OpenCode 后端”的兼容策略。
- 不覆盖桌面端、VS Code 扩展端的宿主接入改造，本 PRD 仅针对 Web 运行时。
- 不追求完整复刻 Pi CLI/TUI 的视觉和交互体验。

## 6. Design Considerations

- 聊天消息渲染层应尽量复用现有组件，但输入数据必须切换为新的中立消息模型。
- 对用户可见的工具状态需要保持顺序稳定，避免流式中闪烁或重复插入。
- 对 reasoning 内容的视觉表现可以采取折叠或弱化样式，但数据模型必须先具备承载能力。
- 会话状态反馈应简洁明确，重点是“正在生成 / 已结束 / 出错 / 已中断”四类用户感知。
- 所有文案与状态标签应与当前 Web 中文化方向一致。

## 7. Technical Considerations

- `packages/web` 负责 Pi runtime 宿主与会话接口，不应把核心消息归并逻辑散落在服务器临时处理代码里。
- `packages/ui` 负责消息领域模型、事件归并器、状态投影与渲染输入，保证 Web 宿主外的复用可能。
- 需要显式梳理 `AgentSessionEvent` 到 Web UI 语义事件的映射表，避免在多个组件中各自解释同一事件。
- 需要对消息、工具、子代理摘要建立稳定 id 规则，避免流式过程中出现重复 part。
- 需要定义会话生命周期状态机，统一处理正常结束、异常结束和手动中断。
- 由于仓库没有稳定单元测试命令，本期质量门禁以 `bun run lint` 与 `bun run type-check` 为主，并补充可执行的浏览器手工验证步骤。

## 8. Success Metrics

- 默认 Web 会话链路成功切换到 Pi，且一次对话可稳定完成文本流式展示。
- 至少 95% 的常见工具调用回合能正确展示开始、执行中、结束与结果摘要。
- 未知事件不会造成消息列表崩溃，相关问题可通过日志定位。
- 用户完成一轮 Pi 对话时，界面中不再暴露 OpenCode 特有的协议状态或错误语义。
- 维护者可明确指出聊天主链路中 OpenCode 类型和协议依赖已被移除。

## 9. Open Questions

- reasoning 内容在 Web 中是默认展示、默认折叠，还是仅在调试模式可见，仍需产品决策。
- 文件输入在本期是否只保留已有上传结构，还是同步重构为 Pi 原生输入模型，仍需实施时确认。
- 会话历史持久化与重连策略是否在本期一起纳入，还是先以单页会话稳定为主，仍需排期决策。
- 子代理摘要的字段粒度是否完全采用 Pi 原始摘要，还是需要在 Web 侧再做统一摘要格式，仍需细化。

## 10. Milestones

### M1: 建立 Pi 导向的消息领域模型
- 目标：把前端消息真相源从 OpenCode `Message/Part` 切换为独立消息模型。
- 交付结果：共享消息类型、part 类型、归并器接口、会话状态机定义落地。
- 完成标准：消息列表与工具展示组件可以只消费新模型，不再依赖 OpenCode 原始 part。

### M2: 接入 Pi Web 会话 runtime
- 目标：在 `packages/web` 内创建 Pi 会话入口、prompt 提交链路与事件流输出。
- 交付结果：服务端可驱动一次真实 Pi 会话并把事件流传给前端。
- 完成标准：从浏览器发送消息后，能看到 assistant 文本和工具状态流式更新。

### M3: 完成端到端收敛与默认切换
- 目标：补齐异常、中断、未知事件和子代理摘要展示，并让 Pi 成为 Web 默认链路。
- 交付结果：会话状态收敛、错误展示、日志与手工验证路径齐备。
- 完成标准：文本对话、工具调用、子代理摘要三类场景均可稳定演练。
