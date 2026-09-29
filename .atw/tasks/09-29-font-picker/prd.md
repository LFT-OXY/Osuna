# 字体选择器：系统字体枚举与终端独立字体

调研与问答结论：[research/reference-projects.md](research/reference-projects.md)、[research/interview-decisions.md](research/interview-decisions.md)。术语见 `docs/glossary.md` 的 Interface font / Code font / Terminal font。

## Problem Statement

外观设置里已经能改 Interface font 和 Code font，但只能在文本框里手敲字体名：

- 用户不知道本机装了哪些字体、准确的字体名怎么写，敲错了也没有任何反馈。
- 填进去的字体会整串替换默认字体栈。换到没装这款字体的机器上，界面会掉到浏览器默认字体（常见是衬线体），中文回退也一起丢了。
- 终端没有自己的设置，只能和 Code font / Code size 绑在一起。想让终端用带图标的 Nerd Font、代码区用普通等宽字体，做不到。
- 留空时，终端、代码区、diff 各用一套不同的默认等宽栈，同一个"默认"在三个地方看起来不一样。

## Solution

在桌面端和 Web 端，把字体输入框换成字体选择器：

- 展开时列出本机已安装的字体，可以搜索，每一项用该字体本身渲染；Code font 和 Terminal font 只列等宽字体。
- 列表拿不到（浏览器不支持、用户拒绝授权、非安全上下文）时，选择器仍然可以直接输入字体名。
- 选中的字体放在默认字体栈前面，不再替换默认栈。
- 新增 Terminal font 和 Terminal size。默认跟随 Code font / Code size，用户改过才覆盖。
- 代码区、diff、终端共用一套默认等宽栈；终端在末尾追加本机常见的 Nerd Font 名作为图标回退。
- 字体没装或不是等宽时，在行下给提示，但照常保存。
- 预览区增加一段静态终端样例；字号行改过时出现重置按钮。

## User Stories

1. 作为桌面端用户，我想点开 Interface font 就看到本机所有字体，以便不用记字体的准确名字。
2. 作为桌面端用户，我想在字体列表里输入关键字过滤，以便在几百款字体里快速找到目标。
3. 作为用户，我想让列表里每个字体名都用它自己的字形显示，以便选之前就知道长什么样。
4. 作为用户，我想让 Code font 列表只出现等宽字体，以便不会误选比例字体导致代码对不齐。
5. 作为用户，我想在选择器里直接输入一个不在列表中的字体名并使用它，以便使用列表没枚举到的字体或完整字体栈。
6. 作为浏览器 Web 端用户，我想在第一次展开列表时被询问是否授权读取本机字体，拒绝后仍能手动输入，以便隐私选择不影响使用。
7. 作为通过局域网 http 地址访问 Web 端的用户，我想在无法枚举字体时仍能手动输入字体名，以便功能不整个失效。
8. 作为用户，我想在选择器里选"默认"恢复系统默认字体，以便不用手动清空。
9. 作为用户，我想让选中的字体排在默认字体栈前面，以便这款字体缺字（比如中文）或在别的机器上没装时，自动用默认字体补上。
10. 作为以前手写过完整字体栈的老用户，我想升级后原来的设置照常生效、照原样显示，以便不必重新配置。
11. 作为用户，我想在输入的字体本机没装时看到提示，以便知道为什么界面没变。
12. 作为用户，我想在 Code font 或 Terminal font 填了非等宽字体时看到提示，以便理解终端为什么错位。
13. 作为终端重度用户，我想给终端单独选一款 Nerd Font，以便提示符图标正常显示，而代码区保持原来的字体。
14. 作为终端用户，我想单独设置终端字号，以便终端和代码区的字号互不影响。
15. 作为不关心终端设置的用户，我想让终端默认跟随 Code font 和 Code size，以便只改一处就能统一所有等宽区域。
16. 作为用户，我想在 Terminal font 选择器里选"跟随代码字体"，以便撤销对终端的单独设置。
17. 作为用户，我想在 Terminal size 留空时看到占位符显示当前实际使用的代码字号，以便知道它在跟随哪个值。
18. 作为 iOS/Android 用户，我想同样能设置 Terminal size，以便在手机上单独调大终端字号。
19. 作为用户，我想让留空的代码区、diff、终端显示同一款默认等宽字体，以便界面观感一致。
20. 作为没有单独设置终端字体的用户，我想让终端在本机装有 Nerd Font 时正常显示提示符图标，以便不用额外配置。
21. 作为用户，我想在预览区看到一段终端样例，以便在设置页就能确认终端字体、字号和图标效果。
22. 作为用户，我想在字号改过后看到一个重置按钮，以便一键回到默认字号。
23. 作为用户，我想修改立即对打开着的终端、代码块、diff 生效，以便不用重开页面。
24. 作为多设备用户，我想让每台设备各自保存字体设置，以便 A 机器上的字体名不会被带到没装这款字体的 B 机器上。

