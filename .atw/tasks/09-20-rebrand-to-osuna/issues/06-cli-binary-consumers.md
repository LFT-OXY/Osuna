# 06 — CLI 二进制名的消费方：agent hooks 与 shim 解析仍在找 `paseo`

**What to build:** 批次 1 把 CLI 二进制从 `paseo` 改成 `osuna`（`packages/cli/package.json`
的 bin 只有 `"osuna": "bin/osuna"`，`bin/` 下只有 `osuna` 一个文件），但三处消费方仍按
旧名去找它。本票只做这一件事：让所有「调用 CLI 二进制」的地方与实际装出来的名字一致。

**Impl:** done
**Status:** ready-for-agent

**Blocked by:** 03

## 为什么单独开票而不是补进 01 或 04

票 01 的验收（桌面包构建、安装、启动，appId 正确）是真过了的，重开它会把记录搅浑。
这三处是一个自洽的切片，有自己的验收方式（装 CLI、起一个 opencode 会话、确认状态上报），
而且其中一处**现在就是坏的**，不该排在批次 4 那一大坨文档扫描后面。发现于批次 3 的收尾
自检，不是审查意见。

## 三处，按严重度排

- [x] **现在就是坏的** — `packages/server/src/terminal/agent-hooks/opencode/opencode-plugin.ts:38`
      生成的 opencode 插件硬编码 `Bun.spawn(["paseo", "hooks", "opencode", event])`，
      没有任何环境变量可以覆盖它。后果：opencode 终端的 busy / idle / permission 状态
      完全上报不了。同一个模板里已经在读 `OSUNA_TERMINAL_ID`（批次 2 改的）却 spawn 旧
      二进制 —— 是个半改的生成模板，正是 `.atw/spec/guides/cross-layer-thinking-guide.md`
      「Generated Runtime Template Upgrade Consistency」那一节讲的情况。
      注意：其他 provider 的 hook 走 `agent-hook-installer.ts` 的 `OSUNA_HOOK_CLI` 机制，
      opencode 这条路没有，所以修法不能照抄 —— 要么给模板注入已解析的 CLI 路径，要么让它
      也读 `OSUNA_HOOK_CLI`。选哪个要看 Bun 插件运行时能拿到什么环境。
- [x] **潜伏** — `packages/server/src/terminal/agent-hooks/agent-hook-installer.ts:140,149`
      落盘的 hook 命令回退名是旧二进制：`"${OSUNA_HOOK_CLI:-paseo}" hooks ...`，Windows
      分支 `else (paseo ${hookArgs})`。`terminal.ts:546` 会为 daemon 起的终端设
      `OSUNA_HOOK_CLI`，所以常规路径掩盖了这个问题；该变量没设时所有 provider 的 hook
      都打不着。
- [x] **静默降级** — `packages/server/src/terminal/terminal.ts:478` `paseoCliShimNames()`
      返回 `["paseo"]` / `["paseo.cmd","paseo.exe","paseo"]`，在 npm `.bin` 里恒找不到，
      于是 `findNpmBinDir` 恒返回 null、`resolvePaseoCliExecutablePath` 永远拿不到 shim。
      不崩（有回退到 entrypoint 路径），但 shim 偏好整个失效了。顺带把这一串函数名
      （`paseoCliShimNames`、`resolvePaseoCliShim`、`hasPaseoCliShim`、
      `resolvePaseoCliExecutablePath`、`resolvePaseoCliBinEntrypoint`）一并改名 —— 它们
      是同一处改动的连带，不算顺手重构。

## 测试正钉住坏行为

`agent-hooks/opencode/opencode.test.ts:60-61,83-86` 断言 spawn 参数就是
`["paseo", "hooks", "opencode", ...]`；`agent-hooks/claude/claude.test.ts:32,159,180`
造了名为 `paseo` 的假二进制并设 `OSUNA_HOOK_CLI: "paseo"`。所以全量测试一直是绿的，
这也是前三批都没报出来的原因。改代码时必须同时改断言，**不能只让测试变绿**。

- [x] 验收：`npm run build:server` 后装一次 CLI，起一个 opencode 终端会话，确认 app 里
      能看到 busy → idle 状态翻转（即 `osuna hooks opencode` 真被调到了）。这是唯一能
      证明第一项修好的方式，typecheck / lint / 单测都证明不了。
