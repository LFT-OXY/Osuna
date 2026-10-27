# 13 — 整体视觉检查与截图

**What to build:** 在 dev 桌面端（1280 宽，中文与英文各看一遍）把上游带来的新界面逐个对一遍，统一成 Osuna 的外观并截图，供维护者凭证据决定是否并入。只修各屏之间的外观偏差，不重新设计。规格见 `prd.md`「UI and Design」。

**Blocked by:** 12
**Status:** ready-for-agent
**Impl:** done

- [ ] 「UI and Design」列出的页面与状态都有截图，存进任务目录的 `screenshots/`，文件名带工单号、界面、状态、视口与语言。
- [ ] 「UI and Design」的截图验收点逐条满足，不满足的已修并重拍。
- [ ] 侧栏新加的排序菜单、后台工作区开关与「显示更多」行用 Osuna 的行样式。
- [ ] 中文界面下上述新界面没有残留英文；思考档位名保留英文不算残留。
- [ ] 修外观时改到的测试文件逐个单独跑过并通过；typecheck 和 lint 通过。
- [ ] 原生端免验收，不拍手机截图。

## Comments

### 实施记录（2026-10-27）

**环境。** 先 `npm run build:server`，再 `env -u PASEO_HOME -u PASEO_AGENT_ID -u PASEO_AGENT_CWD -u CLAUDE_* FORCE_COLOR=3 PASEO_LISTEN=127.0.0.1:6769 CLAUDE_CONFIG_DIR=/tmp/osuna13-cfg/claude CODEX_HOME=/tmp/osuna13-cfg/codex npm run dev --workspace=@getpaseo/desktop`。启动日志 `Home:` 是本检出的 `.dev/paseo-home`；Claude、Codex 的配置目录指向临时空目录。启动前备份真实 `~/.codex/config.toml`、`~/.claude/settings.json` 与 dev 的 `config.json`，结束后三份与备份逐字节相同（dev 的按 JSON 比对）；正式版 daemon（6767）一直在。窗口 1280×800，Playwright 经 CDP 操作与截图。全程没有在任何真实提供方的输入框里发送消息。

**造数据。** 演示仓库 `/tmp/osuna13-demo`（相对路径图片的 README、逻辑图 `docs/logic-maps/login` 取自工单 05、11 个文件的未提交改动，其中 `package-lock.json`、`public/app.min.js` 按名单、`schema/types.ts` 经 `.gitattributes` 记为生成文件）。mock 提供方建 1 个演示工作区与 9 个同项目的本地工作区（凑出「显示更多」）。两处状态 mock 给不出，临时给 `mock-load-test-agent.ts` 打了补丁（带代码块与表格的固定回复；计划审批多一个 `implement_resume` 动作，标签照 Claude 写 `Implement with Auto`），重建 server 后拍，拍完 `git apply -R` 撤回并重建，没有提交。计划卡片因此是 mock 提供方的卡片：与 Claude 走同一个 `PermissionRequestCard`，按钮名都由 daemon 下发。「添加失败」用 `chflags uchg` 把 dev 的 `config.json` 临时设为不可改，daemon 写配置报 `EPERM`，拍完立即去掉标记。Hoplite 加进 dev 配置后又经详情页移除。演示工作区已全部归档；界面语言改回 `system`；为截图把 dev 主机的显示名临时改成 `Dev Host`，已改回。开发版左下角的 `uniProps`、按钮套按钮报错条（工单 11 记过，只在开发版出现）截图前隐藏。

**截图（`screenshots/13-*`，21 组，中英各一，共 42 张，全部 dev 桌面端 1280 宽实拍）。** 压到 1600 宽：带代码着色与提供方图标的用 256 色，其余 128 色。

| 「UI and Design」要求的页面与状态 | 截图 |
| --- | --- |
| 「添加提供方」：有 Hoplite；搜索后的排序结果；添加失败 | `13-add-provider-dialog-{list,search-co,search-ho,add-failed}-*` |
| Hoplite 详情页：可删除 | `13-provider-hoplite-detail-*`、`13-provider-hoplite-detail-menu-remove-*` |
| 设置 → 文件分区 | `13-settings-files-*`（空状态；有行的状态见 `11-settings-files-rows-electron-1280-zh.png`） |
| 侧栏：显示设置里的排序与后台工作区选项；长项目组的「显示更多」 | `13-sidebar-display-menu-{background-switch,sort-page}-*`、`13-sidebar-project-show-more-*` |
| 新建工作区页：主机选择与菜单末尾的添加主机 | `13-new-workspace-host-menu-add-host-*` |
| Changes：默认 All changes；大改动集下生成文件收起 | `13-changes-all-changes-generated-collapsed-{top,bottom}-*` |
| Explorer：标签栏含会话历史；launcher 展开 | `13-explorer-tabs-session-history-*`、`13-explorer-launcher-open-*` |
| 聊天：带代码块与表格的回复 | `13-chat-codeblock-table-*` |
| Markdown 文件：Preview 与 Source；相对路径图片 | `13-markdown-file-preview-relative-image-*`、`13-markdown-file-source-*` |
| 逻辑图：点带行号的节点后打开的源码视图 | `13-logic-map-node-line-opens-source-*` |
| 套餐用量：弹窗与卡片里写明已用或剩余 | 没有在 Electron 里拍：真实账号会把套餐数据截进公开仓库，dev 又指向了空的 CLI 配置。证据仍是工单 08 的 `08-plan-usage-modal-{used,remaining,options}-1280-zh.png`、`08-usage-page-plan-card-1280-zh.png`（无头 Chromium + 夹具），只有中文 |
| Claude 计划审批卡片：含 Implement with Auto | `13-claude-plan-card-implement-with-auto-*`（mock 卡片，见上） |
| 终端：粘贴图片之后 | `13-terminal-after-image-paste-*`（「文件已上传」提示与写入终端的上传路径） |

