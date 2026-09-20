# 07 — 内部标识符清扫：把剩下的 paseo 全部改掉

**What to build:** 票 04 之后仓库里只剩「只有维护者看得见」的那类 `paseo`：私有函数名、
入参名、文件名、测试临时目录前缀、fixture 字符串。本票把它们一次扫干净，让全仓
`rg -i paseo` 真的归零 —— 这条验收原本挂在票 04 上，但与 04 自己写的「内部私有变量名
不在范围内」互相矛盾，移到这里独立完成。

**Impl:** done
**Status:** ready-for-agent

**Blocked by:** 08

## 为什么值得单独做一遍，而不是「谁碰到谁顺手改」

票 04 的原话是后续顺手改。放着不改有两个具体代价：

- **半改的标识符比两端都糟。** 票 06 就撞上过：`runPaseoHook` 里读 `OSUNA_TERMINAL_ID`
  却 spawn `paseo`，一个现代字面量挨着一个陈旧的，看上去像是故意的，没人会去质疑。
  `terminal.ts` 现在也是这个样子 —— `resolvePaseoCliBinDir` 调 `resolveOsunaCliExecutablePath`。
- **「顺手改」会把品牌改动混进功能 diff。** 每次触碰都带一片无关重命名，审查看不清哪些是
  本次逻辑改动。

## 范围（实测，票 04 完成后需重新计数）

当前（票 06 已提交）约 10600 处 / 1200 文件，其中 `.ts` 8700 处 / 959 文件是主体。
不含票 09 的原生模块目录名，也不含 `packages/website` 里 canonical URL、changelog
标题等仍指向旧域名的文案 —— website 已移出 workspace 不再构建，那部分随 website
的去留一起定。

- [x] `packages/server/src/terminal/`：票 06 有意留下的一串 ——
      `resolvePaseoCliBinDir`、`injectPaseoHookCli`、`prependPaseoCliToPath`、
      `BuildTerminalEnvironmentInput` 的 `paseoCliBinDir` / `paseoHookCliPath` 两个入参、
      `paseo-env.ts`、`shell-integration/zsh/paseo-integration.zsh` 及读它的代码、
      `resolveZshShellIntegrationRuntimeDir` 里的 `-paseo-zsh-` 目录名
- [x] `agent-hooks/`：生成模板内部的 `runPaseoHook` / `paseoEventForV1` / `paseoEvent`、
      插件 id `paseo-terminal-activity` 与落盘文件名 `plugins/paseo-terminal-activity.js`、
      `opencode-plugin.ts` 的 `hookMarker`、`removePaseoHooks` / `hasPaseoCommands`
- [x] 其余各包的私有标识符与类型名（17 个文件 `git mv`，内容改动 949 文件 / 约 7500 行）
- [x] 测试里的临时目录前缀（`createTempDir("paseo-…")`）与 fixture 字符串
- [x] 不改：`CHANGELOG.md` 历史条目、`LICENSE` 原版权行、`public-docs/plugins/v0.7/`
      等版本锁定的历史文档、以及任何**主语就是旧名**的说明文字（见
      `.atw/spec/guides/cross-layer-thinking-guide.md`「The sweep corrupts text whose
      subject is the old name」）

## 改插件 id 与落盘文件名要当作升级路径处理

`plugins/paseo-terminal-activity.js` 改名后，老文件不会自己消失：`installAgentHooks`
只按新 `configFile` 写新文件，`uninstallAgentHooks` 也只删新路径。用户的
`~/.config/opencode/plugins/` 里会同时存在新旧两个插件，两个都被 OpenCode 加载，
同一个事件上报两次。改名必须连带删除旧文件名，并加一条回归。

已落地：`AgentHookPluginFileInstallStrategy` 多一个可选的 `legacyConfigFiles`，
install 与 uninstall 都先删它列出的旧路径；只删掉旧文件的那次 install 仍报
`changed: true`。生产点带 `COMPAT(opencode-plugin-rename)` 标记。三条回归在
`opencode.test.ts`。

## prd 标为「需要先做决定」的那项：ACP 自我标识 —— 已决定改名

prd 把 `packages/plugin/src/server/acp-internal/connection.ts` 的
`clientInfo: { name: "paseo" }` 与 `_paseo` 元数据命名空间列为「需要先做决定、不能机械改」。
落地前已向用户提问并取得决定：**改成 osuna**（连带 `_osuna` 与报错文案
「Osuna closed the ACP connector」）。

理由与已知风险（用户在知情下选择）：两者全仓无读取方，只发给外部 ACP agent 进程；
ACP 规范里 `clientInfo.name` 是自报名、`_meta` 扩展键按客户端命名空间取；没有证据表明
任何 agent 对字面量 `paseo` 有特判。**风险是离线无法证伪的**：若某个 agent 真有基于名字的
特判，这就是行为变更而不只是改名。首次真实跑通 Claude Code / Codex / Gemini 的 ACP 路径时
值得复看一眼。

## 落地时确认下来的排除清单（验收按这份，不是「零命中」）

