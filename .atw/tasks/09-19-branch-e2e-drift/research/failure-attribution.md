# 六条 CI 失败的逐条归因

证据来源：run 35447883355（分支第二轮）、run 35445391971（基线）、本地复跑。

## 基线到底是什么

`origin/main` 是 fork 同步上游的 main（tip `0f20e6dfe`，带上游 PR 号），**不含**本地 13 个功能。
本地 `main`（tip `0f1283bc5`）领先 `origin/main` 55 个 commit 且从未推送。
所以"main 基线全绿"说的是**上游代码全绿**，不是"这些功能在 main 上是绿的"。
本地 main 上的功能是随 `feat/usage-stats` 第一次进 CI 的 —— fork 的 Actions 今天才开。

## 逐条

### 1. explorer-plugin-menu:10 — 测试该改

`helpers/explorer-plugin-menu.ts:106` 用 `toHaveText([...])` 钉死 7 项菜单。
本地复跑实际收到 8 项，多出来的是 `"Session history"`，插在 `"Files"` 之后：

```
"New tab", "Changes", "Files", "Session history",
"Other review", "Other review summary", "Review", "Review summary"
```

来源 `00a6b9a39`：`SUPPORTING_LAUNCH_ORDER` 末尾加了 `sessionHistory`，
它是单例视图（`toggleTarget !== null`），所以进了 rail 菜单。功能是故意的。

### 2. settings-navigation:115 — 测试该改

`page.getByLabel(/Theme:/)` strict mode 命中 3 个：
`Theme: System` / `Theme: Dark` / `Theme: Light`。
来源 `8eadc588b`：选 System 时外观页多出深色 / 浅色配对两行
（`appearance-section.tsx` 的 `SystemPairingRow`），复用同一条
`settings.appearance.theme.accessibilityLabel`。
同目录的 `appearance-theme-picker.spec.ts` 已经在用
`getByLabel("Theme: System", { exact: true })`，这条跟上即可。

### 3. plugin-theme:51 — 测试夹具该改

`getByText("Catppuccin Mocha", { exact: true })` 命中 2 个：内置主题菜单项 +
插件贡献的同名主题。`8eadc588b` 把 Catppuccin Mocha / Latte 都做成了内置
（`theme.ts` 的 `darkCatppuccinMocha` / `lightCatppuccinLatte`）。
夹具插件 `PLUGIN_SOURCE` 里两套主题正好同名，撞车。
夹具本身不关心叫什么名字 —— 它验的是"插件贡献的主题能生效、插件移除后回落"。
改夹具名字比改选择器干净。

**顺带一个产品问题**：插件贡献的主题和内置主题同名时，选择器里就是两条一模一样的文字，
用户分不出来。这次是测试撞上了，但真实用户也会撞上。

### 4. terminal-protocol-query:41 — 测试该改，但断言要重写

本地复跑：PTY 实收 `\x1b]11;rgb:ffff/ffff/ffff\x1b\\`，断言要的是 `rgb:0b0b/0b0b/0b0b`。

失败截图确认：**e2e 浏览器里 app 渲染的是浅色主题**。
默认偏好是 `auto`，Playwright 的 `colorScheme` 默认 light，所以跟随系统 = 浅色。
浅色主题 `terminal.background` = `surface0` = `#ffffff` → `rgb:ffff/ffff/ffff`。

`packages/app/src/terminal/view-attributes.ts` 是**分支新增**的
（`git diff --stat origin/main..HEAD` 里整文件新增），上游根本不把主题色报给 daemon，
daemon 对 OSC 11 保持沉默，回复来自 xterm 自己的默认底色 `#0b0b0b`。
终端主题桥接上线后，daemon 按 app 报上来的真实主题回答 —— 浅色下就是白。

问题在于这条测试的名字是"不要把浏览器的 OSC 11 回复送回 PTY"，
而它用 `not.toContain("rgb:ffff/ffff/ffff")` 来表达"白色只可能来自浏览器"。
现在浅色主题合法地就是白，这条断言已经分辨不了泄漏和正常。
修法：测试里把主题钉死（`localStorage` 种 `theme: "dark"`，
`appearance-theme-picker.spec.ts` 已有这个写法），断言深色主题的真实底色
`rgb:1818/1b1b/1a1a`，`not.toContain("ffff")` 才重新有意义。

不是产品 bug：默认跟随系统、e2e 环境是浅色，行为正确。

### 5. import-session-flow:125 — **需要产品决策，不是测试该改**

测试在 daemon config 里故意配了一个坏 provider：

```ts
[brokenProvider]: { extends: "acp", label: "Broken ACP", command: ["missing-agent-command", "acp"] }
```

然后 `flow.expectProviderError("Broken ACP")` 等界面上出现
"Could not load Broken ACP sessions"，再走 Retry。

`1bad014d6` 把 `listImportableSessions` 改成扇出前先 `getProviderAvailability` 探测，
不可用的直接跳过、不进 `providerErrors`。于是错误不再出现。

两边的意图是冲突的，不是谁过时：
- 该 commit：没装的 provider 不该刷 providerErrors。
- 上游测试：**显式配置过**但起不来的 provider，应该在面板里报错 + 给 Retry。

"配了但命令不存在"算哪一类，是产品决策。

### 6. desktop-tests (ubuntu) — 测试该改，**是本次 usage 任务自己弄的**

CI 日志（之前未归因，现已定位）：

```
locator.waitFor: Timeout 30000ms exceeded.
  - waiting for locator('[data-testid="settings-sidebar"]:visible')
      .getByRole('button', { name: 'Usage', exact: true })
  at openSettingsDestination (packages/desktop/e2e/settings-memory.electron.mjs:40)
```

`settings-memory.electron.mjs` 的 `SETTINGS_DESTINATIONS` 里硬写了 `"Usage"`。
`766711263`（套餐用量搬去「用量」页）把主机设置页那一栏改名成 "Price table"
（`en.ts` 的 `settings.hostSections.usage: "Price table"`）。
把列表里的 `"Usage"` 换成 `"Price table"` 即可。

## 不归本任务

`cli-tests (shard 3/3)`：基线（上游代码）红、分支重跑绿 —— 上游自己的 flaky，
和这 55 个 commit 无关。这里只记一笔，不修。

## 决策（2026-09-19，用户「按你推荐的来」）

1. **import-session-flow 走改功能。** `listImportableSessions` 的可用性探测只跳过内置
   provider（`ProviderDefinition.extends === null`）；config 里自己声明的自定义 provider
   （`extends` 非空）探测失败仍进 `providerErrors`。上游测试不动。
   依据：`1bad014d6` 的本意是"未安装的 Provider"——用户从没要过的那些；写进自己 config
   的那个是他要的，`command` 打错静默返回空列表比刷一条错误糟。
   可行性已确认：`provider-registry.ts:78` 注释明确 `extends` 对内置 provider 为 null。

2. **插件主题与内置主题同名不在本任务处理。** 本任务只把夹具里的
   "Catppuccin Mocha" / "Catppuccin Latte" 改成不会撞车的名字。
   消歧能独立验收、独立上线，按 ATW 判据属于另一个任务。记成后续。

最终分工：五条改测试，一条改功能（server）。
