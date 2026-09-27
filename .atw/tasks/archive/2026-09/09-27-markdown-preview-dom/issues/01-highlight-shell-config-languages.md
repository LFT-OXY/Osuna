# 01 — 高亮包补齐 shell / toml / sql / diff / dockerfile / ini

**What to build:** 对话里的 ```` ```bash ```` / ```` ```sh ```` / ```` ```shell ```` / ```` ```zsh ```` / ```` ```console ```` 代码块，以及 toml、sql、diff、dockerfile、ini 代码块开始有颜色；源代码视图打开对应文件（如 `.sh`、`.toml`、`.sql`、`.diff`、`Dockerfile`、`.ini`）也随之着色。这是后续 DOM 预览代码块着色的前提，但本票单独就能在对话与源代码视图里验证。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

## 范围

- 高亮包按现有 swift / dart 的做法，经 `@codemirror/legacy-modes` 接入 shell、toml、sql、diff、dockerfile、ini（properties）；高亮引擎仍只有 Lezer 这一套。
- fence 语言名到高亮语言的别名补齐：bash / sh / zsh / shell / console → shell，以及 toml、sql、diff / patch、dockerfile、ini / properties 等常见写法。
- 新语言产出的 token 落到现有语义角色上，跟随用户选择的语法主题，不新增主题字段。

## 验收

- [x] 高亮包现有 `__tests__` 中，每种新增语言对一小段代表性代码产出预期的语义 token（关键字、字符串、注释等）。
- [x] fence 别名（bash / sh / zsh / shell / console 等）解析到正确的语言。
- [x] 对话里的 bash 代码块有颜色，颜色随语法主题切换。
- [x] 源代码视图打开 shell / toml 文件时着色，编辑器行为无回归。
- [x] 高亮包与 app 包 typecheck、lint 通过；高亮包依赖闭包测试通过（如新增依赖需同步）。

## Comments

- 实现：`packages/highlight/src/parsers.ts` 把 fence 名直接加成扩展名键（与扩展名共用一张表），app 的 `LANGUAGE_ALIASES` 无需改动；`getLanguageForFile` 先取 basename，带目录的 `Dockerfile` 也能命中（`Dockerfile.dev` 不命中）。diff 的 inserted/deleted 与 ini 值用 `tokenTable` 就地映射到 string / keyword / string，未加主题字段。约定已写入 `.atw/spec/app/frontend/styling.md`「Syntax languages」。
- 连带：server / app 的 diff 高亮也会给这些文件着色（共用 `isLanguageSupported`）。
- 未勾的两项：链路已由 `app/src/utils/highlight-cache.test.ts`（bash fence 产出 comment/keyword）与高亮包测试覆盖，颜色按角色在渲染时取主题色；未在真实应用里目测。
- 07 补验：真实应用里对话 bash 代码块与源代码视图的 `.sh` / `.toml` 着色已目测确认（见 07 的 Comments）。
