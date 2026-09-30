# 输入框行内块的编辑器候选（2026-09-29）

结论：没有现成库能在 iOS、Android、Web 的输入框里渲染"真图标 + 文字"的原子块。

## react-native-enriched-html（原 react-native-enriched，旧包停在 0.8.1）

- iOS、Android、Web 稳定支持；Web 底层是 Tiptap。Electron 走 Web 构建，未实测。
- 只支持新架构；1.0.x/1.1.x 支持 RN 0.81，1.2.x 起不支持，本仓库须锁 1.1.x。需 dev build。
- Mention：`mentionIndicators` + `setMention(indicator, text, attributes)`，插入后是一个整体，删一个字符整块删除；样式只有 `color`、`backgroundColor`、`textDecorationLine`。
- 不能在 mention 里放图标（`<img>` 与 `<mention>` 互斥；自定义节点被维护者拒绝，issue #423）。可用字形/emoji 作伪图标。
- `setImage`、`onPasteImages` 三端可用，可能替代 paste-input，未实测。
- 非受控，输出 HTML，需自己转成块数据。移动端 `Keyboard.dismiss()` 无效。
- 来源：https://docs.swmansion.com/react-native-enriched-html/ （mentions、web-support、compatibility、known-limitations 各页）

## @expensify/react-native-live-markdown

- 三端、新架构。worklet parser 返回区间，可给 `@xxx` 上色和背景；无图标、无原子删除（纯文本重着色）。
- https://github.com/Expensify/react-native-live-markdown

## react-native-controlled-mentions

- 受控 `TextInput` + 嵌套 `<Text>` 着色；只能改样式，整块退格仍在 To Do；Web（react-native-web）不处理 children，无高亮。
- https://github.com/dabakovich/react-native-controlled-mentions

## 10tap-editor（WebView + Tiptap）

- 可做带图标原子节点（需自建 bundle，未验证）；Web 支持为 Beta；键盘相关 open issue 多（#321、#285、#302、#276）；mention 示例收费；每实例一个 WebView。
- https://github.com/10play/10tap-editor

## 仅 Web：Lexical / Tiptap

- Lexical `DecoratorNode`、Tiptap Mention（`atom: true`）都能做带图标原子块；原生端需另配方案。

## RN 原生 TextInput 嵌视图

- RN 0.81.5 源码中非 Text 子节点变成 U+FFFC 附件后被丢弃，不显示（源码推断，未真机验证）。自写 `NSTextAttachment`/`ImageSpan` 原生组件成本高。

## 气泡

气泡是只读 `<Text>`，RN 支持在 Text 里嵌行内 View，气泡可以显示真图标块，不受输入框限制（按 RN 能力推断，未在本仓库验证）。
