# 04 — 桌面 App 身份改名

**What to build:** 装上本地构建出来的桌面包后，应用名、Dock、菜单（「关于 Osuna」「退出 Osuna」）、窗口标题、系统通知都显示为 Osuna，bundle id 是 `com.chinhae.osuna.desktop`，产物名以 `Osuna-` 开头。原来的 Paseo 用户换装 Osuna 后，已添加的 host、应用设置、快捷键都还在，因为 userData 被显式固定在原来的 `Paseo` 目录。`paseo://` scheme 不变，只把协议的显示名改掉。`paseo open` 能找到并打开 Osuna.app；找不到时，提示里的下载地址指向本仓库的 Releases。所有依赖可执行文件名或 bundle 名的地方都同步改名，包括打包钩子、随包分发的 CLI shim、更新诊断用的 ShipIt 缓存目录、主进程里的应用名常量，以及写进用户 shell rc 的注释。内部标识遵循 ADR 0002，不改。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

- [ ] 本地出一个 macOS 包（不签名），安装到 /Applications 后：Dock、菜单、窗口标题、通知都显示 Osuna；`mdls` 或 Info.plist 显示的 bundle id 是 `com.chinhae.osuna.desktop`
- [ ] 安装后的 Osuna 使用 `~/Library/Application Support/Paseo` 作为 userData，本机原有的 host 列表和设置还在。开发模式下，worktree 隔离的 userData 和强制覆盖 userData 的行为保持原来的优先级
- [ ] `paseo open` 在 macOS 上能打开 Osuna.app；Windows 和 Linux 的候选路径也改成新名字；找不到时，提示的下载地址指向本仓库
- [ ] 随包分发的 CLI shim 在 Osuna.app 里能正常工作，例如 `paseo --version` 可以通过 shim 执行
- [ ] 更新诊断读取的是新 appId 对应的 ShipIt 目录
- [ ] 依赖旧名字的现有测试已经更新，typecheck 与 lint 通过
