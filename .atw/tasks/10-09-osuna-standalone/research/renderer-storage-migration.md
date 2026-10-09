# Electron 渲染层存储跨 origin 迁移（`paseo://app` → `osuna://app`）

研究日期 2026-10-09。回答工单 `map-issues/02-renderer-storage-migration.md`。需求边界见 `research/interview-decisions.md`（Q4、Q6、Q6c）。

一句话结论：**选方案 a（主进程开隐藏窗口导出 / 导入），导出端按"枚举全部键"而不是"按键名清单"工作；方案 b 因 Chromium 把 origin 编进 leveldb 键里且块经 Snappy 压缩而不可行；方案 c 在 Electron / Chromium 里不存在。**

---

## 1. 渲染层到底存了什么

### 1.1 现状：所有持久化都落在 `paseo://app` 这一个 origin

- 打包版渲染器只从 `paseo://app` 加载：`packages/desktop/src/main.ts:111`（`APP_SCHEME = "paseo"`）、`:563-568`（`registerSchemesAsPrivileged`，`standard: true, secure: true, supportFetchAPI: true`）、`:797`（`loadURL(\`${APP_SCHEME}://app…\`)`）、`:936-960`（`protocol.handle`，SPA 回退到 `index.html`）。开发版走 `http://localhost:8081`（`:793`），不在迁移范围。
- 主窗口用默认 `session`（`main.ts:697-712` 的 `webPreferences` 没有 `partition`），所以数据在 `userData/Local Storage/leveldb` 与 `userData/IndexedDB/`。
- 渲染层没有直接用 `window.localStorage`：全部经 `@react-native-async-storage/async-storage` 2.2.0，其 web 实现就是 `window.localStorage` 的同步包装（`node_modules/@react-native-async-storage/async-storage/lib/module/AsyncStorage.js:24-60`）。`expo-secure-store`、`react-native-mmkv`、Cache API、Service Worker、cookie 均未使用（`packages/app/src` 全文 grep 无命中）。
- zustand `persist` 统一经 `createValidatedPersistStorage(AsyncStorage, Schema)` 包装（`packages/app/src/storage/validated-persist-storage.ts`）：解析失败就 `removeItem`。这意味着**导入时写入的值必须是原样字节**，任何改写都会被校验层当成坏数据删掉。
- 本机实测（`~/Library/Application Support/Paseo`，2026-10-09）：`Local Storage` 548 KB，`IndexedDB` 15 MB（`paseo_app_0.indexeddb.leveldb` 10 MB + `paseo_app_0.indexeddb.blob` 4 MB），`Partitions` 3.2 MB（内嵌浏览器 profile），整个 userData 19 MB。

### 1.2 localStorage 键清单（经 AsyncStorage 写入）

