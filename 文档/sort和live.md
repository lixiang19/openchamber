# sort 和 live

当前只保留 3 个明确状态，不再引入 activity group、activity summary、过程态额外分组这些中间层。

## 1. live 实时态

- assistant 消息按原始到达顺序直接显示
- 文本消息、工具消息、task 消息都一样处理
- 对话进行中不折叠，不替换，不整理

也就是说，live 的过程就是“来了什么就显示什么”。

## 2. sorted 实时态

- assistant 区只保留一个显示槽位
- 不管新来的是文本还是工具，都是最新一条 assistant 消息直接替换当前槽位
- 过程中不显示旧的 assistant 消息链

也就是说，sorted 的过程就是“永远只看当前最新一步”。

## 3. 对话完成态 / 恢复态

两种模式最终完全一致：

- 只展开显示该 turn 最后一条有可见文本的 assistant 消息
- 更早的 assistant 消息全部收进同一个折叠区
- 折叠区不是逐条摘要，而是一条总入口
- 入口文案形态为：`———————— 13 条消息 ————————`
- 点击后展开的内容，必须等于 live 过程中看到的原始 assistant 消息流

如果该 turn 没有任何文本消息：

- 最后一条 assistant 消息作为展开消息
- 其它 assistant 消息进入总折叠区

## 4. 恢复对话规则

- 重新打开会话或切回会话时，已完成 turn 一律恢复为默认折叠终态
- 不记住上次临时展开状态

## 5. 实现约束

- 不再生成 activityParts / activitySegments
- 不再做 assistant chain merge
- 不再让 chatRenderMode 影响文本、reasoning、工具的样式
- chatRenderMode 只影响 streaming 阶段 assistant 消息的可见策略

## 6. 性能方向

这次改造的目标不是再加一层“整理逻辑”，而是删掉多余层：

- turn projection 只保留原始 turn 数据
- MessageList 只做可见性决策，不再做 activity 聚合
- ChatContainer 统一构建一次 projection，列表和时间线共享
- 恢复态直接渲染终态，不再重新推导历史展示结构
