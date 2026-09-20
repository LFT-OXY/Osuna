# 07 — 内部标识符清扫：把剩下的 paseo 全部改掉

**What to build:** 票 04 之后仓库里只剩「只有维护者看得见」的那类 `paseo`：私有函数名、
入参名、文件名、测试临时目录前缀、fixture 字符串。本票把它们一次扫干净，让全仓
`rg -i paseo` 真的归零 —— 这条验收原本挂在票 04 上，但与 04 自己写的「内部私有变量名
不在范围内」互相矛盾，移到这里独立完成。

**Impl:** ready
**Status:** ready-for-agent

**Blocked by:** 04

## 为什么值得单独做一遍，而不是「谁碰到谁顺手改」

票 04 的原话是后续顺手改。放着不改有两个具体代价：

- **半改的标识符比两端都糟。** 票 06 就撞上过：`runPaseoHook` 里读 `OSUNA_TERMINAL_ID`
  却 spawn `paseo`，一个现代字面量挨着一个陈旧的，看上去像是故意的，没人会去质疑。
  `terminal.ts` 现在也是这个样子 —— `resolvePaseoCliBinDir` 调 `resolveOsunaCliExecutablePath`。
- **「顺手改」会把品牌改动混进功能 diff。** 每次触碰都带一片无关重命名，审查看不清哪些是
  本次逻辑改动。

## 范围（实测，票 04 完成后需重新计数）

当前（票 06 已提交）约 10600 处 / 1200 文件，其中 `.ts` 8700 处 / 959 文件是主体。

- [ ] `packages/server/src/terminal/`：票 06 有意留下的一串 ——
      `resolvePaseoCliBinDir`、`injectPaseoHookCli`、`prependPaseoCliToPath`、
      `BuildTerminalEnvironmentInput` 的 `paseoCliBinDir` / `paseoHookCliPath` 两个入参、
      `paseo-env.ts`、`shell-integration/zsh/paseo-integration.zsh` 及读它的代码、
      `resolveZshShellIntegrationRuntimeDir` 里的 `-paseo-zsh-` 目录名
- [ ] `agent-hooks/`：生成模板内部的 `runPaseoHook` / `paseoEventForV1` / `paseoEvent`、
      插件 id `paseo-terminal-activity` 与落盘文件名 `plugins/paseo-terminal-activity.js`、
      `opencode-plugin.ts` 的 `hookMarker`、`removePaseoHooks` / `hasPaseoCommands`
- [ ] 其余各包的私有标识符与类型名
- [ ] 测试里的临时目录前缀（`createTempDir("paseo-…")`）与 fixture 字符串
- [ ] 不改：`CHANGELOG.md` 历史条目、`LICENSE` 原版权行、`public-docs/plugins/v0.7/`
      等版本锁定的历史文档、以及任何**主语就是旧名**的说明文字（见
      `.atw/spec/guides/cross-layer-thinking-guide.md`「The sweep corrupts text whose
      subject is the old name」）

## 改插件 id 与落盘文件名要当作升级路径处理

`plugins/paseo-terminal-activity.js` 改名后，老文件不会自己消失：`installAgentHooks`
只按新 `configFile` 写新文件，`uninstallAgentHooks` 也只删新路径。用户的
`~/.config/opencode/plugins/` 里会同时存在新旧两个插件，两个都被 OpenCode 加载，
同一个事件上报两次。改名必须连带删除旧文件名，并加一条回归。

- [ ] 验收：全仓 `rg -i paseo` 排除 `CHANGELOG.md`、`LICENSE` 原版权行、版本锁定历史文档后无命中
- [ ] 验收：装一次 CLI 起一个终端，agent hook 状态上报仍通（票 06 的链路没被改名碰坏）
- [ ] 验收：老插件文件存在时安装一次，确认旧文件被删、不会双份上报
- [ ] `npm run typecheck`、`npm run lint`、全量单测通过
