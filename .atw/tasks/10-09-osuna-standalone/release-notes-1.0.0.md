# 1.0.0 发布说明草稿

两条分隔线之间是要贴到 `CHANGELOG.md` 顶部的条目，`Release Notes Sync` 会把它同步成 GitHub Release 正文。正文只写了 `osuna-decouple-standalone` 分支代码里已经成立的行为。发版前先处理下面两处占位和文末的「待定事项」。

## 发版时要改的两处

1. 标题里的 `YYYY-MM-DD` 换成发布当天。
2. 「下载与文档」一段按当天的实际情况二选一，条目里放的是第一种：
   - 官网已上线、APK 已挂到 Release：保留现在的写法。
   - 任一项还没就绪：把那一项换成下面对应的一句，并删掉 Added 里对应的那一条；就绪后改回并重新同步 Release 正文。
     - 官网：`官网 osuna.chinhae.cc 即将上线，上线前请以本页和仓库里的 public-docs/ 为准。`
     - APK：`安卓 APK 即将上线，届时挂在本页的资源里，文件名 osuna-v1.0.0-android.apk。`

   官网没上线时，「Docker」一段的链接同时换成仓库里的同一篇：`https://github.com/LFT-OXY/Osuna/blob/main/public-docs/docker.md#upgrading-from-014x`。

---

## 1.0.0 - YYYY-MM-DD

Osuna 从这一版起是独立产品，不再是 Paseo 的 fork。命令、数据目录、环境变量和应用链接全部改用 Osuna 的名字，默认中继和网页端换成 Osuna 自己的，Hub 整体移除。0.14.x 的数据在首次启动时自动搬到新位置，旧数据不会被删除。

**升级前必读：** 桌面端自动迁移数据，不用做任何事。命令行、Docker 和手机端要按下面的说明手动处理。主机和连它的客户端要一起升级到 1.0.0，两边版本不同就连不上。

**多台主机：** 1.0.0 的桌面端、网页端和命令行只能连接 1.0.0 及以上的主机，0.14.x 的客户端也用不了 1.0.0 的主机。改名连同两边互发的消息一起改了，两个版本之间不做兼容。还没升级的主机在设置里它的「连接」页显示「{主机名} 需要更新」，其余主机照常可用；在那台主机上升级到 1.0.0 之后它会自动重新连接，不用删除重加。命令行连到 0.14.x 的主机时报出同样的原因并退出。

**桌面端：** 照常在侧栏的更新卡片里升级。首次启动时 Osuna 把 `~/.paseo` 改名为 `~/.osuna` 并在原位留一个链接，把应用数据目录从 `Paseo` 改名为 `Osuna`，再把主机列表、设置、草稿和面板布局导入新位置。成功时没有任何提示。数据目录搬不动时 daemon 不会启动，应用数据目录搬不动时 Osuna 弹出错误后退出，两种错误信息里都有可以手动执行的命令，下次启动会再试。主机列表和设置导入失败时可以选「重试」或「放弃旧数据继续」。

**命令行：** 命令从 `paseo` 改名为 `osuna`。0.14.x 通过桌面端装的 `~/.local/bin/paseo`（Windows 是 `paseo.cmd`）升级后失效，删掉它，再到 设置 → 集成 → 命令行 点「安装」。从源码构建的，检出 `v1.0.0` 后重新执行 `npm ci` 和 `npm run build:server`，入口改为 `node packages/cli/bin/osuna`。环境变量前缀从 `PASEO_` 改为 `OSUNA_`，旧名字不再生效，daemon 日志和命令行会逐个提示对应的新名字。

