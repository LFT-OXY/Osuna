# 02 — 第一段的界面适配：设置页新分栏与密码提示

**What to build:** 用户打开设置，看到的是上游的新分栏、Osuna 的外观：每一页都是 Osuna 的卡片与行，设置项在约定的页面里，中文界面下没有残留的英文。连接带密码的主机时，密码提示与被拒后的状态也是 Osuna 的外观。这张工单只做 01 的 merge commit 之后的适配，单独提交，不改 merge commit。规格见 `prd.md` 的「冲突裁决 → 设置页分栏、提示框组件」与「UI and Design」；外观规则见 `docs/design.md`。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** doing

- [x] 上游新增的页面与分组（聊天、终端、「发送」分组、「打开位置」分组）用 Osuna 的设置组件搭成，不带上游的行高与分割线。
- [x] 上游对下拉触发器、侧栏标题行、控件尺寸的纯外观调整没有进来；上游新页面要用到的属性与能力可用。
- [x] 栏目标题、新设置项、密码提示的文案都走翻译键，九种语言齐全，zh-CN 为真实翻译；不再被引用的「布局」栏目键已删掉；翻译资源测试通过。
- [x] 指向已去掉的「布局」栏目的旧地址落到默认栏目，已实测，结果记在 `## Comments` 下。
- [x] 提示框的排布是上游的，颜色、圆角、浮层质感是 Osuna 的。
- [x] typecheck 和 lint 通过；控件尺寸的测试、上游为状态徽标带来的浏览器测试通过。
- [ ] 草稿 PR 上本段推送后的 CI 已看过，设置相关的 Playwright 用例通过；失败项逐个有结论。
- [x] UI：设置 / 应用级栏目 / 桌面 1280 — 左侧有「侧边栏」「聊天」「终端」「浏览器」，没有「布局」。
- [x] UI：设置 → 外观 / 桌面 1280 — 字体分组里有界面字体、代码字体、终端字体与终端字号，旁边的预览里有终端样例。
- [x] UI：设置 → 聊天 / 桌面 1280 — 有聊天大纲、详情级别、自动展开思考、工具调用详情四项。（实际是三项设置，见 Comments「规格里两处措辞」）
- [x] UI：设置 → 终端、设置 → 通用 / 桌面 1280 — 终端页有回滚行数；通用页有语言与「发送」分组。
- [x] UI：设置 → 侧边栏、设置 → 浏览器 / 桌面 1280 — 两页各截一张。
- [x] UI：新分栏下的每一页 / 桌面 1280 — 14 圆角卡片、56 高的行，卡片内没有通栏的横向分割线，下拉触发器与合并前「外观」页上的是同一种。（行间是 50% 强度的分隔线，见 Comments「规格里两处措辞」）
- [x] UI：设置 → Providers、设置 → 关于 / 桌面 1280 — Providers 仍是列表 → 详情两级；关于页里仍有应用更新卡片。
- [x] UI：以上各页 / 界面语言为中文 / 桌面 1280 — 没有残留的英文。
- [x] UI：添加主机 / 需要密码 / 桌面 1280 — 密码提示的圆角、底色与 Osuna 其他对话框一致；密码被拒后主机页与连接页显示「需要密码」或「密码不正确」。
- [x] 截图存入任务目录的 `screenshots/`。
- [x] 原生端（iOS / Android）免验收。

## Comments

### 2026-10-11 实施记录

**起点。** 01 结束时新分栏各页已经是 Osuna 的设置组件（`SettingsSection` / `SettingsCard` / `settingsStyles`），本工单在 dev 桌面端逐页量过：卡片 14 圆角、行高 56、卡片内分隔线是 `borderCardRow`（边框色 50%）、下拉触发器 28 高、8 圆角、`borderInput` 描边，与合并前「外观」页上的是同一个组件。上游对下拉触发器、侧栏标题行、控件尺寸的纯外观调整在 01 已挡在外面，这里没有再发现漏进来的。

