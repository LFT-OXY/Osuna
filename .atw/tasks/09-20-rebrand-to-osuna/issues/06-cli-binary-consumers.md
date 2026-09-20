# 06 — CLI 二进制名的消费方：agent hooks 与 shim 解析仍在找 `paseo`

**What to build:** 批次 1 把 CLI 二进制从 `paseo` 改成 `osuna`（`packages/cli/package.json`
的 bin 只有 `"osuna": "bin/osuna"`，`bin/` 下只有 `osuna` 一个文件），但三处消费方仍按
旧名去找它。本票只做这一件事：让所有「调用 CLI 二进制」的地方与实际装出来的名字一致。

**Impl:** ready
**Status:** ready-for-agent

**Blocked by:** 03

## 为什么单独开票而不是补进 01 或 04

票 01 的验收（桌面包构建、安装、启动，appId 正确）是真过了的，重开它会把记录搅浑。
这三处是一个自洽的切片，有自己的验收方式（装 CLI、起一个 opencode 会话、确认状态上报），
而且其中一处**现在就是坏的**，不该排在批次 4 那一大坨文档扫描后面。发现于批次 3 的收尾
自检，不是审查意见。

## 三处，按严重度排

- [ ] **现在就是坏的** — `packages/server/src/terminal/agent-hooks/opencode/opencode-plugin.ts:38`
      生成的 opencode 插件硬编码 `Bun.spawn(["paseo", "hooks", "opencode", event])`，
      没有任何环境变量可以覆盖它。后果：opencode 终端的 busy / idle / permission 状态
      完全上报不了。同一个模板里已经在读 `OSUNA_TERMINAL_ID`（批次 2 改的）却 spawn 旧
      二进制 —— 是个半改的生成模板，正是 `.atw/spec/guides/cross-layer-thinking-guide.md`
      「Generated Runtime Template Upgrade Consistency」那一节讲的情况。
      注意：其他 provider 的 hook 走 `agent-hook-installer.ts` 的 `OSUNA_HOOK_CLI` 机制，
      opencode 这条路没有，所以修法不能照抄 —— 要么给模板注入已解析的 CLI 路径，要么让它
      也读 `OSUNA_HOOK_CLI`。选哪个要看 Bun 插件运行时能拿到什么环境。
- [ ] **潜伏** — `packages/server/src/terminal/agent-hooks/agent-hook-installer.ts:140,149`
      落盘的 hook 命令回退名是旧二进制：`"${OSUNA_HOOK_CLI:-paseo}" hooks ...`，Windows
      分支 `else (paseo ${hookArgs})`。`terminal.ts:546` 会为 daemon 起的终端设
      `OSUNA_HOOK_CLI`，所以常规路径掩盖了这个问题；该变量没设时所有 provider 的 hook
      都打不着。
- [ ] **静默降级** — `packages/server/src/terminal/terminal.ts:478` `paseoCliShimNames()`
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

- [ ] 验收：`npm run build:server` 后装一次 CLI，起一个 opencode 终端会话，确认 app 里
      能看到 busy → idle 状态翻转（即 `osuna hooks opencode` 真被调到了）。这是唯一能
      证明第一项修好的方式，typecheck / lint / 单测都证明不了。
- [ ] 验收：清掉 `OSUNA_HOOK_CLI` 再起一次终端，确认 hook 仍能打到 `osuna`
- [ ] 测试：`agent-hooks/opencode/`、`agent-hooks/claude/`、`terminal/terminal.posix.test.ts`
      受影响文件，单文件 `--bail=1`
- [ ] `npm run typecheck`、`npm run lint` 通过