## Implementation Decisions

**平台范围**

- 字体选择器（系统字体枚举、等宽过滤、存在性提示）只在 Electron 桌面端和浏览器 Web 端提供。原生 iOS/Android 的 Interface font 行维持隐藏，Code font 维持文本输入，终端字体仍受原生白名单约束。
- Terminal size 全平台生效；Terminal font 行只在桌面端和 Web 端显示。

**设置存储**

- 仍然只在客户端本地 `AppSettings` 里存（每设备一份），daemon 和 protocol 不改。
- 新增两个字段：
  - `terminalFontFamily: string`，`""` 表示跟随 Code font。
  - `terminalFontSize: number | null`，`null` 表示跟随 Code size；范围沿用 Code size 的 9–22，写入时 clamp。
- 老数据里没有这两个字段，解析时取默认值，不需要迁移。已有的字体字段结构不变，也不迁移。
- 字体名清洗沿用现有规则（拒绝 `;{}<>` 和控制字符，最长 200）。

**字体栈解析**

- 由外观模块提供唯一的"有效字体栈"解析逻辑（`appearance/font-stack.ts` 为 Web 端实现，`font-stack.native.ts` 为原生端实现），主题 token、终端、web diff 画布、预览都从这里取，不在消费点各自拼接。
- Web 端（含 Electron）的规则：
  - 有效栈 = `<用户值>, <默认栈>`。用户值为空时就是默认栈。用户值里的字体名含空格或特殊字符时补引号，generic 关键字不加引号。
  - 默认等宽栈统一定义在主题 token 一处，代码区、diff、编辑器、终端共用；diff web 画布里的硬编码栈改为引用这一处。
  - 默认等宽栈只包含具体字体名和结尾的 `monospace`，不含 `ui-monospace`。canvas 字体串遇到不认识的关键字会整串失效。
  - 终端有效栈 = `<Terminal font 或 Code font 的用户值>, <默认等宽栈中的具体字体>, <常见 Nerd Font 名>, monospace`。Nerd Font 名必须排在 `monospace` 之前，因为 generic 关键字总能命中，排在它后面的字体永远用不上。所以用户值里的 generic 关键字会被去掉，末尾只保留一个 `monospace`。
  - 用户值里自带 `ui-monospace` 时，web diff 画布仍会整串失效，和改动前一样。本任务不为画布单独过滤。
- 原生端：React Native 的 `fontFamily` 不支持逗号分隔的字体栈，所以原生端保持"用户值替换默认值"的现有语义。前插只在 Web 端生效。
  - 原生终端未设置字体时，沿用终端运行时原有的 `DEFAULT_TERMINAL_FONT_FAMILY`，保证 native-grid 在 iOS 上仍落到 Menlo、在 Android 上仍是 `monospace`。
  - 原生 diff 保留自己的 `monospace` 兜底。
  - 统一默认栈只在 Web 端成立。
- 终端的有效字号 = `terminalFontSize ?? codeFontSize`。