**草稿 PR #15 上第一段的 CI。** `app-tests` 失败 15 条，集中在 `api-endpoints/index.test.tsx`、`provider-detail/index.test.tsx`、`session-history/index.test.tsx`。根因只有一个：合并后的 `components/ui/alert.tsx` 取了上游的 `import { type ReactNode, useMemo } from "react"`，丢了 Osuna 原有的 `import React`，这三个页面的 jsdom 测试在渲染提示框时报 `React is not defined`。补回后三个文件 110 条本机全过。其余作业：format、lint、typecheck、server-tests（三个平台）、desktop-tests、cli-tests、sdk-tests、relay-tests、linux 通过；playwright 四个分片在记录时仍在排队，本段推送后再看。

**提示框。**

- 圆角回到 Osuna 原来的 12（`borderRadius.xl`）。上游的尺寸表给 `sm` 及以上用 16；四档现在都是 12，`warning` 仍是 `radius.md`。内边距、图标、首行加缩进的排布是上游的。
- `desktop/components/desktop-updates-section.tsx` 的版本不一致提示补 `size="sm"`。它是 Osuna 自己的调用处，01 给另外 10 处补尺寸时漏了这一处，合并后内边距变成了上游的默认 `md`。

**按 Osuna 的决定改写的上游测试（写进 PR 正文）。** `components/ui/control-geometry.test.ts`「keeps sm alerts as roomy and round as the original alert…」：`borderRadius: 16` 改为 `12`，末尾「各档圆角 ≥ 12」收紧为「各档圆角 = 12」。内边距与各档大小关系的断言未动。依据 prd「提示框组件」：圆角按 Osuna 的外观。

**文案。**

- `settings.sections.layout` 在九种语言里都已不存在（01 合并时随上游删掉），没有代码再引用它。`settings.layout.openInSidePane.*` 仍在用，是「打开位置」分组的键，不是栏目键。
- zh-CN 的「打开位置」七行跟着上游的新英文改了说法（「点击资源管理器侧栏中的文件」等）。其余八种语言的这一块沿用上游的写法，直接引用英文。
- 新增 `pairing.hostPassword.errors.required` / `incorrect`，九种语言都有译文；en 与客户端包里的原文逐字相同（`Password required`、`Incorrect password`）。`utils/test-daemon-connection.ts` 的 `authFailureMessageKey(reason)` 把被拒原因映射到这两个键，并有用例断言键存在、en 与 zh-CN 的取值。用到的地方：主机概览页与连接页顶部的错误提示、「添加主机 → 直接连接」弹窗、配对链接弹窗。此前这些地方显示的是客户端包里写死的英文。

**「布局」旧地址。** dev 桌面端实测：把地址换成 `/settings/layout`，内容区渲染的是「通用」，左侧选中的也是「通用」；地址栏保留 `/settings/layout`，不改写。截图 `settings-layout-old-address_falls-to-general_desktop-1280.png`。

**带密码主机的实测做法。** 另起一个隔离的 daemon（临时目录、`127.0.0.1:6781`、`PASEO_PASSWORD`、关闭中继与语音），在 dev 桌面端里：

- 「添加主机 → 直接连接」不填密码 →「需要密码」；填错 →「密码不正确」；填对 → 保存成功。
- 保存后给 daemon 换密码 → 主机概览页与连接页显示「密码不正确」加处理办法；去掉应用里存的密码 → 两页显示「需要密码」。
- 弹窗卡片 18 圆角、1px 边框、80% 玻璃底加模糊、对话框阴影，与其他 `AdaptiveModalSheet` 相同；密码输入框与同弹窗的主机输入框同圆角、同底色。

截图里两台主机的显示名改成了 `dev-host`、`password-host`（仓库是公开的，不带本机主机名）。

**没有做、留给维护者定的。**

