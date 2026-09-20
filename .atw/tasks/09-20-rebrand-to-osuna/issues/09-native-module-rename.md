# 09 — 原生模块目录改名：`packages/app/modules/paseo-*`

**What to build:** prd 的批次 4 范围含「`packages/app/modules/paseo-*` 的原生命名」，但它与
批次 4 其余部分不是一类活：原生模块的目录名会进 Gradle、podspec、Expo config plugin 与
autolinking，**验收依赖一次真实的安卓构建**，不是 typecheck 与单测能证明的。所以从票 04
拆出来单独成票。

**Impl:** done
**Status:** ready-for-agent

**Blocked by:** 04

## 为什么不能顺手改

原生模块名跨四层且彼此之间没有类型系统：目录名 → `expo-module.config.json` → Gradle 的
`Project.name` 与 Kotlin package → iOS podspec 与 Swift module 名 → autolinking 解析。
改错一层，JS 侧照样编译通过，装到设备上才崩。参见
`.atw/spec/guides/cross-layer-thinking-guide.md`「Product Identity Literals」的原生条目。

## 范围

- [x] `packages/app/modules/paseo-*` 目录改名，连带 `expo-module.config.json`、
      Gradle（`settings.gradle`、`build.gradle`、Kotlin package 路径）、podspec 与 Swift
      module 名、以及 JS 侧的 import
- [x] `docs/agent-stream-performance.md:51,81` 引用了该路径，跟着改
- [x] 检查 autolinking 是否按目录名解析；若是，确认新旧名不会同时被发现

## 落地时确认下来的事实（票面原先写错或没写的）

- **是四个模块，不是三个。** 票正文只列 `word-stream` / `native-trace` / `diff-prototype`，
  实际还有 `paseo-hardware-keyboard`（iOS 硬件键盘提交）。prd:135 同样漏了它。
- **autolinking 不按目录名解析。** `expo-modules-autolinking` 的 `nativeModulesDir` 默认是
  `<appRoot>/modules`，扫到子目录后取的是 **`package.json` 的 `name`**（`scanning.js`
  `resolveDependency`），Gradle 工程名由它经 `convertPackageToProjectName` 得出。目录名只影响
  人读代码时看到的东西 —— 两者分叉不会报错，只会骗人，所以一起改并加了断言。
- **iOS 的 Swift module 名来自 podspec 的文件名，不是 `s.name`**（`platforms/apple/apple.js`
  取 `path.basename(podspecFile)`）。生成的 `ExpoModulesProvider.swift` 按它 `import`，而
  CocoaPods 按 `s.name` 建 target。两者必须同时改。
- **新旧名不会同时被发现**：旧目录已 `git mv` 掉，`resolve` 输出每个模块各一条。

## Kotlin 包名映射

按 prd 身份表的 `sh.paseo` → `com.chinhae.osuna`：

| 旧 | 新 |
| --- | --- |
| `sh.paseo.wordstream` | `com.chinhae.osuna.wordstream` |
| `sh.paseo.trace` | `com.chinhae.osuna.trace` |
| `sh.paseo.diffprototype` | `com.chinhae.osuna.diffprototype` |

连带改的、票面没列但漏掉就会在设备上崩的四处：C++ `namespace paseo::diff`、CMake target
`paseo_diff_prototype`（与 `System.loadLibrary` 成对）、JNI 宏前缀
`Java_sh_paseo_diffprototype_PaseoDiffPrototypeModule`、`ios/tests/run.rb` 的
`PRODUCT_BUNDLE_IDENTIFIER`。

两个 podspec 的 `s.author` 从产品名 `Paseo` 改成仓库统一的 `chinhae <autuhae@gmail.com>`
（根 `package.json` 与 `packages/desktop/package.json` 已是此值），`homepage` 的
`https://paseo.sh` 按票 07 的规则改指 `https://github.com/LFT-OXY/Osuna`。

## 补的回归：`packages/app/src/native/local-native-modules.test.ts`