| 键 | 写入点 | 体积量级 | 丢了会怎样 |
|---|---|---|---|
| `@paseo:daemon-registry` | `runtime/host-runtime.ts:1314`，`:2015` 写入 | 几 KB（HostProfile 数组） | **主机列表全丢**。本机 daemon 会被 `bootstrapDefaultLocalhost()`（`:1543`）重新探测到，远程 / 配对主机要重新配对。最关键的一项。 |
| `@paseo:client-id-v1` | `utils/client-id.ts:5` | 36 B | 客户端换身份。daemon 只拿它拼 `sessionConnectionKey(principalId, clientId)`（`packages/server/src/server/websocket-server.ts:2769`），无持久绑定，可接受。 |
| `@paseo:app-settings`、`@paseo:settings`（旧）、`@paseo:settings-migrations` | `hooks/use-settings/keys.ts:3-13` | < 2 KB | 主题、通知等设置回默认；迁移标记丢失会让设置迁移重跑。 |
| `@paseo:create-agent-preferences` | `create-agent-preferences/storage.ts:9` | < 2 KB | 新建 agent 默认 provider/model 回默认。 |
| `@paseo:changes-preferences`、`diff-wrap-lines`（旧） | `hooks/use-changes-preferences/storage.ts:5-6` | < 1 KB | diff 偏好回默认。 |
| `@paseo:changes-ship-default:<repoRoot>` | `git/use-actions.tsx:356`（动态键，每仓库一个） | < 100 B/个 | PR/merge 默认选项回默认。 |
| `@paseo:keyboard-shortcut-overrides` | `hooks/use-keyboard-shortcut-overrides.ts:11` | < 2 KB | 自定义快捷键丢。 |
| `@paseo:preferred-editor` | `hooks/use-preferred-editor.ts:9` | < 100 B | 首选编辑器回默认。 |
| `@paseo:sidebar-callout-dismissals` | `contexts/sidebar-callout-context.tsx:37` | < 1 KB | 已关闭的提示再弹一次。 |
| `@paseo/provider-snapshot-index/v2`、`@paseo/provider-snapshot/v2:[serverId,"cwd"|"hash",…]` | `data/provider-snapshot-cache.ts:17-18,95-99`（动态键，数量多） | **Local Storage 的大头**（本机 55+ 条，数十 KB 到数百 KB） | 纯缓存，可从 daemon 重建；丢了只是首屏慢。 |
| `paseo:last-workspace-route-selection` | `stores/last-workspace-selection.ts:8` | < 200 B | 启动恢复不到上次工作区（见 `docs/expo-router.md`）。 |
| `paseo-drafts` | `stores/draft-store/index.ts:437`（zustand） | 几 KB–数十 KB | **未发送的输入框草稿丢**，用户可感知。 |
| `panel-state`（version 16） | `stores/panel-store/index.ts:289-292` | 几 KB | 面板布局回默认。 |
| `workspace-layout-state` | `stores/workspace-layout-store.ts:1668` | 几 KB–数十 KB | 每工作区的分栏 / 标签布局丢。 |
| `workspace-browser-store` | `desktop/browser/store/index.ts:78` | 几 KB | 内嵌浏览器标签索引丢（cookie 不在这里，见 1.4）。 |
| `sidebar-view`、`sidebar-group-mode`（旧） | `stores/sidebar-view-store.ts:10-11` | < 1 KB | 侧栏视图回默认。 |
| `sidebar-collapsed-sections` | `stores/sidebar-collapsed-sections-store/index.ts:39` | < 1 KB | 折叠状态回默认。 |
| `sidebar-project-workspace-order` | `stores/sidebar-order-store.ts:163` | 几 KB | 手动排序丢。 |
| `session-history-scope` | `session-history/internal/scope-store.ts:8` | < 1 KB | 历史范围回默认。 |
| `workspace-service-route-preferences` | `workspace-service-routes/store.ts:32` | < 1 KB | 服务路由偏好回默认。 |
| `@paseo:project-icon-cache` | `projects/icon-cache.ts:6` | — | **仅原生**；web 端走 IndexedDB（见 1.3）。 |
| `@paseo:expo-push-token:<serverId>` | `push-notifications/internal/subscriptions.ts:9` | — | 仅原生（web 入口不用它）。 |
| `@paseo:replica-cache` | `runtime/replica-cache/legacy-cleanup.ts:3` | — | 旧键，启动时主动删除，不迁。 |
| `@paseo:e2e`、`@paseo:e2e-*` | `host-runtime.ts:1317`、`e2e/support/fixtures.ts:14,161-179` | — | 测试专用，不迁。 |

磁盘上的实际键格式（本机 leveldb 字节扫描）：`_paseo://app\x00\x01<键>`（`\x01` 为键编码格式字节），另有 `META:paseo://app` 元数据记录；块经 Snappy 压缩（`@paseo` 这类重复前缀在 .ldb 里以回引形式出现，`strings` 直接读不到完整键名）。格式依据见 7.3。

### 1.3 IndexedDB 数据库清单

| 数据库 | object store | 写入点 | 体积 | 丢了会怎样 |
|---|---|---|---|---|
| `paseo-replica-row-store`（v1） | `rows`（keyPath `[serverId, kind, id]`）、`meta`（`schema_version`） | `runtime/replica-cache/row-store.web.ts:14-18,69-78` | **10 MB leveldb + 4 MB blob（本机）** | agent / 工作区目录副本缓存。可从 daemon 全量重拉，但首启会空白一段时间；离线时历史不可见。 |
| `paseo-project-icon-cache`（v1） | `key-value` | `projects/icon-cache-storage.web.ts:3-10` | 小 | 项目图标缓存，可重建。 |
| `paseo-attachment-bytes`（v1） | `attachments`（keyPath `id`，值含 **`Blob`**） | `attachments/web/indexeddb-attachment-store.ts:19-21` | 取决于草稿附件 | **草稿里的附件字节丢**（`paseo-drafts` 引用其 id）。导出时 Blob 必须转 ArrayBuffer/base64。 |
| `paseo-replica-cache` | — | `runtime/replica-cache/legacy-cleanup.web.ts:1` | — | 旧库，启动时 `deleteDatabase`，不迁。 |