**截图验收点。**

| 验收点 | 结果 | 证据 |
| --- | --- | --- |
| 「添加提供方」是 Osuna 的弹窗与行列表，不是卡片网格；列表里有 Hoplite | 满足 | `13-add-provider-dialog-*`；Hoplite 在字母序靠后，首屏外，搜索「ho」后可见 |
| 文件分区行高、卡片圆角与同页一致，卡片内没有通栏分割线，文字是中文 | 满足 | `13-settings-files-*-zh`（空状态卡片）；有行的状态工单 11 量过：行高 56、圆角 14、只有 `borderCardRow` |
| 中文下套餐用量各处写「已用」「剩余」「套餐用量」「提供方」 | 满足（沿用 08 的证据） | 见上表 |
| 侧栏排序菜单与「显示更多」行用 Osuna 的行样式 | 修后满足 | 「显示更多」与工作区行实测同为高 36、圆角 8、左内边距 8、文字起点 x=40；菜单各行高 30、圆角 6；「显示后台工作区」改为行尾开关，见下 |
| Explorer 标签栏有会话历史；高度、圆角、选中态与工作区标签相同 | 满足 | 实测两边都是高 26、`radius 8`、选中底色 `rgb(234,234,234)`、未选中透明 |
| 聊天代码块有语言标签头与复制按钮，按语法主题上色 | 满足 | `13-chat-codeblock-table-*` |
| Markdown Preview 显示相对路径图片，能切到 Source | 满足 | `13-markdown-file-*` |
| 点逻辑图带行号的节点，打开源码视图并停在那一行 | 满足 | 点「Start session」，源码视图状态栏 `Ln 50, Col 1`，第 50 行是 `## Start session` |
| 中文下上述新界面没有残留英文（思考档位名不算） | 不完全满足，见下 | — |

**修了什么。**

1. **「显示后台工作区」改成行尾开关。** 上游这次带来的选项是 `MenuItem selected`（选中时打勾）。它是单独的一项开/关设置，`docs/menus.md`「When a decision earns a submenu」规定这类用行尾 `Switch` 加 `closeOnSelect={false}`，用量页选项菜单（`usage/usage-options-menu.tsx`）是范例。`components/sidebar/display-preferences/menu.tsx` 照范例改：行尾放带读屏名的 `Switch`，行上不再传 `selected`；开关的 `onValueChange` 只在值真的变了时才调用 `toggleBackground`（store 只有取反，没有按值设置）。Electron 实测点行、点开关各切换一次；这一行高 42，用量页选项菜单的开关行同样是 42，其余菜单行 30。照范例写，整行的读屏名会带上开关的名字（`menuitem "显示后台工作区 显示后台工作区"`，范例同样如此），上游 `e2e/browser/sidebar-workspace-rename.spec.ts` 原来按 `menuitem` 精确名字点这一行，改为按 `testID="sidebar-display-show-background"` 点（该 testID 为此新加）；`e2e/browser/sidebar-project-filter.spec.ts` 加一条断言：名为「Show background」的 `switch` 未打开。两个 e2e 本机都没跑，见「检查」。
2. **移除提供方的确认框写「Cancel」。** 原生确认框的取消按钮在中文下是英文：`utils/confirm-dialog.ts:21` 的默认值是 `"Cancel"`，`provider-detail/view.tsx` 移除提供方时只传了 `confirmLabel`。补传 `cancelLabel: t("common.actions.cancel")`，Electron 里经 System Events 读到按钮为「取消 / 移除」。只改了这一处调用：别处没传 `cancelLabel` 的确认框仍是英文，main 上相同，不是这次合并带来的。

**看过、没有改的。**

