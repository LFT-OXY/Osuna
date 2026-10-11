# 06 — 第五段：合并到上游 v0.10.3

**What to build:** 合并分支上多一个把上游 `b4af508e2`（v0.10.3，本段 4 个提交）合进来的 merge commit，分支从此包含本次范围内的全部上游提交。合完之后配对链接要连一台新主机、或已存主机的密钥或中继变了时，先弹出确认框；叠在一起的对话框与底部面板仍可操作。确认框是 Osuna 的外观，九种语言齐全。规格见 `prd.md` 的「合并方式」与「UI and Design」。

**Blocked by:** 05
**Status:** ready-for-agent
**Impl:** done

- [x] 合并分支包含一个以合并前的分支头与 `b4af508e2` 为双亲的 merge commit；`b4af508e2` 是分支头的祖先。
- [x] 每个冲突文件怎么裁的、依据哪条规则，逐个记在 `## Comments` 下；规则裁决不了的已停下来问过维护者。
- [x] 自适应弹层的冲突两边都留：Osuna 的外观与上游的叠放修复。
- [x] 确认框的文案走翻译键，九种语言齐全，zh-CN 为真实翻译；翻译资源测试通过。
- [x] 与 Osuna 同名的安卓商店说明文件留 Osuna 的；版本号仍是 `0.14.2`；`CHANGELOG.md` 与合并前逐字节相同、不含上游的 0.10.0 – 0.10.3 条目。
- [x] `docs/release.md`「合并后核对」逐项过完，结果记在 `## Comments` 下；上游站点链接数不多于 01 的基线。
- [x] 对本段冲突涉及的测试文件对比合并前后，没有 Osuna 的断言行被悄悄删掉。
- [x] typecheck 和 lint 通过；本段冲突文件对应的测试文件逐个单独跑过并通过。
- [x] 已推送，草稿 PR 上本段的 CI 已看过；失败项逐个有结论。
- [x] UI：配对链接 / 首次连接一台新主机 / 桌面 1280 — 出现确认框，含主机、密钥指纹、中继三项与说明；圆角、底色与 Osuna 其他对话框一致。
- [x] UI：配对链接 / 已存主机的密钥或中继变了 / 桌面 1280 — 确认框显示另一段说明。
- [x] UI：确认框 / 界面语言为中文 / 桌面 1280 — 没有残留的英文。
- [x] 截图存入任务目录的 `screenshots/`。
- [x] 原生端（iOS / Android）免验收。

## Comments

### 2026-10-11 实施记录

**本段上游的 4 个提交。** `383477341`（#5753，配对链接要连一台新主机、或已存主机的密钥、中继或 TLS 设置变了时先确认）、`21cfd7522`（#5772，原生端叠在一起的对话框与底部面板仍可操作）、`d75fa81e9`（更新日志）、`b4af508e2`（发版提交，只改版本号）。

**提交。** merge commit `e8738aa16`（双亲 `7fbe4b570` 与 `b4af508e2`）；紧跟的界面适配 `b215a3f36`。两次提交的钩子（lint、format、typecheck）都通过。合并后本地 tag 仍是 14 个，`git tag | shasum` 仍是 `8625da06…`。

#### 冲突（15 个）

机械性 14 个，做法与 03 – 05 相同：脚本只把冲突块取 HEAD 一侧，冲突块之外保持自动合并的结果，再用 `shasum -c` 对合并前的指纹核对。指纹清单 93 个文件（仓库里全部 `package.json`、`package-lock.json`、`CHANGELOG.md`、安卓商店说明），全部一致。

