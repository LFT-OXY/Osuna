# 工单 09 截图验收

2026-09-30，macOS dev 桌面端（Electron），界面语言 zh-CN。启动方式 `env -u PASEO_HOME FORCE_COLOR=3 PASEO_LISTEN=127.0.0.1:6769 npm run dev --workspace=@getpaseo/desktop`，daemon 在 6769，数据目录 `.dev/paseo-home`，启动前重建了 `packages/server/dist`。截图经 Playwright `connectOverCDP` 取真实 BrowserWindow，窗口尺寸与原型一致：宽屏 1440×900，窄窗 1024×900。

提供方是本机真实检测结果，没有造数据。诊断只在 Mock Load Test 上运行，没有在本机跑真实 CLI 的诊断。添加 Model 只展开并输入，没有提交，没有写配置。

## 截图与原型对照

| 画面 | 真实截图 | 原型 |
| --- | --- | --- |
| 宽屏 · Claude | D1-wide-claude-light / -dark | D1-light / -dark |
| 宽屏 · Codex（原型为官方，本机为第三方接口启用） | D2-wide-codex-light | D2-light |
| 宽屏 · ⋯ 菜单 | D6-menu-light | D6-light |
| 宽屏 · ⋯「诊断」后就地运行 | D7-diagnostic-light | D7-light |
| 宽屏 · 添加 Model 展开 | D8-add-model-light | D8-light |
| 宽屏 · 「+」目录弹窗 | D9-catalog-light | D9-light |
| 窄窗栈式 · 列表 | N1-narrow-list-light / -dark | N1-light |
| 窄窗栈式 · 详情（面包屑「Providers / Claude」） | N2-narrow-detail-light / -dark | N2-light / -dark |
| composer 齿轮弹窗 | M1-composer-light / -dark | M1-light / -dark |

没有截的原型画面：D3（Pi 未安装）本机 Pi 已安装，要造未安装状态得改真实 CLI 路径；D4 见下文；D5（Copilot 已禁用）详情没截，列表行的「已禁用」在 D1、N1 里可见。这三种状态的区块组合由 `provider-detail/index.test.tsx` 覆盖。手机画面（C1–C4）按下文「平台」免验收。D6、D7、D8、D9 只截了浅色：菜单和目录弹窗是共享的 DropdownMenu、AdaptiveModalSheet，本任务没有给它们加主题相关样式；卡片和弹窗外框的深色效果见 D1、N2、M1 的深色截图。

窄窗下地址先是 `/settings/hosts/<id>/providers`（列表），点行后 push 到 `/providers/claude`；宽屏进入 Providers 直接落在 `/providers/claude`。

## 差异

逐屏对比布局、区块顺序、字号、行高、按钮种类和位置，结构与原型一致。以下是看得出的差异：

- **数据不同。** 本机 Claude 没配第三方接口，官方行显示「使用中」、列表状态行是「15 个 Model」；原型是 OpenRouter 启用中。本机 Codex 启用了接口 chinhae，且 `~/.codex/config.toml` 被外部改过，所以第三方接口节顶部多一张「已被外部修改」卡片，这是上一任务的既有行为。列表里多了两个 dev 构建才有的 Mock 提供方。本机 OpenCode 已停用，所以没有截到错误卡（D4），错误卡由 `provider-detail/index.test.tsx` 覆盖。
- **composer 弹窗里是 Codex。** 齿轮打开的是当前 Agent 的提供方，本机当前 Agent 用的是 Codex；原型画的是 Claude。
- **没有红绿灯。** CDP 截图只含网页内容，不含 macOS 原生窗口按钮；侧栏顶部留白与原型相同。
- **开关与主按钮的颜色。** 真实截图里开关和「添加」是偏紫的蓝（像素约 `#454dc3`），原型是 `#1b4ed8`。开关读的是主题 `accent`（`components/ui/switch.tsx:71`），浅色主题源码里就是 `#1b4ed8`（`styles/theme.ts:556`）；做原型时从 Web（Playwright 无头 Chromium）取的基准截图 `research/screens/01-providers-page-light.png` 里，同一个开关是 `(30, 80, 216)`，与源码一致；只有 Electron 的 CDP 截图偏紫，工作区里的分支徽标也一样偏。偏色出在 Electron 的渲染或截图环节，不是页面取值；具体是色彩空间还是别的原因没有继续查。本任务没有改颜色相关的代码。
- **滚动条占宽。** 内容超出时 Electron 显示常驻滚动条：宽屏两列整体左移约 5px、窄窗和弹窗里的卡片右缘内缩约 11px。原型的画面内容没有溢出，也就没有滚动条。
- **弹窗头部高 4px 左右。** composer 弹窗和目录弹窗的头部比原型高约 4px。两边的上下内边距都是 16，差在头部行内元素的高度；头部是全局 `SheetHeader`，本任务没有改它。
- **目录弹窗更高。** 真实目录有几十项，弹窗撑到最大高度；原型只画了 6 项。「安装说明」链接在原型里带下划线，真实行里没有，目录行沿用现有组件，不在本任务范围。
- **时间是英文。** 「已更新 just now / 9m ago」和诊断节的「just now」是既有 time-ago 工具的输出，原型同样画成英文（「已更新 22s ago」）。
- **添加 Model 的按钮有底色。** D8 里「添加 Model」带浅底，是点击后指针仍停在按钮上的悬停态。

