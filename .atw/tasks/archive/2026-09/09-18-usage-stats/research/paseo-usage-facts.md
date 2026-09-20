# Paseo 现状事实（用量相关）

2026-09-18 由子代理调研，行号以当日 `main`（f864192e9）为准。

## Plan usage（订阅配额）

- UI：主机设置页 `packages/app/src/screens/settings/host-page.tsx:335,346` 挂 `ProviderUsageSettingsSection`；模块 `packages/app/src/provider-usage/`（11 文件 831 行），`copy.ts` 硬编码英文未接 i18n。第二入口：`components/context-window-meter.tsx` 的 tooltip 嵌 `ProviderUsageTooltipSection`。
- 数据：`packages/server/src/services/quota-fetcher/`，`ProviderUsageService.listUsage()` 5 分钟缓存，`manifest.ts:15-57` 8 个 fetcher（claude/codex/copilot/cursor/zai/grok/kimi/minimax），只读 CLI 凭据拉各家订阅接口。cursor fetcher 动态 `import("node:sqlite")` 只读 `state.vscdb`（`providers/cursor.ts:133-141`），`@types/node@20` 无类型、Node 22+ 才有。
- 协议：`provider.usage.list.request/response`（`messages.ts:1777,6239`），`ProviderUsageSchema:6225`（windows/balances/details）；handler `provider-catalog-session.ts:490-515`；门控 `server_info.features.providerUsageList`。

## 现有 token 数据

- `AgentUsage`（`packages/protocol/src/agent-types.ts:189-196`，zod `messages.ts:429-436`）：`inputTokens / cachedInputTokens / outputTokens / totalCostUsd / contextWindowMaxTokens / contextWindowUsedTokens`。无 cache write、无 reasoning、无按模型拆分。
- 产生点：claude `providers/claude/agent.ts:1798-1824`（把 input + cache_creation + cache_read 合并成 inputTokens）；codex `codex-app-server-agent.ts:935-949`；opencode `opencode-agent.ts:917-953`（五列齐，求和填 contextWindowUsed）；pi/omp 各自 `usage-poller.ts` 轮询。
- 聚合 `agent-manager.ts:4226-4227`（usage_updated 覆盖）、`:4387`（turn_completed 浅合并）；投影 `agent-projections.ts:144-146`。
- **不持久化**：`STORED_AGENT_SCHEMA`（`agent-storage.ts:45-77`）无 usage 字段，`lastUsage` 只在内存 `agent-manager.ts:404`，daemon 重启归零。
- UI 唯一展示点：`context-window-meter.tsx`，挂在 `composer/index.tsx:278-300,2073`，百分比环 + `formatSessionCost`。agent 列表 `agent-list.tsx`、侧栏行、`turn-footer.tsx` 都不显示 token；`turn-footer.tsx:136` 有每轮 elapsed 计时。

## 存储层

- `docs/data-model.md`：JSON 文件 + Zod，原子写，无迁移框架，Store Surface Rule（一个 store 方法对应一条 SQL/一个事务）。
- `$PASEO_HOME`（本 checkout 为 `.dev/paseo-home`）已有：`agents/{sanitized-cwd}/{id}.json`、`schedules/`、`projects/`、`runtime/managed-processes/`、`creations/`、`models/`、`opencode-home/`、`desktop-attachments/`。
- 服务端无 sqlite 依赖；`expo-sqlite` 只在客户端原生副本缓存用。

## UI 挂载点

- 侧栏 workspace 行元信息：`components/sidebar/workspace-meta-row/index.tsx`，可显示项由 `meta-items.ts:18-25` 的 `MetaRowItem` 枚举定死（branch/project/host/changeRequest/checks/services/labels），`selectMetaRowItems:37-90`，偏好在 `sidebar/display-preferences/`。
- Sidebar items 由 `packages/app/src/sidebar-nav/model.ts` 解析（`AppSettings.sidebarNavItems`），见 glossary **Sidebar items**。
- 会话页无独立 header/footer；底部是 `composer/index.tsx`。
- 图表库：无。已有 `react-native-svg` ^15.14 与 `@shopify/react-native-skia` 2.2.12。

