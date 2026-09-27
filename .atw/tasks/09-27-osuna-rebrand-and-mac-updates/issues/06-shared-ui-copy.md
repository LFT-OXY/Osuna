# 06 — 共享界面文案改名

**What to build:** 用户在桌面端界面里看到的产品名一律是 Osuna。改动范围包括 9 种语言的翻译文件、硬编码文案，以及 Web 的 manifest 和页面标题。指代手机官方 App 的地方保留 "Paseo"，比如「用手机上的 Paseo 扫码」，依据是 glossary 里的 Osuna / Paseo 词条。`paseo` 命令名、`paseo.json`、`~/.paseo` 这类内部标识不改。手机端的打包配置不动，所以 Web 标题需要找一个不经过手机 app config 的注入点。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] 9 种语言文件里指代本产品的 "Paseo" 都改成 "Osuna"；指代手机官方 App 的条目逐条核对后保留，并在 Comments 里列出保留了哪些
- [x] i18n 之外的硬编码文案同样处理
- [x] 命令名、配置文件名、数据目录这类标识在文案里保持原样
- [x] Web manifest 的 name/short_name、页面标题、apple-mobile-web-app-title 显示 Osuna，手机端的 app config 没有改动
- [x] 依赖旧文案的单元测试和 e2e 断言已经更新；e2e 失败要和基线对照，本机基线原本就失败的用例单独列出，交给 CI 判断
- [x] typecheck 与 lint 通过

## Comments

**实现结论（2026-09-27）**

- **i18n**：9 个语言文件中，指代本产品的 "Paseo" 全部改为 "Osuna"，共约 360 处。i18n 键名是标识，保持不变：`serviceUrl.inPaseo`、`paseoCalls`、会话历史行的 `row.paseo`。批量替换时曾误改 `inPaseo` 键名，已改回，并逐文件核对过键集合没有变化。
- **保留的 "Paseo"**：只有指代手机官方 App 的配对扫码提示 `pairing.device.hint`，9 种语言各一条（en："Scan this QR code with Paseo on your phone, or copy the link below."）。其他条目逐条核对过，都不是指手机 App。
- **译文质量**：
  - es、fr 原译文里产品名与相邻单词粘连（如 "QuitterPaseo..."、"LaissezPaseodémarrer"），改名时在同一行补了空格，法语按省音写成 d'Osuna / qu'Osuna。ar 的 "OsunaCLI" 也补了空格。
  - 扫码提示那一行没有改，es / fr 的原有粘连（"códigoQRconPaseoen"）仍在。
  - en 的 "a Osuna" 按评审意见改为 "an Osuna"，共三处。
- **"Paseo CLI"**：当作产品标签，改为 "Osuna CLI"。实际命令仍是 `paseo`。
- **硬编码文案**：
  - 浏览器工具警告（`browser-tools-config.ts`）
  - 自动归档提示（`host-page.tsx`）
  - "Update Osuna to recover this workspace."（`workspace-route-state.ts`）
  - 诊断报告标题 "Osuna app diagnostics"
- **Web**：manifest 的 `name` / `short_name`、`apple-mobile-web-app-title` 改为 Osuna。`public/index.html` 的 `<title>` 直接写 `Osuna`，替代 `%WEB_TITLE%`：Expo 的 `createTemplateHtmlAsync` 找不到占位符时不做替换，用它渲染的结果为 `<title>Osuna</title>`。`app.config.js` 无改动。

**保留的其他 "Paseo" 命中**

- `git/use-actions.tsx` 的 `keyByMessage` 查找键 "…not created as a Paseo worktree"：仓库中没有任何地方产出这条消息，界面显示走 i18n，不是用户可见文案。
- protocol 的插件需求报错 "requires Paseo \<range\>"：对应 `requirements.paseo` 兼容目标，属于 protocol 层，不是共享界面文案。
- server 的 MCP 与浏览器工具描述：面向 agent，不在桌面界面中显示。
- 测试夹具中作为输入数据的 "Paseo"，如 `os-notifications.test.ts` 的通知标题、项目名 "Paseo"。
- `add-project-flow.spec.ts` 的否定断言 "Where should Paseo create"：对应的文案已不存在，保留无害。
- CLI 的 "Paseo Desktop" 帮助文字：属于 CLI，不在本票的桌面界面范围内（04 号工单已记录）。

**验证**

- typecheck：app、desktop 通过。
- 改动文件：oxlint、oxfmt 通过。
- 单测：受影响的 10 个测试文件共 84 个通过；全量 app 单测 652 个文件、5926 个测试全部通过。
- e2e：
  - desktop `updates.spec.ts`、`pair-device-relay.spec.ts`：19 个通过。
  - app `root-error-recovery`、`sidebar-help`、`pair-device-relay`、`settings-host-page`、`explorer-pane-placement`：12 个通过，3 个失败。
- **本机基线原本就失败的 e2e，交给 CI 判断**：切回改动前的提交重跑，以下 3 个同样失败：
  - `explorer-pane-placement.spec.ts` "closing the last split-born tab with hidden Explorer keeps a usable workspace"
  - `explorer-pane-placement.spec.ts` "visible Explorer does not replace the last ordinary workspace pane"
  - `settings-host-page.spec.ts` "a failed remote daemon update remains visible in the host UI"
- 全量 `npm run test`：本票没有改 server 或 cli，以下失败与本票无关：
  - server 的 `bootstrap-provider-availability`、`workspace-service-port-allocator`：与 07、08 记录的基线失败相同。
  - server 的 `workspace-git-service.observation`、`file-observer/index.test.ts`：单独运行通过，属于不稳定用例。
  - cli 的 `15-provider`："provider models codex" 依赖本机 codex。