| 文件 | 裁决 | 依据 |
| --- | --- | --- |
| 12 个 `package.json` | 冲突块取 Osuna（版本号、`@getpaseo/*` 内部依赖），共 17 个冲突块。解完与合并前逐字节相同：上游这一段在冲突块之外没有加东西 | 版本号与发版元数据表 |
| `package-lock.json` | 16 个冲突块取 Osuna 后与合并前逐字节相同；再用 `npm install --package-lock-only --ignore-scripts` 重新生成，仍逐字节相同。上游这一段没有改外部依赖 | 同上 |
| `CHANGELOG.md` | 冲突块取 Osuna，与合并前逐字节相同 | 同上 |
| `components/adaptive-modal-sheet.tsx` | 两边都留。冲突块只有两行常量：上游新加的 `NATIVE_DIALOG_SNAP_POINTS` 收下；`ABSOLUTE_FILL_STYLE` 是 Osuna 把遮罩挪进 `desktopScrim` 样式时删掉的，合并后全文件没有引用，保持删除 | 规则 3 |

`adaptive-modal-sheet.tsx` 冲突块之外的部分自动合并。合并后相对合并前的差异与上游这一段对该文件的改动逐行相同（`ABSOLUTE_FILL_STYLE` 在上游的改动里只是没动的上下文行，Osuna 这边没有这一行）：原生端的对话框从 RN `Modal` 换成与底部面板共用的 Gorhom 栈，新面板打开时收起键盘。Osuna 的外观都在：遮罩 `desktopScrim`（`dialogScrimFill`）、卡片 `floatingSurfaceFill`、`radius["2xl"]`、`shadowDialog` 阴影、底部按钮条 `surfaceDialogFooter`。上游这处改动只走原生端的分支（`isWeb` 为假时），桌面端与 Web 的渲染路径没有变。

安卓商店说明这一段没有冲突：上游新增的 `100031.txt` – `100034.txt`（上游 0.10.3 的说明）在 Osuna 这边没有同名文件，按上游的进来。

没有规则裁决不了、需要问维护者的地方。

#### 自动合并的文件

- `runtime/host-runtime.ts`、`runtime/host-runtime.test.ts`、`components/pair-link-modal.tsx`、`types/host-connection.ts`、`app/_layout.tsx`：Osuna 相对上游多出的行，合并前（对 `919c737c1`）与合并后（对 `b4af508e2`）逐行相同。
- `components/add-host-modal.tsx`：同上，另有一个依赖数组过了格式化（Osuna 那一侧的元素是 `directConnectionLabels`，比上游的短，合起来能放进一行）。
- `app/pair-scan.tsx`：合并前后都与上游逐字节相同。
- 新增：`hosts/host-confirmation-sheet.tsx`、`hosts/pair-scan-model.ts` 与测试、`runtime/host-confirmation.ts`、`e2e/browser/host-confirmation.spec.ts`、`e2e/support/helpers/host-confirmation.ts`、`e2e/mobile/modal-sheet/` 下两个流程文件（`stacked-pairing.ad`、`stacked-settings.ad`）。同目录的 `README.md` 是已有文件，上游加了 49 行。
- 九种语言的翻译资源各加 `pairing.hostConfirmation.*` 七个键（`title`、`description`、`descriptionChanged`、`hostLabel`、`fingerprintLabel`、`relayLabel`、`connect`）。

#### 界面适配（`b215a3f36`，merge commit 之后单独提交）

上游的确认框把「取消 / 连接」放在正文里、两个按钮等宽。`docs/design.md` 规定桌面端对话框的按钮在底部按钮条里、各自按自身宽度靠右；Osuna 的移除主机、移除连接两个确认框（`screens/settings/host-page.tsx`）就是这样写的，上游这个文件的注释也写明它与那两个确认框同形。改动只在 `hosts/host-confirmation-sheet.tsx`：按钮挪进 `AdaptiveModalSheet` 的 `footer`，去掉等宽，`testID` 不变。说明文字、三行明细用的是 `settingsStyles.card` / `row` / `rowBorder`，上游原样就是 Osuna 的设置卡片，没有改。

文案：上游已经走翻译键，九种语言齐全，zh-CN 是上游带来的真实翻译（「连接到此主机？」「密钥指纹」「中继」等），没有改字。

#### UI 实测（dev 桌面端，Electron，窗口 1280 × 832，浅色主题，界面语言跟随系统 = 中文）

