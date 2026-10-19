import { useCallback, useEffect, useRef } from "react";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import type { ConnectionCurlInputs } from "./internal/connection-form-model";
import type {
  CurlPasteField,
  CurlPasteFieldInput,
  CurlPasteFieldRef,
} from "./use-curl-paste-field.types";

// 挂着粘贴监听的那个输入框元素，与拆掉监听的办法。
interface PasteBinding {
  element: HTMLElement;
  unbind: () => void;
}

/**
 * 地址框、key 框：粘贴的文字交给表单模型，它认得是 curl 就拦下这次粘贴（照 magpie fromCurl）。读剪贴板原文：
 * 输入框会吞掉换行，续行写法就认不出了。每个框再按模型的通知改写自己（replaceText），key 框按需获得焦点。
 * 用回调 ref 跟着输入框换监听：窄窗口的底部弹层会重新挂载表单内容，换成新的输入框元素。
 */
export function useCurlPasteField(input: CurlPasteFieldInput): CurlPasteFieldRef {
  const { model, field } = input;
  const handleRef = useRef<EditingTextInputHandle | null>(null);
  const bindingRef = useRef<PasteBinding | null>(null);

  useEffect(
    () =>
      model.subscribeCurlInputs((inputs) => {
        const handle = handleRef.current;
        if (handle) applyCurlInputs({ handle, field, inputs });
      }),
    [field, model],
  );
  useEffect(
    () => () => {
      bindingRef.current?.unbind();
      bindingRef.current = null;
    },
    [],
  );

  return useCallback(
    (handle: EditingTextInputHandle | null) => {
      handleRef.current = handle;
      const native = handle?.getNativeRef();
      const element = field !== "models" && native instanceof HTMLElement ? native : null;
      if (bindingRef.current?.element === element) return;
      bindingRef.current?.unbind();
      bindingRef.current = null;
      if (!element) return;
      const handlePaste = (event: ClipboardEvent) => {
        const text = event.clipboardData?.getData("text") ?? "";
        if (model.pasteCurl(text)) event.preventDefault();
      };
      element.addEventListener("paste", handlePaste);
      bindingRef.current = {
        element,
        unbind: () => element.removeEventListener("paste", handlePaste),
      };
    },
    [field, model],
  );
}

interface CurlInputsTarget {
  handle: EditingTextInputHandle;
  field: CurlPasteField;
  inputs: ConnectionCurlInputs;
}

function applyCurlInputs(target: CurlInputsTarget): void {
  const { handle, field, inputs } = target;
  if (field === "address" && inputs.address !== null) handle.replaceText(inputs.address);
  if (field === "models" && inputs.modelIds !== null)
    handle.replaceText(inputs.modelIds.join(", "));
  if (field === "apiKey" && inputs.focusesKey) handle.focus();
}
