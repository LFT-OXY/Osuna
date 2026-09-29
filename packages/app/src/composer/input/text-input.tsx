import React, { forwardRef } from "react";
import { EditingTextInput } from "@/components/ui/text-input";
import type { ComposerTextInputHandle, ComposerTextInputProps } from "./text-input.types";

export type { ComposerTextInputHandle } from "./text-input.types";

// 原生端 Composer 仍用共享文本输入；Web / Electron 走 text-input.web.tsx 的 Tiptap 编辑器。
// 原生输入框只有文字，分段结构与块的 host 用不上。
export const ComposerTextInput = forwardRef<ComposerTextInputHandle, ComposerTextInputProps>(
  function ComposerTextInputNative(props, ref) {
    const { initialSegments: _initialSegments, inlineBlockServerId: _serverId, ...rest } = props;
    return <EditingTextInput ref={ref} {...rest} />;
  },
);
