# 03 — 插件契约：osuna-plugin.json 与 requirements.osuna，不留兼容读取

**What to build:** 把插件的对外契约改到 Osuna 名下。已知并接受的后果：为上游 Paseo
写的第三方插件不再能装到 Osuna 上，反之亦然。不保留对旧文件名的兼容读取 —— 那会
是一条只为读别人生态而存在的永久分叉路径。

**Impl:** done
**Status:** ready-for-agent

**Blocked by:** 02

- [x] 清单文件名 `paseo-plugin.json` → `osuna-plugin.json`，含 scaffold 模板
      （`packages/cli/src/commands/plugin/scaffold.ts:163`）、`--id` 选项帮助文案
      （`plugin/index.ts:209`）与读取点
- [x] 版本字段 `requirements.paseo` → `requirements.osuna`，含 `packages/protocol` 的
      校验与报错文案（`plugin-requirements.test.ts` 断言的 `Invalid requirements.paseo`）
- [x] `skills/paseo-plugin/` → `skills/osuna-plugin/`、`skills/paseo-help/` →
      `skills/osuna-help/`，正文里的命令名与清单名同步
- [x] `plugin-examples/` 下 10 个示例插件的清单文件重命名与字段更新
- [x] `docs/plugins.md` 同步（该文档的完整改写归 04 票，此处只保证契约事实正确）
- [x] 验收：`osuna plugin init` scaffold 出的插件能被 `osuna plugin add` 装上并 reload
- [x] 测试：`packages/cli/tests/e2e/plugin-lifecycle.test.ts` 与
      `plugin/scaffold.test.ts`，单文件 `--bail=1`
- [x] `npm run typecheck`、`npm run lint` 通过

## Comments

**2026-09-20 落地。** typecheck / lint（0 warnings 0 errors）/ oxfmt 全绿。两项点名验收都过：
`packages/cli/src/commands/plugin` 14/14、`packages/cli/tests/e2e/plugin-lifecycle.test.ts` exit 0
（scaffold 出的插件能装上并 reload）。

清单外一并改的（都已补进 prd 的归属调整）：插件 SDK 的 API 名从批次 4 提前到本批次
（`PaseoApi`/`usePaseo`/`ctx.paseo`/`PluginHandlerContext.paseo`，含 `paseo-context.tsx` 改名）；
6 个 skills 目录全改而非票里的 2 个；`plugin-examples/` 实际 14 个清单文件。

**抓到的真问题（按发现顺序）**

1. 全量测试 6 个真失败，三类：`messages.plugins.test.ts` 的 wire 夹具键名仍是 `paseo`
   （zod 把未知键剥掉，断言变成 `requirements: {}`）；`requirements.posix.test.ts` 的
   `writePlugin(root, paseo?, ...)` 形参没改而函数体已是简写 `{ osuna }`，是个**未定义标识符**；
   三个文件断言旧迁移 URL。
2. `plugins/runtime.ts:279` 是迁移报错的**第二个产出方**，我上一轮只改了
   `plugin-requirements.ts`，两处说法与 URL 不一致。`index.posix.test.ts`、
   `runtime.posix.test.ts` 的断言匹配的是这个旧产出方，所以**一直是绿的**，掩盖了不一致。
3. `plugin-requirements.ts` 的 `COMPAT` 注释被自己的替换扫坏：注释本是为解释旧字段名而写，
   改完变成「they declare `requirements.osuna`, never `requirements.osuna`」，并且警告别加
   `requirements.osuna` 回退 —— 禁止的恰好是代码正在读的字段。
4. `public-docs/plugins/v0.7/reference.md` 被我污染：这是记录 **Paseo v0.7** 的历史文档，
   旧名字在这里是对的，改完变成「v0.7 要求 `osuna-plugin.json`」。已定点还原，该文件现在无 diff。
5. `skills/osuna-help/SKILL.md:60` 让 agent 去探 `127.0.0.1:6767/api/health` 却读
   `~/.osuna/daemon.log` —— 一半指向上游 daemon，正是票 02 要求避开的。同文件 3 处
   `PASEO_HOME`、`skills/osuna/SKILL.md` 1 处 `PASEO_HOST` 都已无读取方（批次 2 改完了），
   且都在批次 2/3 已经动过的同一行上，是半改句。
6. `public-docs/plugins/v0.8/migration.md` 的「half-migration errors」表逐字引用运行时报错串供
   用户 grep，两条引用都已与代码不符。代码的报错 URL 本批次指向了这份文档，文档却教不了人。
7. 重命名 `plugin-paseo-api.e2e.test.ts` 会**静默弄断** `packages/server/package.json` 的
   `test:integration` —— 那里按字面路径列了这个文件，没有 importer，typecheck/lint 都看不到。
8. **闸门有洞（已实证）**：`tsconfig.server.json` 排除 `src/**/*.test.ts(x)`，typecheck 脚本
   经 `tsconfig.server.typecheck.json` 继承该排除；oxlint 的 `no-undef` 对 TS 关闭。往 server
   测试文件插 `const __probe = notDefinedAnywhere;`，**两道闸门都不报**。已写进
   `.atw/spec/server/backend/testing.md`。

**审查发现里我驳回或改判的**

- 两轴都建议本批修 `@getpaseo/plugin` 导入（`skills/osuna-plugin/SKILL.md` 14 处 + 文档几十处），
  理由是「本批拥有插件契约」。查了 git：包名 `@osuna/plugin` 是**批次 1**（`ddfef1bae`）改的，
  这些导入从批次 1 起就是坏的，不是本批造成。按已有归属规则（`docs/`、`public-docs/` 归批次 4）
  移交，并逐条列进批次 4 清单。piecemeal 改还会把 `docs/plugins.md` 弄成一半新一半旧。
- 同理 `skills/` 的 11 处 `paseo.sh`、`public-docs/skills.md`、`CONTRIBUTING.md` 都移交批次 4。
- 文档只改「本票重命名过的契约标识符」。为此定了一条可陈述的界线：**凡因契约标识符而必须动的
  那句话，句内的产品名一并改**（否则留下半改句，比两端任一状态都糟）；没动到的句子留给批次 4。
- `_paseo` 元数据与 `clientInfo: { name: "paseo" }`：Spec 轴指出后者与前者同类且无人认领。查证
  两者全仓**无读取方**，都是发给外部 ACP agent 进程的。这不是机械改名而是可能的行为变更（外部
  agent 可能对 `paseo` 有特判），需要先做决定，已连同取舍一起列进批次 4，没有自行改。
- `scaffold.ts` 生成的样例里 `name: "Paseo"` + 「Open paseo.sh」按钮：产品名归本批次（scaffold 是
  插件契约的入口，本批已改过它的 `requirements`），但改了显示名却留 `paseo.sh` 会是半改状态，
  所以整个按钮一起改到 `github.com/LFT-OXY/Osuna` —— 与用户已批准的「文档链接转仓内/GitHub」
  一致，不是新决定。

**保留的既有问题**：`ProviderPaseoToolsPolicySchema` 类型名（wire 字段已是 `osunaTools`，类型名归
批次 4）。`worktree-session.ts:402` 的 `_paseoHome` 形参按 prd「内部私有变量名不专门改」保留。
