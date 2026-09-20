# 09 — 原生模块目录改名：`packages/app/modules/paseo-*`

**What to build:** prd 的批次 4 范围含「`packages/app/modules/paseo-*` 的原生命名」，但它与
批次 4 其余部分不是一类活：原生模块的目录名会进 Gradle、podspec、Expo config plugin 与
autolinking，**验收依赖一次真实的安卓构建**，不是 typecheck 与单测能证明的。所以从票 04
拆出来单独成票。

**Impl:** ready
**Status:** ready-for-agent

**Blocked by:** 04

## 为什么不能顺手改

原生模块名跨四层且彼此之间没有类型系统：目录名 → `expo-module.config.json` → Gradle 的
`Project.name` 与 Kotlin package → iOS podspec 与 Swift module 名 → autolinking 解析。
改错一层，JS 侧照样编译通过，装到设备上才崩。参见
`.atw/spec/guides/cross-layer-thinking-guide.md`「Product Identity Literals」的原生条目。

## 范围

- [ ] `packages/app/modules/paseo-*` 目录改名，连带 `expo-module.config.json`、
      Gradle（`settings.gradle`、`build.gradle`、Kotlin package 路径）、podspec 与 Swift
      module 名、以及 JS 侧的 import
- [ ] `docs/agent-stream-performance.md:51,81` 引用了该路径，跟着改
- [ ] 检查 autolinking 是否按目录名解析；若是，确认新旧名不会同时被发现

## 验收

- [ ] **真跑一次安卓构建**并装到设备/模拟器，确认原生模块被 autolink 到位、相关功能可用
- [ ] iOS 侧至少跑通 `expo prebuild`，确认 podspec 与 Swift module 名一致
- [ ] `npm run typecheck`、`npm run lint`、全量单测通过