`cross-layer-thinking-guide.md`「The rule」要求静态配置必须有测试断言它与代码一致。这里的
七层此前一条断言都没有，而本票的验收构建在本机跑不了，等于改完没有任何自动证据。新测试按
`modules/*` 数据驱动，10 条注入式探针逐一验过会变红：目录名↔`package.json`、config↔Kotlin
类、Gradle namespace、config↔Swift 类、podspec 文件名↔`s.name`、CMake↔`loadLibrary`、
JNI 宏前缀、Kotlin/Swift 的 `Name()` 一致、TS 查找名↔声明名、Kotlin 源码目录↔`package`。

其中「Kotlin/Swift 的 `Name()` 一致」是第二轮才补的：只改一个平台时，另一个平台的声明仍能
让 TS 侧的查找成立，前九条全绿而模块在单一 OS 上已经坏了。合同表写进
`.atw/spec/app/frontend/directory-structure.md`。

## 验收

- [→] **真跑一次安卓构建**并装到设备/模拟器 —— **本机做不了**：无 Android SDK
      （`ANDROID_HOME` 空、`~/Library/Android/sdk` 不存在），且 `java` 是 1.8，AGP 需要 17+。
      **已并入票 05**：`android-apk-release.yml` 的触发条件是 `v*` / `android-v*` tag，
      而票 05 的验收本来就要推一个测试 tag，同一次构建即可证明 autolink 到位。
      设备端「功能可用」CI 给不了，留给后续的设备回归票。本票按静态证据结项。
- [x] iOS 侧至少跑通 `expo prebuild` —— `expo prebuild --platform ios --no-install`
      本机跑通（exit 0，生成 `ios/`，验完已删）。**但它证不到 podspec 与 Swift module 名**：
      `ExpoModulesProvider.swift` 由 `pod install` 生成，本机无 CocoaPods。这一半由下面的
      `resolve -p apple` 输出顶上 —— 那正是 `use_expo_modules!` 读的同一份数据。
- [x] 替代证据：`npx expo-modules-autolinking resolve -p android|apple` 两个平台各解析出
      新名一条、无旧名、无重复 —— android 三个工程名 `osuna-diff-prototype` /
      `osuna-native-trace` / `osuna-word-stream` 与新 FQCN；apple 两个
      `podName`/`swiftModuleNames` 为 `OsunaHardwareKeyboard` / `OsunaWordStream`，
      类名 `OsunaHardwareKeyboardModule`、`OsunaHardwareKeyboardReactDelegateHandler`、
      `WordStreamModule`。这正是 `use_expo_modules!` 与 settings.gradle 消费的输入。
- [x] `npm run typecheck`、`npm run lint` 全绿；`npm run format:files` 对改动文件通过
- [x] 单测：`src/native` + `src/word-stream` + `src/performance` 共 5 文件 65 例全绿
      （含新测试 33 例）。未跑全量套件（CLAUDE.md 禁止）。
- [x] 探针：`paseo-{word-stream,native-trace,diff-prototype,hardware-keyboard}`、
      `Paseo{WordStream,NativeTrace,DiffPrototype,HardwareKeyboard}`、`sh.paseo.*`、
      `paseo_diff_prototype`、`paseo::diff` 全仓零命中（`.atw/` 的任务与指南记录除外）；
      反向探针 `sh.osuna` / `osuna.sh` / `getosuna` / `com.chinhae.paseo` 零命中。

## 做构建验收前先清缓存

三个模块的 `android/.gradle/` 是按旧 project 名建的本地缓存，`git mv` 时跟着目录搬了过来
（gitignore，不进提交）。本次已删。跑验收构建用 `expo prebuild --clean`（`package.json` 的
`android:development` / `android:production` 脚本本来就带 `--clean`），否则旧的
`settings.gradle`、Pods 缓存或 `android/.cxx/` 里的旧 CMake target 可能掩盖接线错误。
