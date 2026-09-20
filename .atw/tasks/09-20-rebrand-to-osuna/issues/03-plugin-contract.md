# 03 — 插件契约：osuna-plugin.json 与 requirements.osuna，不留兼容读取

**What to build:** 把插件的对外契约改到 Osuna 名下。已知并接受的后果：为上游 Paseo
写的第三方插件不再能装到 Osuna 上，反之亦然。不保留对旧文件名的兼容读取 —— 那会
是一条只为读别人生态而存在的永久分叉路径。

**Impl:** ready
**Status:** ready-for-agent

**Blocked by:** 02

- [ ] 清单文件名 `paseo-plugin.json` → `osuna-plugin.json`，含 scaffold 模板
      （`packages/cli/src/commands/plugin/scaffold.ts:163`）、`--id` 选项帮助文案
      （`plugin/index.ts:209`）与读取点
- [ ] 版本字段 `requirements.paseo` → `requirements.osuna`，含 `packages/protocol` 的
      校验与报错文案（`plugin-requirements.test.ts` 断言的 `Invalid requirements.paseo`）
- [ ] `skills/paseo-plugin/` → `skills/osuna-plugin/`、`skills/paseo-help/` →
      `skills/osuna-help/`，正文里的命令名与清单名同步
- [ ] `plugin-examples/` 下 10 个示例插件的清单文件重命名与字段更新
- [ ] `docs/plugins.md` 同步（该文档的完整改写归 04 票，此处只保证契约事实正确）
- [ ] 验收：`osuna plugin init` scaffold 出的插件能被 `osuna plugin add` 装上并 reload
- [ ] 测试：`packages/cli/tests/e2e/plugin-lifecycle.test.ts` 与
      `plugin/scaffold.test.ts`，单文件 `--bail=1`
- [ ] `npm run typecheck`、`npm run lint` 通过