票原本写「全仓 `rg -i paseo` 真的归零」。实际清扫后确认，下面这些**保留才是对的**，
归零反而会造出谎言。排除后的残留全部属于这几类：

- **上游拥有的资产**：`github.com/getpaseo/paseo`（含 fork 溯源与引用上游 PR/issue 的文档）、
  `getpaseo/paseo-relay`、`@getpaseo/hub` 与 `ghcr.io/getpaseo/hub`、
  `relay.paseo.sh` / `app.paseo.sh` / `hub.paseo.sh`、`paseo-relay-next.fly.dev`。
  Osuna 没有域名也不运营 relay/Hub，改成 `osuna.sh` 一类是编造不存在的地址。
- **Hub 服务端拥有的标识**：workflow 表达式命名空间 `paseo.prompt` / `paseo.inputs` /
  `paseo.context` / `paseo.execution.id`（prd 批次 8 已决定不改），以及 Hub 签发的凭证前缀
  夹具 `paseo_cli_prefix_durable-…`、Hub 自己读取的 `PASEO_HUB_APP_URL`（本仓库无读取方）。
- **主语就是旧名**：`pid-lock.ts` 的 `COMPAT(pid-lock-paseo-name)` 一组
  （`PASEO_PID_LOCK_FILENAME` / `readLivePaseoPidLock` / `createPaseoLockHeldError` /
  `"paseo.pid"` / 报错文案）、README fork 溯源、`CLAUDE.md` 与 spec 里「上游 Paseo daemon
  6767/6768」、`.atw/spec/app/frontend/testing.md` 记录半改名 bug 的示例、journal 历史条目。
- **0.8 之前的 SDK scope `@paseo/plugin`**：它是**退役入口**，`compiler.ts` 与
  `evaluate.ts` 靠它给出可读的报错。批次 1 把它和 `@getpaseo/plugin` 一起改成
  `@osuna/plugin`，在 `compiler.ts` 里留下了一个重复条件 —— 等于这条拒绝彻底失效，
  两个包的测试也因此变成「断言当前合法入口会被拒绝」。本票一并修回。
- **金标值的输入**：`identity-colors.test.ts` 的 `deriveIdentityColorName("paseo")` → `#368080`
  是调色板重构前记录的配对，换输入就只能按现行实现重新推导期望值，回归随之失效。
- **票 09 拥有的原生模块**：`packages/app/modules/paseo-*` 及其 Kotlin/podspec/Gradle 标识。
- **本票不含**：`packages/website`（已移出 workspace，随 website 去留一起定）、
  `packages/relay/wrangler.toml`（上游域名与 worker 名，属 prd「范围外」的线上服务）。

## 清扫顺带修掉的既有缺陷

这些不是改名本身，是改名让它们显形，且都会让用户看见错误的目的地：

- app / CLI 的六个硬编码 URL 仍指向上游（**改的是目的地而不是拼写，严格说属批次 5
  「推测试 tag 走一遍 GitHub Release」的切片**；在这里改是因为留着就等于 Osuna 的更新器
  和「报告问题」按钮把用户送去上游，批次 5 之前 `LFT-OXY/Osuna` 还没有 release，
  下载链接会是 404 —— 这一点由批次 5 的发布演练收口）：`changelog-source.ts` 拉上游 CHANGELOG、
  `desktop-updates.ts` 的 `RELEASE_DOWNLOAD_BASE_URL` 指向上游 releases、
  `startup-splash-screen.tsx` 与 `sidebar-help-menu.tsx` 的 issue 链接、
  `community-links.tsx`、`cli/commands/open.ts` 的安装提示 → 全部改指 `LFT-OXY/Osuna`。
- 十余处 `paseo.sh/docs/*` 文档外链（批次 4 漏项）→ 改指仓内 `public-docs/*`
  的 GitHub blob 地址；`paseo.sh/changelog` → 仓内 `CHANGELOG.md`；
  `paseo.sh/download` → 本仓库 releases。
- `packages/desktop/package.json` 的 `desktopName: "Paseo.desktop"`（批次 1 漏项）。
- `nix/module.nix` 的 relay `"hosted"` 模式说明仍称「默认用上游 `app.paseo.sh`」，
  而该模式第 162 行其实是把 `OSUNA_RELAY_ENDPOINT` 置空 —— 描述的是不存在的行为。
- `scripts/osuna-ios-simulator-service.mjs` 的 `appScheme = "paseo"`（批次 1 已把 scheme
  改成 `osuna`）。
- `.git/paseo/worktree.json` 元数据目录（批次 2 的运行时标识漏项）→ `.git/osuna/`。
  **代价记在这里，不是默默接受**（与 prd 对 stash 前缀的处理同一条规矩）：改名前由本 fork 的
  dev daemon 建出来的 worktree，其 ownership 元数据不会被迁移，Osuna 从此把它们看作普通目录
  —— `isOsunaOwnedWorktree` 为 false，归档时不再按「Osuna 拥有的 worktree」处理。worktree 本身
  和其中的提交都没丢。影响面限于本机 `.dev/osuna-home` 起过的 worktree（fork 尚未发布），
  与上游 6767 daemon 建的 worktree 无关（那些本来就带 `.git/paseo/`，Osuna 本就不该认领）。