**字体选择器**

- 复用现有 `Combobox` 组件：搜索、自定义值、自定义选项渲染、虚拟列表都已具备。触发按钮显示当前值，并用当前值渲染。
- 首项固定：Interface font / Code font 是"默认"，Terminal font 是"跟随代码字体"。之后是系统字体。开启自定义值。
- 列表展开（也就是用户手势）时才请求枚举本机字体。结果去重、按字母排序，并过滤掉以 `.` 开头的 macOS 内部字体。同一会话内缓存。
- 已存的值如果不在列表里（比如多字体栈），作为自定义值原样显示在触发按钮上，不改写。
- "默认"只显示"系统默认"，不反查实际渲染的是哪款字体。
- 选中列表项时写入单个字体名；选中"默认"或"跟随代码字体"时写入 `""`。

**本机字体探测**

- 一个独立的字体探测模块，对外提供三种能力：
  - 列出本机字体：Local Font Access API 不可用、被拒或抛错时返回"不可用"，不抛异常。
  - 判断某个字体是否已安装：用 canvas 分别以三种 generic 字体作基准测量同一段文字的宽度，只要有一个不同就判定为已安装。不用 `document.fonts.check()`，它对没装的字体也返回 true。
  - 判断某个字体是否等宽：多个字形的宽度一致即为等宽；无法测量时视为等宽，不误伤。
- Code font 和 Terminal font 的列表经过等宽判断过滤。
- 提示规则只针对用户值里的第一个字体名：没装时提示"本机未检测到该字体，将使用回退字体"；Code font 或 Terminal font 不是等宽时提示"不是等宽字体，可能错位"。提示不阻止保存。
- Electron 没有注册权限处理器，`local-fonts` 权限按 Electron 默认放行。本任务不新增权限处理器。

**设置页**

- 外观 → 字体分区的行顺序：Interface font、Interface size、Content size、Code font、Code size、Terminal font、Terminal size。
- 字号行在值不等于默认值时显示重置图标按钮，参照快捷键设置页的重置按钮。Terminal size 的"默认"就是空（跟随）。不做全局恢复默认。
- 新增文案补齐中英文 i18n。英文 UI 标签用 "Terminal font" / "Terminal size"，中文用"终端字体"/"终端字号"。
- `AppearancePreview` 增加一段静态终端样例：用终端有效字体栈和有效字号渲染，包含一个 Nerd Font 提示符图标，并跟随输入中的草稿值实时预览。不启动真实的 xterm。

**生效**

- 终端从解析逻辑拿有效字体栈和字号，经由现有的 `setFont` 路径热更新，不需要重建终端。
- 其余消费点继续读主题 token，不新增读取路径。

## Testing Decisions

好的测试只断言外部行为：给定设置，得到什么有效字体栈或字号、界面显示什么、保存了什么。不断言内部调用顺序和中间状态。

以下测试接缝都优先复用现有测试文件：

1. **外观解析（主接缝）**：主题 token 断言放在 `appearance/apply.test.ts`，解析函数的断言放在代码旁边的 `appearance/font-stack.test.ts` 和 `font-stack.native.test.ts`（后者直接导入 `./font-stack.native`）。按 `.atw/spec/app/frontend/testing.md`，不 mock `@/constants/platform`。覆盖以下断言：
   - 前插与补引号；
   - 空值得到默认栈；
   - 代码区、diff、终端的默认等宽栈一致；
   - 终端跟随或覆盖 Code font / Code size；
   - Nerd Font 名排在 `monospace` 之前；
   - 原生端保持替换语义。

   前例：`apply.test.ts`。

2. **设置存储**：扩展 `use-settings` 的 storage 单测，覆盖以下断言：
   - 新字段缺省时取默认值；
   - `terminalFontSize` 的 clamp，以及 `null` 表示跟随；
   - 老数据原样解析。

   前例：`storage.test.ts`、`migrations.test.ts`。

