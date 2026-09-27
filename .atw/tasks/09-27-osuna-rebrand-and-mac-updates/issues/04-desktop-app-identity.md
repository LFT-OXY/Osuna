# 04 — 桌面 App 身份改名

**What to build:** 装上本地构建出来的桌面包后，应用名、Dock、菜单（「关于 Osuna」「退出 Osuna」）、窗口标题、系统通知都显示为 Osuna，bundle id 是 `com.chinhae.osuna.desktop`，产物名以 `Osuna-` 开头。原来的 Paseo 用户换装 Osuna 后，已添加的 host、应用设置、快捷键都还在，因为 userData 被显式固定在原来的 `Paseo` 目录。`paseo://` scheme 不变，只把协议的显示名改掉。`paseo open` 能找到并打开 Osuna.app；找不到时，提示里的下载地址指向本仓库的 Releases。所有依赖可执行文件名或 bundle 名的地方都同步改名，包括打包钩子、随包分发的 CLI shim、更新诊断用的 ShipIt 缓存目录、主进程里的应用名常量，以及写进用户 shell rc 的注释。内部标识遵循 ADR 0002，不改。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] 本地出一个 macOS 包（不签名），安装到 /Applications 后：Dock、菜单、窗口标题、通知都显示 Osuna；`mdls` 或 Info.plist 显示的 bundle id 是 `com.chinhae.osuna.desktop`
- [x] 安装后的 Osuna 使用 `~/Library/Application Support/Paseo` 作为 userData，本机原有的 host 列表和设置还在。开发模式下，worktree 隔离的 userData 和强制覆盖 userData 的行为保持原来的优先级
- [x] `paseo open` 在 macOS 上能打开 Osuna.app；Windows 和 Linux 的候选路径也改成新名字；找不到时，提示的下载地址指向本仓库
- [x] 随包分发的 CLI shim 在 Osuna.app 里能正常工作，例如 `paseo --version` 可以通过 shim 执行
- [x] 更新诊断读取的是新 appId 对应的 ShipIt 目录
- [x] 依赖旧名字的现有测试已经更新，typecheck 与 lint 通过

## Comments

**实现结论（2026-09-27）**

- 身份：`electron-builder.yml` 的 appId `com.chinhae.osuna.desktop`、productName / executableName `Osuna`、协议显示名 `Osuna agent link`（scheme 仍为 `paseo`），产物名 `Osuna-*`，AppImage `--class=Osuna`。主进程 `APP_NAME` 改为 `Osuna`，窗口标题、菜单 about/quit、通知标题都跟随它。
- 数据目录：`main.ts` 在 `app.setName` 之后、首次写日志之前把 userData 固定到 `appData/Paseo`，并用 `log.transports.file.setAppName("Paseo")` 把 macOS 日志留在 `~/Library/Logs/Paseo`（用户确认）。强制覆盖和 worktree 隔离在后面再次 setPath，优先级不变。
- 同步改名：`after-pack.js`、`after-sign.js`、`linux-sandbox/index.js`、`bin/paseo`（`Osuna Helper.app`、`Osuna.bin`）、`bin/paseo.cmd`、ShipIt 目录 `com.chinhae.osuna.desktop.ShipIt`、Linux `Osuna.desktop` 与 class、`package.json` 的 desktopName、打包冒烟脚本、CLI `open.ts` 三平台候选路径与报错（下载地址指向本仓库 Releases）、shell rc 注释 `# Added by Osuna`、Windows trampoline 提示。
- 用户确认后追加：Nix 打包与 `nix.yml` 断言改为 `Osuna.app` / 新 appId；deb/rpm maintainer 改为 `oxy <oxy.chinhae@gmail.com>`、vendor 改为 `Osuna`；Release 标题改为 `Osuna <tag>`。`docs/release.md` 的首次打开步骤与 `docs/development.md` 的 Nix 产物路径随之更正。
- 留给其他票：Rosetta 下载地址里的 `Paseo-<ver>-arm64.dmg` 文件名随 07 一起改（它的基址仍指向上游，单改文件名只会得到坏链接）。`cli agent open` 的帮助文字 "Paseo Desktop"、`nix/desktop-package.nix` 的 `meta.description` 属于文案，没有改。测试里作为样例输入的 `/Applications/Paseo.app` 路径与名字无关，保留。
- 验证：先把 `desktop-packaging.test.ts`（shim 走 Helper、协议名）与 `updater.test.ts`（ShipIt 目录）改成新名字确认变红，再改实现转绿。desktop 单测 385 通过，CLI 单测 293 通过，两包 typecheck、改动文件 oxlint/oxfmt 通过。本地 `--mac --arm64` 出包：Info.plist 的 bundle id 为 `com.chinhae.osuna.desktop`，名称与 Helper 都是 Osuna，URL scheme 为 `paseo`，包内 `Resources/bin/paseo --version` 输出 0.9.0。
- 人工验证（前三条验收项）由用户在本机完成并确认通过：把包装进 /Applications 后看 Dock、菜单、通知；确认 userData 仍是 `~/Library/Application Support/Paseo`，已有 host 还在；`paseo open` 能拉起 Osuna.app。

**发版前 Windows 打包冒烟回归（2026-09-27）**

- 现象：在改名后的代码上手动派发 `Desktop Release`（`platform=windows`、`publish=false`，run 36322120386），打包冒烟失败。`Osuna.exe` 进程一直活着，但 60 秒内没有打开 CDP 端口，stdout、stderr 为空，找不到任何日志。v0.9.0（改名前）的同一冒烟 30 秒通过；本机 mac 包跑同一脚本也通过，所以问题只出现在 Windows 上。
- 定位：冒烟脚本改成失败时留存临时目录清单、日志和 `tasklist /v`（`2b09a3006`），拿到的进程列表里 `Osuna.exe` 的窗口标题是 "Error"，即主进程在写首条日志之前抛了未捕获异常，被 Electron 的错误弹窗挂住。原因是本票新加的 `app.setPath("userData", path.join(app.getPath("appData"), "Paseo"))`：冒烟把子进程的 `USERPROFILE` 指向临时目录，Windows 按它展开出一个不存在的 AppData，`getPath("appData")` 直接抛错。改名前，打包版启动时从不调用它。
- 修复（`859ba6e53`）：设置了 `PASEO_ELECTRON_USER_DATA_DIR` 时直接用它作为 userData，不再解析 appData。默认路径的行为不变。附带效果：强制覆盖时，日志也写进该目录，冒烟失败时能读到 desktop log。没有为真实用户改写 `USERPROFILE` 的情况加兜底（用户确认），因为 Electron 自己的默认 userData 也由 appData 推导。
- 验证：run 36324689620 通过。x64 冒烟完整跑通；产物为 `Osuna-Setup-0.9.0{,-x64,-arm64}.exe` 和两个架构的 zip。macOS 已在 run 36320612873 通过签名断言（arm64、x64 的 `Osuna.app` 与更新 zip 均 `ok`），本修复不改默认路径，不需要重跑。
