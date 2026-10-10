# 05 — 把从上游同步的做法写进文档

**What to build:** 维护者下次要合上游的下一个版本时，打开 `docs/release.md` 的「Fork 分发」一节就能照做，不用重新摸索，也不会踩这次已经踩过的坑。内容来自 01–04 实际发生的事，写约束和坑，不写操作流水账。规格见 `prd.md` 的「文档」；素材见 01、03、04 的 `## Comments`。

**Blocked by:** 04
**Status:** ready-for-agent
**Impl:** done

- [x] 「Fork 分发」一节含从上游同步的做法，并且是改写进该节，不是在文末追加一段；原有的"从上游同步代码时必须保住这个值"一句与新内容不重复。
- [x] 写明不抓上游 tag 及原因（Osuna 的版本 tag 与上游同名不同物），以及上游发布点用提交 SHA 引用。
- [x] 写明分段点怎么选（上游自己的发布点），以及合并分支必须以 merge commit 并入、不能 squash 或 rebase 及原因。
- [x] 写明版本号、`CHANGELOG.md`、安卓商店说明的归属，以及 `package-lock.json` 重新生成而不手工合并。
- [x] 列出合并后必须核对的 Osuna 不变量：更新源、桌面身份与数据目录、签名与签名断言、只手动触发的部署工作流、外链只指向本仓库、翻译键齐全、上游 `COMPAT(...)` 标签改写为 Osuna 版本号。
- [x] 写明冲突裁决的三条规则，以及"两边重复实现时以上游为底"的理由。
- [x] 写明当前已同步到的上游版本与提交。
- [x] 01–04 中实际踩到、规格里没有预见的坑各有一句；没有踩到的不凭空编。
- [x] 文风符合仓库的文档规则：第二人称、先说规则再说原因、不重复代码能说明的内容。
- [x] 改动的文档通过格式检查（只对改动的文件运行格式化，不跑全仓）。

## Comments

### 写了什么

`docs/release.md` 的「Fork 分发」一节新增 `### 从上游同步`，放在「发版」之后、「更新源」之前，节首加了一句指向它的话。六个小块：抓取与引用、分段与并入、版本号与发版元数据、冲突裁决、合并后核对、踩过的坑。

- 「更新源」里原有的"从上游同步代码时必须保住这个值"一句没有动，原因仍只写在那里；核对清单里的更新源一项只点名要看的配置段并链接过去。
- 核对清单里签名、部署工作流、身份与数据目录、翻译键、COMPAT 标签各项同样只写"看哪里"，原因用链接指向本文档的既有小节、ADR 0002、`i18n.md`、`protocol-compatibility.md`。
- 当前同步点写的是上游 v0.9.0（`7f7e60bcb`），并写明每次并入后更新这一句、可用 `git merge-base main upstream/main` 核对。

### 写之前核对过的事实（2026-10-10，本机）

- 三个 merge commit 的双亲：`503a3e7cb`（`d38d186bd` + `7c1958f5b`）、`0798c61c8`（`237a17969` + `e9d32a17d`）、`e0373b2ff`（`9ba17ecfe` + `7f7e60bcb`）。
- `git merge-base HEAD upstream/main` = `7f7e60bcb`。
- `remote.upstream.tagOpt` = `--no-tags`；本地 tag 14 个。本地 `v0.9.0` = `5b28df1db`、`v0.10.0` = `996eafd52`，上游同名 tag 分别是 `7f7e60bcb`、`c481ecf3e`。
- `git ls-remote --tags upstream 'v0.9.0*' 'v0.10.0*'`：每个 tag 两行，带 `^{}` 的一行是提交，与 PRD 里的三个发布点 SHA 一致。
- 上游站点链接计数用 01 的口径重跑：`packages/app/src` 70 / 1，`packages/cli/src` 13 / 3。
- 四个部署工作流的 `on:` 只有 `workflow_dispatch`；`desktop-release.yml` 里 `mac-sign.js`、`OSUNA_MAC_SIGNING_SHA1`、`Verify macOS signature` 都在，没有 `APPLE_ID`；`electron-builder.yml` 是 `appId: com.chinhae.osuna.desktop` / `productName: Osuna` / `owner: LFT-OXY` / `repo: Osuna`；`main.ts` 的 `USER_DATA_DIR_NAME = "Paseo"`。
- 本仓库的 GitHub 设置允许 merge commit（`allow_merge_commit: true`）。
- `build:terminal-webview` 脚本在 `packages/app/package.json`；`zhCNEnglishAllowlist`、`migratedSourceLiterals` 在 `i18n/resources.test.ts`。

