# 03 — 四条过时断言跟上有意的行为变更

**What to build:** 四个功能各自有意改了行为，断言没跟上。让它们重新对准原本要验的行为：Explorer rail 菜单里 `Session history` 和内置视图一样可开关；外观设置选「跟随系统」时的深浅配对行不再让主题下拉选择器撞车；插件贡献的主题能被选中、生效、并在插件移除后回落；桌面端设置页能轮转到每一个栏目而不泄漏已关闭的视图。

**Status:** ready-for-agent
**Impl:** done

**Blocked by:** 无 —— 可以立刻开始

依据：prd.md「测试改动」第 1、2、3、5 条；归因见 research/failure-attribution.md
第 1、2、3、6 条，四条的实际报错原文与本地复跑结果都在那里。

四条都是断言跟上一个有意的行为变更，都不涉及判断，所以合成一张。

- [x] Explorer rail 菜单的期望列表补入 `Session history`（位置在 `Files` 之后、插件面板之前），
      并让这条断言表达「内置视图在前、插件面板在后」的分组意图，而不是一串死字符串 ——
      下次再加内置视图时不该又改一次列表。
- [x] 设置页 Escape 那条里，主题下拉的定位改成指明是哪一行的精确标签，与同目录既有 e2e
      的写法一致。
- [x] 插件主题夹具的两套贡献主题改用不会和内置主题撞名的名字，随之更新文字选择器与
      `Theme: {{name}}` 断言。夹具的配色值不改 —— 这条测试验的是贡献的语义 token
      有没有真的传到界面上。
- [x] 桌面端设置栏目清单里的 `Usage` 改成 `Price table`。本地 macOS 跑不完这条：
      `rotateSettings` 在读清单之前就卡在找不到 `Settings` 按钮
      （`settings-memory.electron.mjs:55`），而 CI 是过了这一步、停在 `Usage` 那一项上的，
      所以这条由 CI 验。
- [x] 四条各自在原文件原位置改，不新增测试文件、不新增 npm script、不新增 CI job。
- [x] `npm run typecheck`、`npm run lint` 通过。