磁盘目录名：`IndexedDB/paseo_app_0.indexeddb.leveldb` 与 `.blob` —— Chromium 把 origin 序列化为 `scheme_host_port`（`paseo_app_0`），端口 0 表示无端口。

### 1.4 不在 `paseo://app` origin 但会被改名波及的东西

| 位置 | 内容 | 改名影响 |
|---|---|---|
| `userData/Partitions/paseo-browser*` | 内嵌浏览器 profile（`persist:paseo-browser`，`packages/desktop/src/features/browser-profile.ts:1`；`main.ts:240`；`app/src/desktop/browser/resident-webviews.ts:307`），含用户登录各站点的 Cookies / Local Storage | 里面的 origin 是用户访问的网站，**不**随 app scheme 变。若分区名改成 `persist:osuna-browser`，只需把目录 `Partitions/paseo-browser` 改名为 `Partitions/osuna-browser`（在 `ready` 前做）；或分区字符串不改（归 07 号工单的例外清单决定）。 |
| `userData/desktop-settings.json`、`window-state.json` | 主进程 JSON（`settings/desktop-settings.ts:43`、`settings/window-state.ts:44`） | 随 userData 目录整体搬，无 origin 问题。 |
| `userData/Session Storage`、`Cookies`、`DIPS`、`WebStorage/QuotaManager` | Chromium 内部 | 随目录搬；`QuotaManager`（sqlite）记录的是 storage key，导入后会为 `osuna://app` 新增一行，旧行留着无害。 |
| `~/Library/Logs/Paseo`（macOS） | electron-log，`log.transports.file.setAppName(USER_DATA_DIR_NAME)`（`main.ts:142`） | 见第 6 节。 |
| 浏览器网页端（`app.paseo.sh` → `osuna-app.chinhae.cc`） | 同一套键，但在浏览器里按站点 origin 隔离 | 换域名必然丢，无法迁移；Q6d 已定"现有用户重新配对"，本文不处理。 |

---

## 2. 三方案对比

### 方案 a：主进程开隐藏 `BrowserWindow` 导出 / 导入（推荐）

做法：`registerSchemesAsPrivileged` 同时登记 `paseo` 与 `osuna`；`protocol.handle("paseo")` 只服务一个内联的导出页（不再服务 app 包）；隐藏窗口加载 `paseo://app/__migrate-export`，`executeJavaScript` 枚举 `localStorage` 全部键和 `indexedDB.databases()` 全部库并序列化返回；再开隐藏窗口加载 `osuna://app/__migrate-import` 写入。

优点：只用 Web 标准 API 与 Electron 公开 API，不依赖 Chromium 磁盘格式；导出 / 导入脚本与渲染器代码解耦，渲染器改键名不影响导出；可测、可重试、可幂等。
缺点：首启多花 1–3 秒（两个隐藏窗口 + 15 MB 数据过一遍 IPC）；需要让 `paseo` scheme 在迁移代码存活期间继续被登记为 privileged（标 `COMPAT`，到期删除）。

### 方案 b：直接改 `Local Storage/leveldb` 与 `IndexedDB/` 目录（不可行）

- Local Storage 的 origin 不在目录名里，而在**每条 leveldb 记录的键**里（`_paseo://app\x00\x01<键>`、`META:paseo://app`，本机字节扫描证实）。改 origin 等于重写整个 leveldb，需要在 Electron 里带一个 leveldb 实现（原生模块要按 Electron ABI 重编）。
- .ldb 块经 Snappy 压缩，不能用字节替换。
- IndexedDB 目录名 `paseo_app_0.indexeddb.leveldb` 可以改，但库内键同样带 origin 标识，`WebStorage/QuotaManager` 的 sqlite 也按 storage key 记账；Chromium 自己还有把第一方 IndexedDB 迁到 `WebStorage/<bucket_id>/` 新路径的待办（7.3），格式随版本变（Electron 44.2.0 = Chromium 152，`packages/desktop/package.json:42`），每次升级 Electron 都可能失效。
- 结论：风险不可控，排除。外部依据见第 7 节。

### 方案 c：`session` / `protocol` 层让两个 scheme 共享存储（不存在）

- Chromium 的 storage key 由 origin（scheme + host + port）决定，`registerSchemesAsPrivileged` 只决定 scheme 是否"standard / secure"，不提供 origin 别名；`session.fromPartition` 划分的是整个 profile（目录），不能把两个 origin 映射到同一个 key。
- 唯一"共享"的办法是继续从 `paseo://app` 加载，这与 Q4 冲突。
- 结论：排除。外部依据见第 7 节。