### 没有写进文档的

- 工单 02 记的 Desktop Packages `linux` AppImage 自检偶发失败、工单 03 / 04 记的 playwright 重试后通过的用例：是 CI 偶发，只有零星样本，与同步的做法无关。
- 各段冲突文件的逐个裁决：留在 01、03、04 的 `## Comments`，06 写进 PR 正文；文档只写规则。
- arm64 堆上限取 8192 还是 4096：仍待维护者答复。文档只写"写法取上游；数值留 Osuna 的话在那一行写注释"，不写具体数值。

### 运行记录

- `npm run format:files -- docs/release.md`：通过（表格对齐由它重排）。`npm run format:check`：通过。
- 纯文档改动，没有可测试的逻辑，没有走 TDD，没有跑测试；不改界面，没有截图。

### 评审（`atw-code-review`，Standards 与 Spec 两轴；无截图，Visual 轴未跑）

- Spec，已修并复查：
  - "各段的冲突裁决在 PR #13 的正文里"——正文要到 06 才写，且 06 只要求摘要。改为"冲突裁决摘要"。**06 写 PR 正文时必须含三段的裁决摘要，文档这一句才成立。**
  - 堆上限一句写成了定论。改为不含取值的说法。
  - 裁决规则 1 原来引用整份核对清单，比 PRD 多带进部署工作流与 COMPAT 标签。改为逐项列出 PRD 的那几项。
  - "按 Ctrl 快捷键写的 e2e"不准（`pane-find` 那条是按 macOS 写的）。改为"各有一条涉及 Control+F 的用例"。
  - "让浏览器测试跑在旧依赖上"没有出处。改为"旧的预构建缓存，会掩盖 CI 上会挂的问题"。
  - `git ls-remote` 一句只对附注 tag 成立。补上"上游打的是附注 tag"。这一句规格没有要求，保留：它让"用 SHA 引用"能照做，命令在本机跑过。
  - 更新源在清单里重复了规则。清单项改为只点名配置段加链接。
- Spec，通过：第 8 条——01–04 写给 05 的 15 条都有对应句子，没有找不到出处的坑。
- Standards：没有硬违规。
  - 已改：去掉链接计数的基线数字（上文已写"合并前后各数一次"）；"就是要问维护者的地方"的句式；"尽早开草稿 PR"改为"第一段合完就开"。
  - 判断题，原样提交并上报：三个 merge commit 号与 `v0.15.0` 属于会过时的快照（前者不可变，后者是待办）；「踩过的坑」有四条是「冲突裁决」规则的具体实例；「踩过的坑」可并进各自所属的小块；六个四级标题是全文仅有的；「本机复核时」两条是通用的本机测试坑，主题更像属于 `docs/testing.md`；`CLAUDE.md` 文档表里 release.md 一行没有提到同步上游（没有改 `CLAUDE.md`，它是上游文件，多改一行多一处冲突面）。
- 修正后的复查：只对改过的句子通读了一次，重跑了格式化与格式检查。没有做第二轮完整评审。

### 规范补充

- `.atw/spec/guides/index.md` 新增「When Merging Upstream Paseo」触发清单，指向 `docs/release.md` 的「从上游同步」。`testing.md` 的色值一条、`styling.md` 的重新生成一条各自属于本层，没有动。

### 给 06

- PR 正文要含三段的冲突裁决摘要（文档已链接到 PR #13）。
- 并入 main 后核对 `git merge-base main upstream/main` = `7f7e60bcb`，与文档写的同步点一致。
- arm64 堆上限仍待维护者答复。