## 基础设施

- `packages/server/src/server/schedule/`：`ScheduleService` setInterval tick，任务模型是"创建/恢复 agent"，非通用 job runner。
- 无 metrics/聚合模块；`websocket/runtime-metrics.ts`、`utils/git-command-runtime-metrics.ts` 都是局部运行时观测。
- 文件观察：`docs/file-observation.md`。

## 自定义 provider

- `packages/protocol/src/provider-config.ts`：`ProviderOverrideSchema:51-63`（extends/label/env/models/additionalModels/…），端点密钥一律走 env。agent 记录存 `provider` id 与 `config.model` / `runtimeInfo.model`，可反查 provider 条目与模型，无端点维度。
- 渠道功能（`09-18-provider-channels`）当日已整体回退，仓库无对应代码；用户在本任务访谈中明确**不做渠道、不区分渠道**。

## 追问补充（2026-09-18）

### Provider session 扫描与 handle 语义

入口 `session.ts:6159` → `import-sessions.ts:144 listImportableProviderSessions` → `agent-manager.ts:969` 扇出。去重键 `handleKey = ${provider}\0${providerHandleId}`（`import-sessions.ts:459`）。

| provider | 扫描                                                                                                                                                                                           | providerHandleId            | 反推日志文件                                                                                                                                                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| claude   | `$CLAUDE_CONFIG_DIR \|\| ~/.claude/projects/<编码 cwd>/*.jsonl`，编码 `providers/claude/project-dir.ts:27`；`collectRecentClaudeSessions` `agent.ts:6132`，`parseClaudeSessionDescriptor:6243` | 文件内 sessionId（`:6282`） | `agent.ts:5020-5039`：`claudeProjectDirSync(cwd)/<sessionId>.jsonl`，**需要 cwd**。Paseo agent 的 `persistence.sessionId` = claudeSessionId（`:2654`），但 **每次 resume 换新 id**，一个 Paseo agent 可能对应多个 jsonl，记录里只留最后一个 |
| codex    | **不扫文件**：spawn app-server 发 `thread/list`（`codex-app-server-agent.ts:7128`）                                                                                                            | thread.id                   | Paseo 侧拿不到；TokenTracker 直接解析 `~/.codex/sessions` rollout 文件，`session_meta.payload.id` 即 thread id                                                                                                                              |
| pi       | `providers/pi/session-descriptor.ts:72`，目录 `resolvePiSessionsDir:109`（providerParams.sessionDir → `PI_SESSION_DIR` → settings → `<agentDir>/sessions`）                                    | **绝对文件路径**（`:224`）  | 恒等。Paseo agent 的 `persistence.sessionId` 是内部 id，`nativeHandle` 才是文件路径（`pi/agent.ts:1525-1526`）                                                                                                                              |
| omp      | `providers/omp/session-descriptor.ts`，与 pi 对称，`OMP_SESSION_DIR`                                                                                                                           | 文件路径                    | 同 pi                                                                                                                                                                                                                                       |

### 轮次耗时

- 客户端 `turn-footer` 的时长由 `timeline/turn-time.ts:14-70 deriveStreamTurnTiming` 推导：**本轮最后一条 timeline 条目时间戳 − 本轮用户消息时间戳**；运行中的一轮用快照 `activeTurn.startedAt`（`messages.ts:850-853`）做本地秒表。
- server 只在内存记当前轮 `activeTurnStartedAt`（`agent-manager.ts:402-403,2624-2638`），轮次结束即丢；`turn_started/turn_completed` 事件**无时间戳字段**；`STORED_AGENT_SCHEMA` 无计时字段。
- timeline 不落盘：`docs/timeline-sync.md:8-11`，provider 日志是抄本权威，恢复时重建投影。