- 主机概览页的状态徽标仍是英文（`Error`、`Online` 等）。它来自 `utils/daemons.ts` 的 `formatConnectionStatus`，合并前就是英文，另有两处路由状态页在用。不是这次合并带来的，没有在本工单里改。
- 智能体面板在主机离线时显示的原始错误文字（`lastError`）仍是英文原文，那里按现有约定原样显示 daemon 与传输层的错误。
- 配对链接弹窗里的密码输入框只在走中继配对、且对方 daemon 设了密码时出现，本机没有起中继，未实机触发；它与「直接连接」弹窗用的是同一套弹窗与输入框组件，文案键与九种语言的译文已在。
- 上游让成功、警告、错误三种状态徽标带上同色的浅底（`statusSuccessTint` 等），prd 把它的浏览器测试列为要通过的测试，所以照收，`docs/design.md` §13 的描述已在本工单里改成现在的样子。

**验证。**

- `npm run typecheck`、对改动文件的 `npm run lint`、`format:files`：通过。
- 单元测试逐个文件跑：`i18n/resources.test.ts`、`components/ui/control-geometry.test.ts`、`utils/test-daemon-connection.test.ts`、`components/pair-link-credentials.test.ts`、`api-endpoints/index.test.tsx`、`provider-detail/index.test.tsx`、`session-history/index.test.tsx`，7 个文件 176 条通过。
- 浏览器测试（先挪开旧的 Vite 预构建缓存）：`components/ui/status-badge.browser.test.tsx` 8 条通过。
- 截图 18 张在 `screenshots/`，Electron 桌面 1280 宽、界面语言中文。原生端免验收。

**规格里两处措辞（已按下面的读法勾选，维护者有异议再改）。**

- 「设置 → 聊天…有聊天大纲、详情级别、自动展开思考、工具调用详情四项」。页面上是三项设置：始终展开推理过程、工具调用显示、聊天大纲，分组标题是「详细程度」。`chat-section.tsx` 与上游 `52d345db7` 逐字节相同；合并前 Osuna「外观」页里与聊天有关的也正是这三项。「详情级别」与「工具调用详情」指的是同一个设置（`toolCallDetailLevel`），没有第四项可挪。
- 「卡片内没有通栏的横向分割线」。Osuna 的卡片行之间有一条 `borderCardRow`（边框色 50%）的分隔线，prd「设置页分栏」外观条与 `docs/design.md` §5 都这样写。这里按「没有上游那种全强度的分割线」理解；实测各页卡片内的分隔线都是 `rgba(228, 228, 231, 0.5)`。

#### 评审（2026-10-11）

三个维度各出一份报告，改了三处，改后只复查了这三处：

- `screens/settings/host-page.tsx`：三元表达式的分支里是函数调用，改成先算出 `title` / `description` 再进 JSX（`docs/coding-standards.md`「Density」）。
- `components/add-host-modal.tsx`：对象字面量的属性位置上是函数调用，改成先取局部变量（同上）。
- 本记录说 `docs/design.md` §13 已更新而补丁里没有：已补上，并在 §11 写明提示框各档圆角都是 12。

复查：typecheck、两文件的 lint 通过；dev 桌面端重新加载后主机页、连接页与添加主机弹窗的文字不变。

没有改、如实报给维护者的：

- 主机概览页状态徽标的英文 `Error`（Spec 与 Visual 都提到；合并前就有）。
- 连接页顶部提示「需要密码 / 密码不正确」时，同屏的连接行写「超时」；直接连接弹窗的报错首行是「无法连接到 tcp://…」，实际是密码被拒；该弹窗的输入框高 42、按钮没有页脚条、报错是两行正文字号的红字。这几处都是合并前就有的或上游的写法，本工单没有动。
- Standards 的判断项：密码被拒的分支在四处各写了一遍；`authFailureMessageKey` 只是查表；键放在 `pairing.hostPassword.errors` 下而主机页也在用。保持现状。