3. **字体选择器（浏览器测试）**：用 vitest browser project 测试选择器组件，并向字体探测模块注入一个假的字体源。覆盖以下断言：
   - 展开后列出字体，并且可以搜索；
   - 等宽过滤生效；
   - 枚举不可用时仍能输入自定义值；
   - 已存的多字体栈原样显示；
   - 选"默认"会写入 `""`；
   - 未安装或非等宽时显示提示。

   前例：`components/ui/autocomplete.browser.test.tsx`、`row.browser.test.tsx`。

   canvas 测宽只在真实浏览器里可信，所以放在浏览器测试里，不放在 node 单测里。

4. **Electron 端到端**：在现有的 `appearance-font-size.electron.mjs` 回归里追加一段：打开 Code font 选择器，确认能列出本机字体（验证 Electron 默认放行 `local-fonts`），选中一款后，页面上代码区的 computed `font-family` 以它开头。本机上 desktop e2e 可能跑不通（见项目记忆），这一段以 CI 结果为准。

按仓库规则，每次只跑改到的单个测试文件，完整测试套件交给 CI。

## Acceptance Criteria

- [ ] 桌面端和 Web 端的 Interface font、Code font、Terminal font 三行都是字体选择器。展开后列出本机字体，可以搜索，每项用自身字体渲染；Code font 和 Terminal font 只列等宽字体。
- [ ] 枚举不可用（拒绝授权、不支持、非安全上下文）时，选择器仍可输入并保存自定义字体名，没有报错。
- [ ] 选中字体后，Web 端的有效字体栈是"所选字体 + 默认栈"；原生端行为与改动前一致。
- [ ] 老用户已存的字体栈升级后照常生效，触发按钮原样显示。
- [ ] Code font、Terminal font、Code size、Terminal size 都未设置时，代码块、diff、终端使用同一款默认等宽字体。
- [ ] Terminal font 选"跟随代码字体"、Terminal size 留空时，终端与 Code font / Code size 一致；分别设置后，终端独立变化，代码区不受影响。修改对已打开的终端立即生效。
- [ ] 本机装有常见 Nerd Font、且没有单独设置终端字体时，终端提示符图标正常显示。
- [ ] 输入本机没装的字体，或给 Code font / Terminal font 输入非等宽字体，行下出现对应提示，值照常保存。
- [ ] 预览区有终端样例，实时反映终端字体、字号和图标效果。
- [ ] 字号行改过后出现重置按钮，点击后恢复默认（Terminal size 恢复为跟随）。
- [ ] iOS/Android 上能设置 Terminal size，并对终端生效。
- [ ] 新增文案有中英文翻译。
- [ ] 上面四个测试接缝的测试通过；typecheck 和 lint 通过。

## Out of Scope

- 原生 iOS/Android 的字体选择器、界面字体、打包字体（expo-font），以及放开原生终端字体白名单。
- 打包任何字体文件，包括 Nerd Font 符号字体；也不从 CDN 加载字体。
- 行高、字重、连字、字体平滑、letter-spacing 设置。
- Electron 缩放的持久化，以及在设置页暴露缩放。
- Composer 独立字体；Simple / Advanced 两档视图；全局"恢复全部默认"。
- 字体设置跨设备同步，以及任何 daemon / protocol 改动。
- 反查"默认"实际渲染出的字体名。
- 清理与字体设置无关的硬编码字体（桌面更新区、Electron 浏览器徽标、图标生成）。

## Further Notes

- **可见的行为变化**：以前终端留空时优先用 JetBrains Mono，统一默认等宽栈后改为和代码区一致。本机装了 JetBrains Mono 且没设置过终端字体的用户，会看到终端字体变化。想继续用 JetBrains Mono，可以在 Terminal font 里选它。
- 前插语义下，老用户手写的完整栈后面会再接一段默认栈。这只增加回退，不改变首选字体。
- `theme.ts` 里提到已不存在的 `Fonts` 的过时注释，在统一默认栈时顺手更正。这属于本次改动直接涉及的代码。
