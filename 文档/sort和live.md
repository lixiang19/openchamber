历史线

早期铺垫阶段
在 5228cd54 和 8a84e4ee 这一段，还没有今天这么完整的 sorted/live 双模式，主要是在补 reasoning 和 justification 的显示逻辑，为后面的“整理视图”做基础。

真正引入双模式的节点是 53004442
这个提交最关键，提交说明里直接写了 add sorted chat mode with progressive activity rendering。
当时的设计差异是明确的：
在 useUIStore.ts 这一支历史版本里，默认模式是 sorted，不是现在的 live。
在 MessageBody.tsx 的 53004442 版本里，活动区开关是：
shouldRenderActivityGroup = isSortedRenderMode && ...
也就是只有 sorted 才进 TurnActivity，live 不进。
在 MessageList.tsx 的 53004442 版本里，sorted 还会做“完成态过滤”：
只显示 completed assistant
只保留 completed assistant 对应的 activity
showTextJustificationActivity 也只在 sorted 开启

这说明当时的产品定义大概是：
live = 原始流式时间线
sorted = 按 turn 整理后的完成态视图

85713a9e 把默认值改成了 live
这个提交本身和聊天模式设计没什么强关联，提交名是“完成微信接入”，但它把 useUIStore.ts 里的默认值从 sorted 改成了 live。
关键点在于：
默认模式变了
但 MessageBody.tsx 当时仍然保留了 only sorted 才进 activity group 的门槛
也就是说，这一步只是把默认入口换成了 live，模式定义本身还没混。

真正把两者拉近的是 9d24bcc9
这个提交很关键。
在它之前，MessageBody 里还是：
shouldRenderActivityGroup = isSortedRenderMode && ...
到了这个提交，变成了：
shouldRenderActivityGroup = activityGroupSegmentsForMessage.length > 0 && ...
也就是 live 也开始进入活动区了。
这一步基本把“live 是自然时间线、sorted 是整理视图”这条分界线打穿了。

b409fe11 又继续统一了活动区表现
这个提交主要是统一 tool row、折叠行为、路径截断和 spacing。
它没有重新拉开模式差异，而是在 activity 渲染层继续做一致化。
从这一步开始，两种模式更像“同一套 turn/activity 渲染，加一点局部差异”。

所以它俩现在到底还有什么区别
结合当前代码，真正还算“有意义”的差异只剩这几个：

sorted 会生成 justification activity
入口在 MessageList.tsx，只在 sorted 传入 showTextJustificationActivity。

sorted 更弱化流式感
在 AssistantTextPart.tsx 里，sorted 会禁用 streaming text animation。
在 ReasoningPart.tsx 里，sorted 不显示 duration。

reasoning 的视觉呈现不同
在 MessageBody.tsx 里，sorted 用正式的 ReasoningPart block，live 则更像轻量内联 thinking 文本。

但这些都属于“弱差异”，不是“信息架构差异”。

我的判断
如果按 git 历史倒推，原始设计其实是：

live：时间流优先，过程直接铺开
sorted：结果优先，把过程整理进 activity，正文更偏完成态
后来发生了三件事，把它们搞得越来越像：

默认模式改成了 live
live 也开始走 activity grouping
我这次又把 sorted 的内容过滤去掉了
说明：
这一步不是把差异抹平，而是把错误移除。因为“模式切换导致模型头、工具数量、正文消失”属于渲染 bug，不属于设计差异。
所以现在的真实状态可以概括成一句话：

这两个模式曾经是“信息组织不同”，现在基本退化成“同一套渲染骨架上的几个显示细节开关”。

如果你要，我下一步可以直接按历史意图把它们重新拉开，而且不是拍脑袋，是按这条历史线恢复成更自洽的定义：

live 回到纯时间流，不进活动区
sorted 保留 activity 整理视图，但不再丢内容
两者在视觉和信息结构上重新形成明显差异
如果你点头，我就直接按这个方向改。