## 平台

| 平台 | 验收 | 说明 |
| --- | --- | --- |
| Desktop macOS | 是 | 本文截图 |
| Web | 是（e2e） | 见下方「浏览器 e2e」，含窄桌面与手机视口 |
| iOS / Android | 免验收 | 本机没有手机模拟环境，按项目惯例注明免验收 |
| Desktop Windows / Linux | 否 | 没有对应机器 |

## 浏览器 e2e

2026-09-30 本机运行受本任务影响的 5 个 spec（每个 worker 自带隔离 daemon 与 Metro）：

```bash
cd packages/app
env -u PASEO_HOME npx playwright test --project=browser --workers=1 \
  e2e/browser/settings-providers-split.spec.ts e2e/browser/provider-settings-refresh.spec.ts \
  e2e/browser/provider-removal.spec.ts e2e/browser/acp-provider-catalog.spec.ts \
  e2e/browser/settings-host-page.spec.ts --reporter=line
```

```
acp-provider-catalog.spec.ts:33 › ACP provider catalog › adds MiniMax Code from the providers list's + dialog and selects it
acp-provider-catalog.spec.ts:57 › ACP provider catalog on a phone › adds MiniMax Code from the bottom sheet and pushes its detail
provider-removal.spec.ts:72 › provider removal › removes a custom provider from its detail menu
provider-settings-refresh.spec.ts:152 › provider settings overlay stack › provider settings covers the desktop model selector without closing it
provider-settings-refresh.spec.ts:223 › provider settings overlay stack › provider settings and children close back through the model browser to configuration
settings-host-page.spec.ts:26 › Settings host page › visits host settings and opens the label editor
settings-host-page.spec.ts:72 › Settings host page › an outdated remote daemon offers no daemon update entry
settings-host-page.spec.ts:88 › Settings host page › navigating to /settings/hosts/[serverId] redirects to the connections section
settings-providers-split.spec.ts:45 › Settings providers list and detail › selects providers through the address on a wide window
settings-providers-split.spec.ts:92 › Settings providers list and detail on a narrow desktop window › pushes the detail and returns through the breadcrumb
settings-providers-split.spec.ts:131 › Settings providers list and detail on a phone › pushes the detail and Back returns to the list

  11 passed (1.3m)
```

## 组件测试与纯函数单测

```bash
cd packages/app
npx vitest run src/provider-detail/index.test.tsx src/screens/settings/providers-section.test.tsx \
  src/screens/settings/providers-layout.test.ts src/provider-detail/status.test.ts \
  src/provider-detail/diagnostic.test.ts src/provider-detail/removal.test.ts \
  src/stores/provider-settings-store.test.ts src/i18n/resources.test.ts --bail=1
```

```
 Test Files  8 passed (8)
      Tests  132 passed (132)
```