---

## 3. 推荐方案的伪代码级步骤

迁移分两层，都在主进程、都在首个窗口创建之前完成。**层 1 在 `app.ready` 之前**（目录级），**层 2 在 `app.whenReady()` 之后、`createMainWindow()` 之前**（origin 级）。

### 3.1 层 1：userData 目录 `Paseo` → `Osuna`（`ready` 前，早于第一条日志）

```
oldDir = join(appData, "Paseo");  newDir = join(appData, "Osuna")
if PASEO_ELECTRON_USER_DATA_DIR / OSUNA_ELECTRON_USER_DATA_DIR 已设置 → 跳过本层（测试与 dev 用）
if !app.isPackaged → 跳过本层（dev 用 Paseo-<worktree> 隔离目录，见 main.ts:306-337）

hasRealData(dir) := exists(dir/"Local Storage") || exists(dir/"IndexedDB") || exists(dir/"desktop-settings.json")

if exists(oldDir) && !hasRealData(newDir):
    if exists(newDir):                      # 只有 logs/ 之类的空壳（见第 6 节 Windows/Linux 日志坑）
        rename(newDir, newDir + ".pre-migration-" + timestamp)   # 不删，留着
    try rename(oldDir, newDir)
    catch EXDEV → copyDir(oldDir, newDir) 后不删 oldDir   # 同父目录下几乎不会发生，仍按 Q6c 兜底
    catch EPERM/EBUSY/ENOTEMPTY（Windows 占用、杀毒扫描、旧 Paseo.app 正在运行）→
        记录到临时日志，本次用 newDir 空启动，下次启动再试（层 1 自身幂等：条件判断不变）
elif exists(oldDir) && hasRealData(newDir):
    什么都不做（Q6c：新旧并存以新为准，旧的原封不动）
app.setPath("userData", newDir)
log.transports.file.setAppName("Osuna")      # 必须在上面的 rename 之后，否则 electron-log 先把 Osuna/ 建出来
同时把 Partitions/paseo-browser* 改名为 osuna-browser*（若 07 号工单决定改分区字符串）
```

### 3.2 层 2：origin 级导出 / 导入（`whenReady` 后，窗口前）