## 两处刻意的不一致（评审问到，记下理由）

- **仓库 slug 的大小写分两种**：产品代码里用规范写法 `LFT-OXY/Osuna`（那是真实 URL），
  测试夹具里用全小写 `lft-oxy/osuna`。夹具沿用旧值 `getpaseo/paseo` 的全小写形态，
  因为 `project-key.ts` 会对 GitHub 路径做 `toLowerCase()`，而
  `project-key.test.ts` 有一条专门验大小写归一化的用例：输入 `LFT-OXY/Osuna`、
  期望 `lft-oxy/osuna`。两边统一成任何一种写法都会让那条用例失去意义。
- **`.github/ISSUE_TEMPLATE/*` 的仓库链接改指本仓库，同句里的上游 Discord 邀请没动。**
  删社群链接是产品决定不是改名，且 prd 已把「投稿目的地」归给批次 4
  （`CONTRIBUTING.md` 与 ISSUE_TEMPLATE 一起改，避免两处互相矛盾）。留在这里记一笔。

## 验收

- [x] 全仓 `rg -i paseo` 排除上面那份清单后无命中；反向探针 `getosuna` / `osuna.sh` /
      `getpaseo/osuna` / `@lft-oxy/` 也无命中（只剩指南与任务记录里把它们当反面教材的那几行）
- [x] **第三向探针：被折叠的刻意对比**。前两向都查不出「HEAD 上同一行刻意并列新旧两个名字，
      清扫把它们压成同一个」这一类。判据是机械的：旧名 token X 与新名 token Y 同行，且
      `sweep(X) == Y`。首次运行命中 12 行，其中 4 行是**用户可见的报错文案**
      （`runtime.ts` 的「This plugin was made for Paseo or an older version of Osuna」
      被扫成「made for Osuna or an older version of Osuna」，另有三个测试文件断言同一句），
      以及 `plugin-requirements.ts` 里指南逐字记载过的那条同义反复
      （「they declare `requirements.osuna`, never `requirements.osuna`」——
      HEAD 上本已修好，被本次清扫重新扫坏）。全部修回后探针归零。
- [x] 验收：装一次 CLI 起一个终端，agent hook 状态上报仍通 ——
      `claude.real.e2e.test.ts` 对真实 claude 2.1.258 起真 PTY、装真 hook、收到 running/idle
      两次上报，走的正是改名后的 `resolveOsunaCliBinDir`
- [x] 验收：老插件文件存在时安装一次，确认旧文件被删、不会双份上报（三条回归）
- [x] `npm run typecheck`、`npm run lint` 全绿；`npm run format:files` 对 931 个改动文件通过
- [x] 单测：app 642 文件 5734 例全绿、protocol 65/718 全绿、desktop 48 文件全绿、
      relay+plugin 全绿、cli `vitest run src` 39 文件全绿、server `test:unit` 393 文件
      仅剩两条**与本票无关**的失败（已在 HEAD 干净 worktree 上复现）

## 遗留（不属本票，需另行决定）

- `packages/app/src/terminal/webview/terminal-emulator-webview-html.ts` 这份生成产物
  **相对源码已过期**：`terminal-contrast.ts` 已被 `terminal-emulator-runtime.ts` 引用，
  却不在 bundle 里；重新生成会多出 2345 字节。源头是提交 `c3cf65346`
  （终端对比度按主题修正）改了运行时源码但没跑 `npm run build:terminal-webview`。
  本票只对它做了品牌串替换（1 处 → 4 处，已逐字节验证），**没有重新生成** ——
  否则等于把一个无关的行为变更塞进改名提交。另一份 `html.gen.ts` 已重跑生成脚本，
  与手改结果逐字节一致。
- `packages/server/package.json` 的 `build:lib` 用 `cpSync` 拷 `shell-integration`
  但不先 `rm`，所以改名后的 `paseo-integration.zsh` 能在增量构建里存活。
  本次已 `npm run clean` 过，`dist/` 当前干净；但这个隐患本身在改名之前就有。
- `opencode-plugin.ts` 的 `hookMarker` 对 plugin-file 策略**根本没有读取方**
  （只有 config-file 策略用它做标记匹配移除），且 `"osuna hooks opencode"` 这个子串
  在生成的插件源码里并不存在（spawn 用的是数组）。claude/codex 的 marker 刻意不带
  二进制名（`"hooks claude"`）。改名如实跟着改了它，但这个字段该不该存在是既有问题。

- `packages/server/src/server/bootstrap-provider-availability.test.ts` 与
  `workspace-service-port-allocator.test.ts`：本机环境导致（codex 在 PATH 上、
  macOS `/private/var` 软链），在 HEAD 上同样失败。
- `packages/cli/tests/17-onboard.test.ts:70` 断言 `daemon pair --relay` 产出 `#offer=`，
  而票 10 之后 relay endpoint 留空就没有配对链接了 —— 这条自票 10 起就是红的，
  该断言未被本票改动。改它要先定「留空默认下 onboarding 应该断言什么」，属票 10 的范围。