- [x] 验收：清掉 `OSUNA_HOOK_CLI` 再起一次终端，确认 hook 仍能打到 `osuna`
- [x] 测试：`agent-hooks/opencode/`、`agent-hooks/claude/`、`terminal/terminal.posix.test.ts`
      受影响文件，单文件 `--bail=1`
- [x] `npm run typecheck`、`npm run lint` 通过

## 落地记录

**opencode 插件怎么修的**：选了「让模板也读 `OSUNA_HOOK_CLI`」，不注入已解析路径。
证据是 `terminal-manager.ts:342` 与 `terminal.ts:519-521` 把 `OSUNA_TERMINAL_ID` 和
`OSUNA_HOOK_CLI` 一起放进终端环境，opencode 在该终端里启动，Bun 插件直接继承
`process.env`（模板原本就是靠这条读 `OSUNA_TERMINAL_ID` 的）。注入路径的另一条路会让
`OPENCODE_PLUGIN_SOURCE` 随安装目录变化，而 `agentHooksAreInstalled` 是整源等值比较，
每次路径变动都会判成"未安装"并重写。回退名用裸 `osuna`，因为 `terminal.ts:515-517` 已把
CLI bin 目录前置进 PATH。

**实机验收**（隔离的 `OSUNA_HOME` 与 `OPENCODE_CONFIG_DIR`，6779 端口，跑完已 `daemon stop`）：

- daemon 启动即把新插件写进 `$OPENCODE_CONFIG_DIR/plugins/`，内容含
  `process.env.OSUNA_HOOK_CLI || "osuna"`。
- 终端内 `OSUNA_HOOK_CLI` = `<repo>/node_modules/.bin/osuna`（修 shim 名之前这里会是
  `packages/cli/bin/osuna`），`which osuna` 同路径 —— 第三项的直接证据。
- 用真实 bun 加载真实落盘的插件文件、在该终端里发 V1 `session.status` 事件：daemon 的终端
  活动 `idle → working → idle`，时间戳逐次推进。
- 清掉 `OSUNA_HOOK_CLI` 再跑一次同样翻转，走的是 PATH 上的裸 `osuna` —— 第二条验收。
- 另跑 `buildAgentHookShellCommand` 落盘的那行 sh（`OSUNA_HOOK_CLI` 未设、`OSUNA_TERMINAL_ID`
  已设），活动同样翻到 working —— 第二项的实机证据。

**没能验的一段**：本机 `opencode auth list` 是 0 credentials，起不了真实 opencode 会话，
所以"opencode 自己发出 `session.status` 事件"这一步没实测；验的是它之后的整条链路。

**测试**：`opencode.test.ts` 的断言改成 `["osuna", …]`，并新增「`OSUNA_HOOK_CLI` 已设时 spawn
daemon 解析出的路径」；`claude.test.ts` 新增一条真正执行回退名的用例（临时目录里放可执行的
`osuna`，`PATH` 指过去，`OSUNA_HOOK_CLI` 不设，断言 stub 记下的 argv）—— 旧回退名下它退 127。
`terminal.test.ts` 新增 shim 优先于 entrypoint 的断言。`codex.test.ts` 的两条命令串断言一并更新。

**没做**：`resolvePaseoCliBinDir`、`injectPaseoHookCli`、`prependPaseoCliToPath` 以及
`paseoCliBinDir`/`paseoHookCliPath` 两个入参仍是旧名 —— 票里点名的是那五个，这些留给后续的
标识符清扫。`opencode-plugin.ts` 的 `hookMarker` 也没动：它对 plugin-file 策略是死字段，
而且不是"调用 CLI 二进制"的地方。

**全量单测**：`vitest run --exclude **/*.e2e.test.ts` 5778 passed / 4 failed。4 条都在
`src/server/`，与本票无关：`bootstrap-provider-availability`、`workspace-service-port-allocator`
在改动前的基线上同样失败（后者是 macOS `/private` 符号链接）；`workspace-git-service.observation`、
`file-observer/index` 单独跑全绿，属并发下的 flaky。