入口：设置 → 左上角主机下拉 → 添加主机 → 粘贴配对链接 → 填入链接 → 配对。链接是造的：`serverId` `srv_Qm4tVx81LpZe`、中继 `relay.example.net:443`、一段假公钥。确认框出现在探测主机之前，所以不需要真的有这台主机。截图前把 dev 主机的显示名临时改成 `Dev Host`（避免带本机主机名），截完已还原。

| 截图 | 状态 | 看到的 |
| --- | --- | --- |
| `screenshots/pair-link_host-confirmation-new-host_desktop-1280.png` | 首次连接一台新主机 | 标题「连接到此主机？」；说明「此主机将能在此应用中运行代码，并访问你其他已连接的主机。仅在你认识它时才连接。」；卡片三行：主机、密钥指纹（`k3Vt Q0x5 … UdTZ pTTE`）、中继；底部按钮条里「取消」「连接」靠右 |
| `screenshots/pair-link_host-confirmation-changed-connection_desktop-1280.png` | 已存主机的密钥变了 | 说明换成「此链接会改变你连接此主机的方式。该主机将能在此应用中运行代码……」，其余相同。造法：在 dev 的主机列表里另存一台同 `serverId`、同中继、旧公钥的主机，再粘贴带新公钥的链接 |

- 中文：两张图里框内的可见文字全部是中文；`srv_…`、指纹、中继地址是数据。DOM 里读出的整段文字与截图一致。
- 与其他对话框一致：确认框叠在「粘贴配对链接」对话框之上，同一时刻读两者的计算样式，圆角都是 18px、底色都是 `rgba(255, 255, 255, 0.8)`、边框都是 `rgb(228, 228, 231)`、阴影都是 `rgba(0, 0, 0, 0.45) 0px 24px 64px -24px`。确认框自身另有 `blur(12px) saturate(1.14)` 的背景滤镜。
- 按钮：「取消」54 × 28、「连接」54 × 28，间距 8，右缘距卡片右缘 25，在按钮条里；点「取消」后确认框消失，下层的粘贴对话框还在。
- 没有实测的：点「连接」之后的流程（造的主机不存在，会停在探测失败）；二维码扫码与直接打开配对网址这两个入口（前者只在原生端，后者在 dev 桌面端会被启动恢复打回）。这三条由上游带来的 `host-runtime.test.ts`、`pair-scan-model.test.ts` 与 e2e `host-confirmation.spec.ts`（CI）守着。
- 深色主题没有截图。
- 截图是 1280 宽（与窗口的逻辑像素一比一）、256 色。先按之前的做法压成 128 色，第二张图里按钮条上方的细线和「取消」的底色被抹掉了，视觉评审据此提了疑问；对原图取像素核对（细线 `228`、按钮 `226,227,231`、按钮条 `238,240,241`，两种状态相同）后改用 256 色重新导出，复看两张图细线与按钮都在。

原生端（iOS / Android）免验收：`adaptive-modal-sheet.tsx` 的原生分支与上游随带的 `e2e/mobile/modal-sheet/` 流程没有在本机跑。

#### 合并后核对

- 更新源：`electron-builder.yml` 的 `publish` 仍是 `LFT-OXY/Osuna`。
- 桌面身份与数据目录：`appId` `com.chinhae.osuna.desktop`、`productName` `Osuna`；`main.ts` 仍把 userData 固定在原目录名。
- 签名与签名断言：`mac-sign.js` 钩子、`OSUNA_MAC_SIGNING_SHA1`、`Verify macOS signature` 都在；`notarize: false`。
- 部署工作流：四个文件的 `on:` 只有 `workflow_dispatch`。
- `packages/desktop`、`.github`、`packages/protocol`、`packages/server`、`packages/client`、`packages/cli`、`packages/relay`、`docs`：相对合并前没有任何差异。本段上游只动了 `packages/app` 与版本号类文件。
- 上游站点链接数：app 73 / 1，cli 13 / 3。合并前是 app 72 / 1；01 的基线是 70 / 1。多出的 1 处在上游新带来的测试 `hosts/pair-scan-model.test.ts` 里（`const LINK = "https://app.paseo.sh/#offer=abc"`），是扫码解析用的假地址，与 01 多出的 2 处同类。非测试数不变，界面上没有新增上游链接。全部数比基线多 3，都在上游的测试文件里；没有改上游的测试去压这个数，与 01 的处理一致。
  **维护者裁决（2026-10-11，评审后问的）：** 算通过。把关的是非测试数，测试里的假地址不算；不改上游的测试。口径已写进 `docs/release.md`「合并后核对」的「外链只指向本仓库」。
