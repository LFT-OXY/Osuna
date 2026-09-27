# 05 — 相对路径图片

**What to build:** 预览里用相对路径引用的截图能显示，`![](相对路径)` 与 `<img src="相对路径">` 两种写法效果一致；图片文件在磁盘上更新后预览里的图跟着更新；引用不存在的图片时显示明确的占位，不影响其余内容。

**Blocked by:** 02
**Status:** ready-for-agent
**Impl:** done

## 范围

- 文件面板把当前文件路径、工作区目录与 host 传给预览组件（仅 Web 版使用；原生版签名兼容但行为不变）。
- 资源解析规则写成纯函数：区分相对路径（相对当前文件所在目录，含 `../`）、仓库内绝对路径、外链（http(s) / data）、越出工作区的路径。本票覆盖图片所需分类，06 在同一函数上补锚点与带行号链接。
- 相对 / 仓库内图片经现有工作区文件读取链路取得可显示地址（与对话助手图片、文件面板图片预览同一条链路），http(s) 与 data 图片直接显示；消毒白名单保留图片来源所需属性。
- 读取失败显示占位；文件变更后随现有刷新机制更新。

## 验收

- [x] 纯函数单测（与现有助手图片来源解析测试同风格）：相对路径、`../`、仓库内绝对路径、外链、越出工作区各自分类正确。
- [x] README 风格 e2e 用例补充断言：两种写法的相对路径图片加载成功（自然宽度大于 0）。
- [x] 图片文件被改写后预览中的图片更新；缺失图片显示占位且其余内容正常渲染。
- [x] app 包 typecheck、lint 通过。

## Comments

- 实现：`file-pane/markdown-preview/resource.ts` 的 `resolveMarkdownResource`（纯函数，分类 `external` / `workspace_file` / `outside_workspace` / `unsupported`）与 `MarkdownPreviewResources`；`image.web.tsx` 的 `MarkdownImage`；`resources-context.web.ts`；`pane.tsx` 在 `FilePane` 组装资源上下文并逐层传到预览。约定写入 `.atw/spec/app/frontend/styling.md` DOM markdown 段的「Images」。
- 以 `/` 开头的路径（经用户确认）：落在工作区内按磁盘绝对路径读；否则按 GitHub 约定视为仓库根相对（`/docs/a.png` → 工作区 `docs/a.png`）。所以工作区外的 POSIX 绝对路径（如 `/tmp/a.png`）会被当成仓库根相对，读不到时显示占位，不会归为「越出工作区」；只有 `..` 越过根、`~`、其他盘符才归为越出工作区。
- 图片走文件面板图片预览的同一条链路（`useLiveFile` → `useFilePreview` → `useAttachmentPreviewUrl`），每个 `<img>` 一个文件订阅：磁盘上改图后 `src` 更新，面板隐藏时停止读取。同一张图被引用多次会有多个订阅和附件持久化（附件 id 相同会去重），README 规模下可以接受。
- 外链与 data 图片直接显示，加载失败不换占位（审查提出）：否则 fixture 里带 `onerror` 的 404 外链图会变成 span，「事件属性被剥离」的断言就恒为真。缺失占位只用于工作区图片和无法解析的地址。
- 消毒白名单加 `protocols.src` 的 `data`；react-markdown 默认 `urlTransform` 会清空 `data:`，另写 `previewUrlTransform` 只放行 `img` 的 `data:image/`。
- 占位文案借用 `message.attachments.imageUnavailable`（有 alt 时显示 alt），没有新增 i18n 键。
- 已知边界：文档本身不在工作区内（从 `~` 或 `/tmp` 打开的 md）时，其相对图片一律归为越出工作区、显示占位。
- 给 06：解析入口会先截掉 `?` / `#` 后缀，`#…` 直接返回 `unsupported`。06 需要保留 fragment（锚点、`#L12`），并在同一函数上新增分类。
- 验证：`resource.test.ts` 12 个用例通过；file-editing e2e 全文件 20 个用例本地通过（审查修改后又重跑了 README 与刷新两个用例）；app 单测 632 个文件全绿；app typecheck 与改动文件的 lint 都通过。