- **Explorer 标签行放不下时不跟随选中标签滚动。** 默认宽度下 Explorer 有四个标签时（文件、更改、会话历史、逻辑图）一行放不下，行改为横向滚动（宽 263、内容 312），选中的「逻辑图」被右侧「+」盖住一半；英文下更明显，切到「会话历史」后行首只剩半个「es」。`workspace-desktop-tabs-row.tsx` 没有把选中标签滚进可见区的逻辑，工作区标签行也一样（那边标签会先收缩，所以少见）。上游的共用标签行，07 记过英文下标签被截断；不在本工单改，交维护者。
- **「显示更多」的文字是 14px 灰色，工作区行标题是 13px。** 行高、圆角、内边距、文字起点都与工作区行一致；字号差是合并前就有的（`sidebar-group-toggle-row.tsx` 用 `fontSize.base`，main 上相同），没有改。
- **Markdown 预览把小图放大。** 480×200 的图在预览里按内容宽度显示，放大约 1.2 倍、略糊。上游渲染器的写法，没有改。
- **Explorer 的「编辑配置」没有图标位**，07 记过，上游原样。

**中文界面里仍是英文的。**

- 其他没传 `cancelLabel` 的原生确认框（插件移除、主机页等）取消按钮仍是「Cancel」：`utils/confirm-dialog.ts:21` 的默认值是英文，main 上相同，不在本工单逐个改。
- 计划审批卡片的按钮名（`Reject`、`Implement`、`Implement with Auto`）由 daemon 下发，main 上已经是这样；`docs/i18n.md`「Translation Scope」把 daemon 下发的文字列为不翻，例外清单里没有它。
- 「添加失败」里的报错原文（daemon 的英文错误）、ACP 目录里第三方提供方的描述与 `manual` 版本字段、mock 提供方的模型与模式名：按「Translation Scope」不翻。
- 侧栏与会话历史的相对时间（`now`、`13h`、`Oct 8`）：已另开任务 `10-13-zh-relative-time-and-plan-labels`。

**检查。** `npm run typecheck` 通过；改动文件的 `npm run lint`、`npm run format:files` 通过；`src/provider-detail/index.test.tsx` 单独跑过，79 条通过（它不覆盖确认框的按钮文字）。`e2e/browser/sidebar-project-filter.spec.ts`、`sidebar-workspace-rename.spec.ts` 本机没跑：e2e 的测试 daemon 会对本机真实的 Claude 做模型探测（按约定本机不碰真实 CLI 登录），交给 14 开 PR 时的 CI，所以「改到的测试文件逐个单独跑过」这一项现在不满足。同样的定位与断言（开关的角色与名字、未打开、按 testID 点行能切换）已在 Electron 里用 Playwright 对真实页面核对过。`menu.tsx` 没有单元或浏览器测试。

**原生端（iOS / Android）免验收**，没有拍手机截图。`Switch` 是跨平台组件，原生端没有实看。

### 评审与处理（2026-10-27）

三个维度各一个子代理，对同一份冻结补丁与 42 张截图。底线检查（floor guard）无发现。

**Standards。** 硬问题 1 条：「显示后台工作区」同时传 `selected` 与 `trailing`，偏离 `docs/menus.md` 对 `selected` 的定义与范例写法——**已修**（照范例：带读屏名的 `Switch`、不传 `selected`，上游用例改按 testID 找行）。判断题：开关包在 `aria-hidden` 里却可聚焦——**随上一条去掉**；`onValueChange` 丢掉传入值——**已改为按值切换**；JSX 注释与 e2e 注释重复——JSX 那条改成只指向文档；新 testID 原本无人引用——现在被 `sidebar-workspace-rename.spec.ts` 用上；e2e 只断言初始状态、没断言切换——没有加，切换在 Electron 里实测过；新注释是中文、文件原有注释是英文——按维护者「注释用中文」保留。

**Spec。** 「显示后台工作区」换成开关判为不越界（工单与 `docs/menus.md` 都要求）。移除提供方的确认框在中文下写「Cancel」——**已修**（补 `cancelLabel`）。行号 `confirm-dialog.ts` 写错——已核对为 `:21`。e2e 没在本机跑、套餐用量与文件分区有行状态只有中文旧图、计划卡片是 mock 卡片——都是如实记录的部分满足，交维护者在验收时认定。

**Visual。** zh 的排序子菜单截图里没有开关——那张是改开关之前拍的，**已重拍**（中英两组菜单图都换了）。开关行高 42、其余菜单行 30——与范例（用量页选项菜单，实测同为 42）一致，没有改。目录里的「manual」是 ACP 目录数据的版本字段（工单 03 记过）。计划卡片的「你想如何继续?」是半角问号、会话历史空状态「此项目还没有提供方会话。」带句号（`docs/design.md` 规定单句提示不带句号）——两条文案 main 上相同，不是这次合并带来的，没有改，交维护者。英文下 Explorer 标签行溢出、逻辑图跳到第 50 行后没有行高亮、「显示更多」截图里滚动后项目标题不在画面内——前一条已在「看过、没有改的」里，后两条是上游的交互设计，不在「只修偏差」的范围，交维护者。菜单下方的硬边灰影是 128 色压缩的痕迹（原图是柔和阴影）。

**复核（只看已修的几条，一次）。** 七条都判为已修；复核指出记录里的行号改错成 `:22`、末尾一句仍提 `aria-hidden`，两处已改正。