- 翻译键：上游新增 `pairing.hostConfirmation.*` 七个键，九种语言齐全；`i18n/resources.test.ts` 38 条通过。
- `COMPAT(...)`：没有新标签。`oldRelayOfferTls` 随代码从 `host-runtime.ts` 挪到 `types/host-connection.ts` 新增的 `relayConnectionFromOffer()` 里，标签名合并前就有，写的版本号是上游早期的 `v0.1.73`，按规则不动。
- 协议：协议包没有改动。
- 版本号仍是 `0.14.2`（12 个工作区）；`CHANGELOG.md` 与合并前逐字节相同。

#### 测试文件对比

本段新增或改动过的测试文件 3 个。

- `runtime/host-runtime.test.ts`：上游改了 109 行旧内容并新增确认相关的用例。Osuna 相对上游多出的 42 行（全部是新增行，没有删上游的行）合并前后逐行相同，没有被删。
- `hosts/pair-scan-model.test.ts`、`e2e/browser/host-confirmation.spec.ts`：上游新增，里面没有 Osuna 的断言。

#### 验证

- merge commit 那个状态：`npm run typecheck`、`npm run lint`、`npm run format:check` 通过（`add-host-modal.tsx` 先过了一遍格式化）。另用不含 `.expo` 类型的临时配置对 app 复核了一遍类型：只有 7 条 `CDPSession.send` 的报错，都在本段没有动过的浏览器测试文件里，是临时配置少带了类型声明造成的，与本段无关。
- 本机逐个跑过的测试文件（merge commit 状态）：`runtime/host-runtime.test.ts` 92、`hosts/pair-scan-model.test.ts` 5、`i18n/resources.test.ts` 38、`types/host-connection.test.ts` 21、`components/adaptive-modal-sheet-layout.test.ts` 5、`utils/connection-selection.test.ts` 5、`runtime/daemon-start-service.test.ts` 18；引用 `AdaptiveModalSheet` 的页面测试 `components/rename-modal.test.tsx` 7、`components/import-session-sheet.test.tsx` 26、`screens/settings/terminal-profile-edit-modal.test.tsx` 8、`screens/settings/plugins-page.test.tsx` 7、`screens/settings/providers-section.test.tsx` 36。
- 界面适配之后：`npm run typecheck`（提交钩子）通过，改动的文件 lint 与格式检查通过；确认框没有单元测试接缝，靠上面的实测与 CI 上的 e2e。
- 本机没有跑的：`e2e/browser/host-confirmation.spec.ts`（Playwright，交给 CI；它按英文文案与 `host-confirmation` 这个 `testID` 之下的按钮名找元素，按钮挪进按钮条后仍在这个 `testID` 之下，本机在 DOM 里核对过）、`e2e/mobile/modal-sheet/`（原生端）。
- 整套测试交给 CI。

#### 评审（2026-10-11）

对 merge commit 加未提交的适配做了 Standards、Spec、Visual 三个维度的评审，修一次、只对修过的地方复查一次。

