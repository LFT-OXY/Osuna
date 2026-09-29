// 原生端 Composer 仍用共享文本输入；Web / Electron 走 text-input.web.tsx 的 Tiptap 编辑器。
export { EditingTextInput as ComposerTextInput } from "@/components/ui/text-input";
export type { ComposerTextInputHandle } from "./text-input.types";
