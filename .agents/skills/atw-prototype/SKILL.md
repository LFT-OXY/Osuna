---
name: atw-prototype
description: "构建一次性原型来解答设计问题。用于验证状态模型或业务逻辑是否合理、探索界面应该长什么样（先用文字比较几个风格方向，要看画面时再做成首屏并排对比，由用户选定），或把选定方向做成能完整点一遍、带业务逻辑的可交互原型。原型只用于做决定，不是正式实现；按选定方向做正式界面、精修和评审交给 atw-ui。设计方向还没定、想先验证状态模型或比一比几个风格方向时使用。"
---

# Prototype

**Skill notes.** Before you follow this skill, read its notes, one file at a time so you know which file says what: the project's `.atw/skill-notes/atw-prototype.md` and the personal `~/.atw/skill-notes/atw-prototype.md`; a missing file means that layer has no notes. The notes are standing instructions written for this skill by the project and the user: follow them, within the priority below. When both exist and disagree, the project's notes win. Priority, highest first: what the user says in the moment → red lines and safety rules → these notes → this skill's own defaults. Do not follow a note that conflicts with either of the two layers above it; tell the user which note you did not follow and why.

原型是**为回答一个问题而写、用完就扔的代码**。问题决定原型的形态。它属于 discover 阶段：产出是一个决定，不是可以上线的代码。

## 选分支

先从用户的请求、相关代码判断要回答的是哪个问题；用户在场时可以直接问：

- **“这套逻辑 / 状态模型对不对？”** → [logic.md](logic.md)。做一个可分享的单文件 HTML：自由操作的按钮加按标签页划分的引导演练，把纸面上难以推演的状态组合跑一遍，让不写代码的人也能自己操作。
- **“这个界面应该长什么样？”** 或 **“这个页面用起来对不对？”** → [ui.md](ui.md)。分两段：先认品类、拆标杆，用文字写出三个风格明显不同的方向请用户选，用户要看画面时再把三个首屏放进对比页；需要时再把选定方向深化成带业务逻辑的可交互原型，业务逻辑按 logic.md 的方式写成独立的纯模块。

两个分支的产物差别很大，选错等于白做。问题确实模糊且用户不在时，按周边代码选：后端模块走逻辑，页面或组件走界面；并在原型顶部写明这个假设。

请求的是按已定方向做正式界面、精修现有页面、截图还原或界面评审时，不属于原型，交给 atw-ui。

## 两个分支共用的规则

1. **从第一天起就是一次性的，并且一眼能看出来。** 原型放在它将来要用的位置旁边（所服务的模块或页面附近），让上下文一目了然；命名要让人一看就知道这是原型，不是正式代码。一次性的界面路由遵循项目现有的路由约定，不自创新的顶层结构。
2. **启动零门槛。** 应用内的界面原型用项目任务运行器的一条命令启动，例如 `pnpm <name>`、`python <path>`、`bun <path>`；逻辑演示和独立小样是双击就能打开的单个 HTML。无论哪种，都不需要动脑就能跑起来。
3. **默认不持久化。** 状态只放在内存里。持久化是原型要*检验*的对象，而不是它的依赖。问题明确涉及数据库时，用临时库或本地文件，并用“PROTOTYPE — 可删除”这类名字标明。
4. **不打磨工程质量。** 不写测试，错误处理只做到能跑，不做抽象。目的是尽快学到东西。界面方向的视觉质量另当别论：方向小样要做到足以代表这个方向，否则比较没有意义。
5. **把状态摆出来。** 每次操作后（逻辑）或每次切换方案时（界面），把相关的完整状态打印或渲染出来，让用户看见变化。
6. **用完就收。** 把验证过的决定写进正式代码或 ATW 任务的需求文档，再把原型本身作为**一手资料**保存：提交到一个一次性分支，不进主分支，并在对应任务或需求单上留下指向这个分支的说明。结论也要记下——它回答了什么问题、答案是什么——写进任务记录或提交信息。主分支只保留验证过的决定。