```
marker = desktop-settings.json → migrations.rendererOriginImportedFromPaseo   # 见第 5 节
if marker.done → 直接建主窗口

protocol.handle("paseo", req => req.url 是 paseo://app/__migrate-export ? 内联 HTML : 404)
protocol.handle("osuna", 现有 app 处理器 + 额外匹配 osuna://app/__migrate-import 返回内联 HTML)

export = await withTimeout(30s, async () => {
    win = new BrowserWindow({ show:false, webPreferences:{ sandbox:true, contextIsolation:true } })
    await win.loadURL("paseo://app/__migrate-export")          # 必须是顶层窗口，不能用 iframe（第三方存储分区会让 iframe 看到空存储）
    result = await win.webContents.executeJavaScript(EXPORT_SCRIPT)   # 返回值经结构化克隆回主进程
    win.destroy(); return result
})
# EXPORT_SCRIPT 要点：
#   ls = Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])     —— 枚举全部键，不认键名
#   dbs = await indexedDB.databases()                                          —— 枚举全部库
#   每库：open(name) 读 version；每个 store 记 keyPath / autoIncrement / indexes；cursor 遍历 (key, value)
#   值里的 Blob → arrayBuffer()（并记 type）；其余值直接返回（结构化克隆支持 ArrayBuffer/Date/Map/Set 等，不支持 Blob/DOM 对象）
#   返回 { localStorage: ls, indexedDB: dbs }

if export 为空（0 键 0 库）→ marker.done = true，建主窗口

await session.defaultSession.clearStorageData({ origin:"osuna://app", storages:["localstorage","indexdb"] })
      # 让导入成为"整体替换"，天然幂等：上次导入一半的残留会被清掉
import = await withTimeout(60s, async () => {
    win = new BrowserWindow({ show:false, webPreferences:{ sandbox:true, contextIsolation:true, preload: migrationPreload } })
    await win.loadURL("osuna://app/__migrate-import")
    # 载荷走 ipcMain.handle("migration:pull") 由页面主动拉取，而不是塞进 executeJavaScript 的代码字符串（15 MB 字面量会很慢）
    await win.webContents.executeJavaScript(IMPORT_SCRIPT)
    win.destroy()
})
# IMPORT_SCRIPT 要点：
#   localStorage：for [k,v] → localStorage.setItem(mapKey(k), v)    —— 值原样写回，mapKey 见 3.3
#   indexedDB：open(mapDbName(name), version) 的 upgradeneeded 里按导出元数据 createObjectStore/createIndex；
#             然后对 out-of-line key 的 store 用 put(value, key)，in-line key 的 store 用 put(value)；ArrayBuffer 还原为 Blob
#   全部 transaction complete 后 resolve

marker.done = true（写 desktop-settings.json，temp+rename 原子写）
建主窗口。旧 origin `paseo://app` 的数据不删（Q6c）。
```

### 3.3 键名映射：导出端"认全部"，导入端"查表改名"

渲染器改名后会去读 `@osuna:daemon-registry`、`osuna-drafts`、`osuna-replica-row-store` 等新名字。导出脚本不依赖键名（枚举全部），所以**"导出脚本跑在旧 origin 找不到键"这个失败模式不成立**。改名发生在导入端的一张映射表里：

```
mapKey(k)  = k.replace(/^@paseo:/, "@osuna:").replace(/^@paseo\//, "@osuna/").replace(/^paseo:/, "osuna:").replace(/^paseo-/, "osuna-")
mapDbName  = 同一规则（paseo-replica-row-store → osuna-replica-row-store 等）
```

不匹配任何前缀的键（`panel-state`、`workspace-layout-state`、`sidebar-view`…）原样保留。映射表与键名清单（第 1 节）放一起写单测：对清单里每个旧键断言 `mapKey(旧键) === 渲染器新常量`。

如果 07 号工单最终决定**存储键字符串不改**（用户看不见），映射表退化为恒等函数，其余步骤不变。

---

## 4. 失败模式与幂等重试

| 失败点 | 处理 |
|---|---|
| 层 1 目录 rename 失败（Windows 占用、权限、杀毒） | 不写标记、本次以空 `Osuna` 启动、下次再试。连续失败 3 次后写 `migrations.userDataMoveGaveUp = true` 并停止尝试，交给 08 号工单的 UX 提示。所有计数写在新 userData 的 `desktop-settings.json`。 |
| 导出页加载失败 / 超时 | 不写标记，销毁窗口，下次启动重试；同样 3 次封顶。 |
| 旧 origin 为空 | 立即写 `done`，不再尝试（新装用户只付一次隐藏窗口的成本，约几百毫秒；若层 1 发现根本没有旧 `Paseo` 目录，连隐藏窗口都不开）。 |
| 导入到一半崩溃 / 断电 | 标记未写 → 下次重跑；重跑前 `clearStorageData({origin:"osuna://app"})` 清掉半成品，再整体写入。旧 origin 数据一直在，重跑随时可做。 |
| 导入成功但标记写入前崩溃 | 下次重跑一遍（结果相同），无害。 |
| 导入阶段 IndexedDB `blocked` | 不会发生：隐藏窗口是该 origin 唯一连接，且主窗口尚未创建。 |
| 导出值含 Blob | 导出脚本转 ArrayBuffer；若有未知不可克隆类型，捕获后跳过该条并记日志，不让整库失败。 |
| 值超 localStorage 配额 | 不会：同一份数据刚刚存得下旧 origin，配额按 origin 算。 |
| 用户同时装着上游 Paseo.app（共用 `appData/Paseo` 与 `~/.paseo`） | 层 1 的 move 会把上游 Paseo 的数据一并搬走，上游 Paseo 变成空白。这是 Q6c "move 不 copy" 与 ADR 0002 "并排安装" 的冲突，需要主会话定夺：(i) 接受，发布说明写明；(ii) 检测到 `/Applications/Paseo.app`（macOS）时改为 copy。 |
| 迁移代码到期删除后仍有老用户 | `COMPAT(rendererOriginMigration)` 注明删除日期；删除后不再登记 `paseo` scheme，老数据永久留在 `paseo://app` origin 下，文档写明。 |

渲染器侧不需要知道迁移存在：`HostRuntime.loadFromStorage()`（`host-runtime.ts:1480`）照常读新键。

---

## 5. 完成标记放哪

放在**新 userData** 的 `desktop-settings.json` → `migrations` 对象里，沿用现有模式（`settings/desktop-settings.ts:68-83` 已有 `legacyRendererSettingsImported`、`daemonStopOnQuitDefaultApplied`，schema 是 `looseObject` + `.catch`，追加字段不破坏旧版本读取）：

```
migrations: {
  rendererOriginImportedFromPaseo: boolean,      // 层 2 完成
  rendererOriginImportAttempts: number,          // 层 2 失败计数
  userDataMovedFromPaseo: boolean,               // 层 1 完成（含"旧目录不存在"的情形）
  userDataMoveAttempts: number
}
```

不放在渲染层 localStorage 里：标记要在开窗之前判断，而且导入前要 `clearStorageData` 新 origin，标记放那里会被自己清掉。
不放在旧目录里：旧目录按 Q6c 原封不动。

---

## 6. userData 目录重命名的平台注意点

| 平台 | 路径 | 注意点 |
|---|---|---|
| macOS | `~/Library/Application Support/Paseo` → `…/Osuna` | 同一卷同一父目录，`rename` 原子。日志 `~/Library/Logs/Paseo` **不动**（日志不是用户数据，Q6c 不删旧数据），新日志经 `setAppName("Osuna")` 落到 `~/Library/Logs/Osuna`。`~/Library/Preferences/com.chinhae.osuna.desktop.plist`、`Saved Application State` 跟 appId 走，早已是 Osuna。 |
| Windows | `%APPDATA%\Paseo` → `%APPDATA%\Osuna` | (1) electron-log 在 Windows 把日志写到 `%APPDATA%\<appName>\logs\`，即 userData 同名目录。`main.ts:142-148` 的 `setAppName` 与第一条 `log.info` 若发生在 rename 之前，会先把 `Osuna\logs` 建出来，随后 rename 因目标已存在而失败——这就是 3.1 里 `hasRealData` 判空壳的原因。(2) 目录内任一文件被占用（上游 Paseo 正在运行、资源管理器打开、杀毒扫描）→ `EPERM`/`EBUSY`，按第 4 节重试。(3) 目标目录已存在时 `fs.rename` 不会覆盖目录。 |
| Linux | `~/.config/Paseo` → `~/.config/Osuna`（受 `XDG_CONFIG_HOME` 影响） | electron-log 同样写 `~/.config/<appName>/logs/`，同 Windows 的顺序坑。若用户把 `~/.config/Paseo` 做成了符号链接，`rename` 搬的是链接本身，目标内容不动，可接受。 |
| 全平台 | `PASEO_ELECTRON_USER_DATA_DIR`（将改名 `OSUNA_…`）已设置 | 跳过层 1（`main.ts:137-141`；e2e 与打包冒烟都靠它，`packages/desktop/e2e/packaged-app-smoke.js:137`）。 |

外部依据（`fs.rename` 的 `EXDEV`、Windows 目标存在行为、`rename(2)` 语义、electron-log 路径）见第 7 节。

---

## 7. 外部依据

均为实际访问过的一手页面。【原文】= 页面直接支持；【推断】= 由来源推出。Electron 44.2.0 对应 Chromium 152.0.7977.76（https://releases.electronjs.org/release/v44.2.0 【原文】）。

### 7.1 custom scheme 与 origin（支撑方案 c 不存在、方案 a 的前提）

- `standard: true` 在 Electron 内部调用 `url::AddStandardScheme(scheme, url::SCHEME_WITH_HOST)`，`secure: true` 调用 `url::AddSecureScheme`；`registerSchemesAsPrivileged` 在 `Browser::is_ready()` 为真时抛错 —— https://raw.githubusercontent.com/electron/electron/main/shell/browser/api/electron_api_protocol.cc 【原文】。
- "By default web storage apis (localStorage, sessionStorage, webSQL, indexedDB, cookies) are disabled for non standard schemes"；`protocol.handle` 作用于默认 session，自定义 partition 要用 `ses.protocol.handle`；"must be called before the ready event and can be called only once" —— https://electronjs.org/docs/latest/api/protocol 【原文】。
- `url::Origin` 对标准 URL 产出 (scheme, host, port) 三元组，"Two tuple origins are same-origin if the tuples are equal"；非标准 URL 为 opaque origin —— https://chromium.googlesource.com/chromium/src/+/HEAD/url/origin.h 【原文】。`paseo://app` 与 `osuna://app` 的 scheme 不同即不同 origin → 不同 storage key【推断】。
- `StorageKey` 以 `url::Origin` 为核心 —— https://chromium.googlesource.com/chromium/src/+/012970d8314360215e7f69f479e41bd5603ae762/third_party/blink/public/common/storage_key/storage_key.h 【原文】。
- `session.fromPartition` 只按 partition 字符串区分 session，不提供 origin 映射；`ses.clearStorageData({ origin, storages })` 的 `origin` 形如 `scheme://host:port`，`storages` 含 `indexdb`、`localstorage` —— https://raw.githubusercontent.com/electron/electron/main/docs/api/session.md 【原文】。
- `secure` 只影响混合内容 / 可信上下文判断（`IsOriginPotentiallyTrustworthy` 查 `url::GetSecureSchemes()`），不决定存储可用性 —— https://chromium.googlesource.com/chromium/src/+/673a5aee77ad12e118c8edac73359acdeb7f491c/services/network/public/cpp/is_potentially_trustworthy.cc 【原文】；ServiceWorker 另需 `allowServiceWorkers` —— https://raw.githubusercontent.com/electron/electron/main/docs/api/structures/custom-scheme.md 【原文】。本应用不用 SW，现有权限集已够。

### 7.2 隐藏窗口、executeJavaScript、IPC 序列化（方案 a 的机制）

- `contents.executeJavaScript(code[, userGesture])` 返回 Promise，"Evaluates code in page" —— https://raw.githubusercontent.com/electron/electron/main/docs/api/web-contents.md 【原文】。
- `show: false` 只控制创建时是否显示，`ready-to-show` 模式本身依赖隐藏窗口完成渲染 —— https://raw.githubusercontent.com/electron/electron/main/docs/api/browser-window.md 【原文】；隐藏窗口里 JS 与 localStorage 可用【推断，文档无否定】。`backgroundThrottling` 会节流定时器（web-preferences.md【原文】），导出脚本不要依赖 `setTimeout` 计时。
- IPC 参数"serialized with the Structured Clone Algorithm, just like `window.postMessage`"，Functions / Promises / Symbols / WeakMap / WeakSet 抛错 —— https://www.electronjs.org/docs/latest/api/ipc-renderer 【原文】。Blob 能否过 IPC 未逐字核到，保守做法是在导出脚本里转 ArrayBuffer（结构化克隆明确支持）【推断】。
- 第三方存储分区：Chrome 115 起"data written by storage APIs such as Local Storage and IndexedDB within an iframe can no longer be accessed by all contexts sharing the same origin … only available to contexts that share both the same origin and the same top-level site" —— https://developers.google.com/privacy-sandbox/cookies/storage-partitioning 【原文】。Chromium 152 适用，所以导出页必须是顶层窗口，不能是 `osuna://app` 页里的 `<iframe src="paseo://app/…">`【推断】。

### 7.3 Chromium 磁盘布局（支撑方案 b 不可行）

- Local Storage leveldb schema：`VERSION`→`1`；`META:<serialized StorageKey>`；`_<serialized StorageKey>\x00<key>`，"StorageKeys are serialized as origins, not URLs, i.e. with no trailing slashes" —— https://chromium.googlesource.com/chromium/src/+/123.0.6312.86/components/services/storage/dom_storage/local_storage_impl.cc 【原文】；第一方 `SerializeForLocalStorage()` 返回 `origin_.Serialize()` —— https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/common/storage_key/storage_key.cc 【原文】。本机实测键为 `_paseo://app\x00\x01<键>`，`\x01` 是键编码格式字节（Latin-1；`\x00` 为 UTF-16），与上述 schema 一致。
- IndexedDB 第一方默认 bucket 走 legacy 路径 `IndexedDB/<GetIdentifierFromOrigin>.indexeddb.leveldb`，第三方 / 非默认 bucket 走 `WebStorage/<bucket_id>/IndexedDB/…`，并有把第一方也迁到新路径的待办（crbug 40855748） —— https://chromium.googlesource.com/chromium/src/+/HEAD/content/browser/indexed_db/file_path_util.cc 【原文】；`GetIdentifierFromOrigin` = `scheme + "_" + host + "_" + port`，无端口编码为 0 —— https://chromium.googlesource.com/chromium/src/+/HEAD/storage/common/database/database_identifier.cc 【原文】→ `paseo_app_0`【推断，与本机目录名一致】。
- IndexedDB leveldb 内部也带 origin 标识（旧版 `ComputeOriginIdentifier` = identifier + "@1"） —— https://chromium.googlesource.com/chromium/src/+/581ff14023b243973f1f722d3ab83115a3f2e991/content/browser/indexed_db/indexed_db_backing_store.cc 【原文，旧版本；当前 HEAD 是否仍含 origin 未核到】。
- leveldb "may only be opened by one process at a time"，用 OS 文件锁（`LOCK`） —— https://raw.githubusercontent.com/google/leveldb/main/doc/index.md 【原文】。
- 未找到一手来源：`kLocalStoragePath` / `kLocalStorageLeveldbName` 的字面值（本机目录为 `Local Storage/leveldb`，以实测为准）。

### 7.4 `fs.rename` 与路径（支撑第 6 节）

- Node 文档只说 "Renames oldPath to newPath"，错误语义来自系统调用 —— https://beta.docs.nodejs.org/fs/promises-api 【原文】。
- Linux `rename(2)`：同文件系统内原子；目标为目录时必须不存在或为空；跨挂载点 `EXDEV`；目录被进程占用 `EBUSY`；`ENOTEMPTY`/`EEXIST` —— https://man7.org/linux/man-pages/man2/rename.2.html 【原文】。
- Windows：libuv 用 `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING)` —— https://raw.githubusercontent.com/libuv/libuv/v1.x/src/win/fs.c 【原文】；MoveFileEx："When moving a directory, the destination must be on the same drive"，目标为已存在目录时失败，`MOVEFILE_COPY_ALLOWED` 只对文件有效 —— https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw 【原文】。目录被占用时映射到 Node 的具体 `EPERM`/`EBUSY` 码未找到一手来源，实现时两者都按"可重试"处理。
- macOS APFS 默认大小写不敏感、保留大小写 —— https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/APFS_Guide/FAQ/FAQ.html 【原文】；`Paseo`→`Osuna` 不是仅大小写变化，不触发【推断】。
- Electron：`userData` 默认为 `appData + 应用名`；`setAppLogsPath()` 无参时 macOS 为 `~/Library/Logs/<name>`，Linux/Windows 在 userData 下；文档明确要求 `ready` 前设置的是 `sessionData`，而 `sessionData` 默认派生自 `userData`，故 `userData` 实践上也要在 `ready` 前改；`setName` "does not affect the name that the OS uses" —— https://raw.githubusercontent.com/electron/electron/main/docs/api/app.md 【原文 + 推断】。
- electron-log 5.4.3 的日志目录：macOS `~/Library/Logs/<appName>`，其他平台 `<appData>/<appName>/logs`（`APPDATA` / `XDG_CONFIG_HOME` 优先） —— `node_modules/electron-log/src/node/NodeExternalApi.js:15-20,121-125`【原文，本地源码】。这就是第 6 节"先改目录再 `setAppName`"的依据。

### 7.5 深链（顺带）

macOS 只处理 `Info.plist` `CFBundleURLTypes` 声明的 scheme，运行时不可改；`open-url` 要在 `ready` 前监听 —— app.md【原文】。改名后旧 `paseo://` 深链不会自动被接到，要兼容需同时保留 `paseo` 声明并 `setAsDefaultProtocolClient("paseo")`【推断】；是否保留归改名例外清单（07 号工单）。

---

## 8. 测试建议

- 单测：`mapKey` / `mapDbName` 对第 1 节全部键做断言；导出 / 导入脚本在 Node + `fake-indexeddb` 下做往返一致性（含 Blob→ArrayBuffer→Blob）。
- Electron e2e（复用 `packages/desktop/e2e/*.electron.mjs` 的隔离 userData 机制）：把一份从 0.14.x 真机抓下来的 `Paseo` userData 固定成 fixture（去掉 `Partitions`、`Cookies` 等无关目录，约 1 MB 以内），以 `PASEO_ELECTRON_USER_DATA_DIR` 指向它的副本启动 1.0.0，断言：主机列表、草稿、面板布局出现；`desktop-settings.json` 标记已写；`paseo://app` 的旧数据仍在（`clearStorageData` 未动旧 origin）。
- 失败注入：让导出页 404、让导入脚本抛错，断言不写标记且第二次启动成功；杀进程模拟半途崩溃。

## 9. 待主会话定夺

1. 与上游 Paseo.app 并存的机器：move 会掏空上游数据（第 4 节最后一行）。
2. 存储键字符串是否随改名（归 07 号工单）；本方案两种结果都兼容。
3. `persist:paseo-browser` 分区字符串是否改（同归 07）。
4. 迁移代码的 `COMPAT` 到期日。