- Standards：没有硬性违规。`adaptive-modal-sheet.tsx` 没有孤儿代码（29 个样式键都有引用，`ABSOLUTE_FILL_STYLE`、`useRef`、`Modal`、`Platform`、`GestureHandlerRootView`、`nativeModalRoot` 没有残留）；确认框的写法与 `host-page.tsx` 两个移除确认逐字段一致。判断项三条：本记录把翻译键数写成八个，实际七个（已改）；`confirmText` / `confirmActions` 加「取消 + 确认」按钮条的写法现在有三处，到了 `docs/design.md`「三处即抽成组件」的线，抽取要动 Osuna 的 `host-page.tsx`，不在这次合并里做，报给维护者；新加的中文注释与文件末尾的上游注释说的是同一件事（已改成只写 Osuna 与上游的不同）。上游原样、只告知的三处：`add-host-modal.tsx` 的 `useUnistyles()` 是随上游拆组件挪过去的旧调用；`DetailRow` 用的是 RN 的 `Text`；`backgroundStyle` 把 Unistyles 样式传给了库属性，值是静态的 `transparent`。
- Spec：没有范围蔓延，没有阻断项。自适应弹层两边都在、九种语言各七个键、版本号与更新日志、`COMPAT` 的说法、测试没有 Osuna 的断言被删，都核对一致。指出的问题：验收项「上游站点链接数不多于 01 的基线」字面上没满足（已问维护者，见「合并后核对」）；本记录四处写得不准——键数、`e2e/mobile/modal-sheet/README.md` 是已有文件不是新增、适配当时还没提交也没记 typecheck、`ABSOLUTE_FILL_STYLE` 在上游的改动里是上下文行——都已按代码改正。
- Visual：三条界面验收都满足，没有可观察的偏离设计规则之处；确认框与对照图（添加主机的密码提示）圆角、底色、边框、投影、标题栏是同一套。提的两条疑问（第二张图按钮条上方的细线看不见、按钮条底色看不出比正文深）：前一条是截图压缩造成的，已重新导出；后一条在原图上按钮条 `238,240,241`、正文 `239,239,239`，差别确实很小，按钮条的底色由 `AdaptiveModalSheet` 用主题里的 `surfaceDialogFooter` 画，本段没有动，浅色主题下叠在另一个对话框之上时就是这个结果。口味一条：「连接方式变了」是风险更高的状态，却只有一段说明不同，标题与色调和首次连接一样，也没说变的是密钥还是中继——这是上游的设计，改它是产品决定，报给维护者，本次没有动。
- 复查：改过的记录逐条对回代码；重新导出的两张截图取像素并复看；改过注释的文件 lint、格式检查与 app 的 typecheck 通过。

#### 规范回写

- `docs/release.md`「踩过的坑」补一条：上游新增的确认类对话框把操作按钮放在正文里，挪进 `footer`。「合并后核对」的「外链只指向本仓库」写明把关的是非测试数。
- `.atw/spec/app/frontend/testing.md`：带对话框的截图压成 128 色会抹掉按钮条上方的细线与次要按钮的底色，用 256 色并对原图取像素核对。

#### 推送后的 CI（2026-10-11）

工单 05 的关票提交 `7fbe4b570`、merge commit `e8738aa16` 与适配 `b215a3f36` 推到 `origin/merge-upstream-v0.10.3`。草稿 PR #15 上 CI（运行 38116077035）第一次 19 项里 18 项通过、1 项失败；重跑失败项后 19 项全部通过。另一个工作流 `Desktop Packages`（运行 38116077006）通过。

失败的 1 项是 desktop-tests（ubuntu-latest）：`packages/desktop/e2e/daemon-lifecycle.e2e.mjs` 启动 daemon 时报 `listen EADDRINUSE: address already in use 127.0.0.1:39737`，测试选的端口在那台检查机器上已被占用。本段相对合并前在 `packages/desktop` 与 `packages/server` 下没有任何差异；Windows 上的同一项第一次就通过。`gh run rerun --failed` 后通过，没有改代码。这一条在前四段的记录里没有出现过。

上游带来的 `e2e/browser/host-confirmation.spec.ts` 两条在 playwright 分片 3 里第一次就通过（「a pairing link for a new host asks before saving it」「a pairing link for a saved host connects without asking」），按钮挪进按钮条后它仍然找得到。app-tests、server-tests 三个平台第一次就通过。

playwright 里首次失败、重试后通过的 2 条，都在分片 3：

- `settings-providers-list-detail.spec.ts:58`：与 02 – 05 记录的是同一条，每次都在。
- `plugin-buttons.spec.ts:4`：已知的 CI 偶发，前几次运行里出现过。