**Docker：** 镜像从 `ghcr.io/lft-oxy/paseo` 改为 `ghcr.io/lft-oxy/osuna`，容器内的用户和 home 改为 `osuna` 与 `/home/osuna`。容器不会自动迁移，启动新镜像之前按 [Docker 升级说明](https://osuna.chinhae.cc/docs/docker#upgrading-from-014x) 改卷挂载、环境变量并重命名数据目录。

**手机：** 上游的 Paseo 手机 App 不再受支持。远程使用请改用网页端 [osuna-app.chinhae.cc](https://osuna-app.chinhae.cc) 或安卓 APK。安卓包没有推送通知，需要被动提醒请用桌面端或网页端的桌面通知。

**上游 Paseo 桌面 App：** 机器上如果还装着它，请卸载。迁移会把它的应用数据目录一并搬走，它再打开时主机列表和设置是空的。

**下载与文档：** 官网在 [osuna.chinhae.cc](https://osuna.chinhae.cc)，各平台安装包见[下载页](https://osuna.chinhae.cc/download)。安卓 APK 在本页的资源里，文件名 `osuna-v1.0.0-android.apk`，签名证书的 SHA-256 是 `39:16:AF:AB:5B:A3:EB:34:BF:71:58:43:30:0A:30:42:BC:A9:86:07:9E:8D:33:D0:38:D6:C5:C1:78:63:4E:A9`。

### Added

- 0.14.x 的数据在首次启动时自动迁移到新位置，成功时不提示
- 迁移失败时显示旧路径、新路径和可以手动执行的命令，下次启动自动重试
- daemon 和命令行启动时逐个提示仍在使用的 `PASEO_*` 环境变量及对应的 `OSUNA_*` 名字
- 安卓 APK，包名 `com.chinhae.osuna`
- 官网 `osuna.chinhae.cc`，包含下载页、文档和更新日志

### Changed

- 客户端与主机的最低互通版本是 1.0.0，不再能与 0.14.x 互相连接
- 命令行从 `paseo` 改名为 `osuna`
- 数据目录从 `~/.paseo` 改为 `~/.osuna`
- 环境变量前缀从 `PASEO_` 改为 `OSUNA_`，旧名字不再生效
- 应用链接的 scheme 从 `paseo://` 改为 `osuna://`
- 仓库里的项目配置文件从 `paseo.json` 改为 `osuna.json`，旧文件名不再读取，升级后请把它改名
- MCP server 从 `paseo` 改名为 `osuna`，工具前缀随之变为 `mcp__osuna__*`；自己写的提示词、权限规则里引用了旧名字的要跟着改
- 默认中继改为 `osuna-relay.chinhae.cc`，默认网页端改为 `osuna-app.chinhae.cc`
- Docker 镜像改为 `ghcr.io/lft-oxy/osuna`，容器内的用户和 home 改为 `osuna` 与 `/home/osuna`
- 插件清单文件改为 `osuna-plugin.json`，`requirements` 的键改为 `osuna`，SDK 包改为 `@osuna/plugin`
- Skills 改名为 `/osuna-handoff`、`/osuna-advisor`、`/osuna-committee`，安装命令改为 `npx skills add LFT-OXY/Osuna`

### Removed

- Hub 和命令行的 `hub` 子命令
- 手机端的推送通知注册
- 对上游 Paseo 手机 App 和 Paseo 插件的支持

---

## 待定事项

下面是已知的升级缺口，怎么处理还没定。每条写的是现状，定下来之前不要写进上面的条目。

- `npm run dev:server` 在没设 `OSUNA_LOCAL_MODELS_DIR` 时会建出 `~/.osuna/models/local-speech`，抢先建出的目录会让之后的迁移被跳过（本票核对 `scripts/dev-daemon.sh` 与 `scripts/dev.ps1` 时发现）。只影响从源码跑开发 daemon 的机器。
- 回滚到 0.14.x 时两个版本仍可能同时写同一个 home：1.0.0 认得还活着的 `paseo.pid` 不会再起一个，但 0.14.x 不认得 `osuna.pid`。
- 随迁移带过来的 `push-tokens.json` 如果非空，daemon 仍会向推送服务发请求。
- Docker 容器内不留符号链接，升级后记录在旧路径下的 worktree 失效。
- Release 目前没有 Linux 桌面包，也没有安卓 APK；`Android APK Release` 只能手动派发。
- 官网的隐私页与条款页还有待补的法律信息（处理数据的法律依据、适用法律与争议解决地）。
