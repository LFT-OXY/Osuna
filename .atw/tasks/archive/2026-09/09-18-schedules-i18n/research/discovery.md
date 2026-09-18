# 发现记录：计划（Schedules）功能面 i18n

## 现状

- i18n 机制：react-i18next，`packages/app/src/i18n/resources/{en,zh-CN,ar,es,fr,ja,ko,pt-BR,ru}.ts`；spec 规定所有用户可见字符串必须走 `t()`（`.atw/spec/app/frontend/component-guidelines.md` "i18n"）。
- 侧边栏「计划」已翻译（`sidebar.schedules`）；命令中心入口已走 i18n。
- 计划功能面从未接入翻译，硬编码英文约 90 处，分布在：
  - `screens/schedules-screen.tsx`：标题、Active/Ended 分段、两个空态、加载失败、New schedule 按钮、See docs
  - `components/schedules/schedule-form-sheet.tsx`：标题（New schedule / 编辑）、Name/Prompt/Host/Project/Model/Thinking/Mode/Isolation/Target/Max runs/Archive on finish 字段、占位符、下拉空态与提示、Cancel/Create schedule/Save changes、Local/Worktree、Agent unavailable/Untitled agent、提交前校验错误
  - `components/schedules/cadence-editor.tsx`：Cadence 字段、Select cadence、Cron expression
  - `components/schedules/schedule-row.tsx`：Active/Paused/Expired/Finished/Target gone 徽标、Created/Last run/Never run/Next run、Resuming…/Pausing…/Starting…/Deleting…、Edit 无障碍标签
  - `components/schedules/schedules-table.tsx`：删除确认标题/正文/按钮
  - `schedules/schedule-cadence-options.ts`：Every minute/Every hour/Custom cron 预设
  - `schedules/schedule-form-model.ts`、`schedules/schedule-derivation.ts`：Default mode、Untitled agent、Agent unavailable
  - `utils/schedule-format.ts`：`describeCron`/`formatCadence`/`formatNextRun`/`scheduleProductName`/`resolveScheduleTitle` 生成的英文（Every hour at :MM、Daily、Weekdays、Weekends、星期名、Every N units、Enter a cron expression、Heartbeat/Schedule、Untitled …）

## 约束

- `i18n/resources.test.ts`：9 种语言键集合必须一致；每种语言与英文相同的字符串 < 25%；插值占位符一致。新增键必须同时补 9 个文件。
- `utils/schedule-format.ts` 是纯函数带单测（`schedule-format.test.ts`、`schedule-cadence-options.test.ts`）；本地化后测试断言需改为结构化结果。
- `utils/time.ts formatTimeAgo`（"5m ago"）为全局共用且注释声明有意保留英文，不在本任务范围。
- daemon 返回的错误消息保持英文（与项目对连接错误的处理惯例一致）。

## 已定决策

- 范围：整个计划功能面（不只截图两块）。
- 其它 7 种语言：真实译文，遵循项目惯例。
- cron 派生描述：翻译；函数改为返回翻译键与参数，组件层渲染。
- 术语：Schedule=「计划」，Heartbeat=「心跳」（已写入 `docs/glossary.md`）。
- 字段译法：Cadence=频率、Max runs=最大运行次数、Isolation=隔离方式、Local=本地、Worktree 不译、Archive on finish=完成后归档、Target=目标、Thinking=思考、Mode=模式、Host=主机、Project=项目。

## 无关项

- 已回退的任务 plan-i18n-zh 处理的是 Agent「Plan 模式/建议计划」，与本任务无关。

## 第二轮决策

- 交付：改动完成并验证后直接提交到 main。
- 验证：typecheck、lint、`i18n/resources.test.ts`、`utils/schedule-format.test.ts`、`schedules/schedule-cadence-options.test.ts`；另启动 dev 桌面端切到 zh-CN，对列表空态与新建表单截图作 UI 证据。
- cron 派生描述中文：每分钟、每小时、每小时 :15、每天、工作日、周末、每 2 天、周日…周六、自定义 cron、输入 cron 表达式。
- 状态与分段词：活跃、已结束、已暂停、已过期、已完成、目标已丢失、从未运行、创建于/上次运行/下次运行。
- daemon 返回的错误消息保持英文，不在范围内。
