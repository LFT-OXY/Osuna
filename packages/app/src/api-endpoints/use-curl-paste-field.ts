import type { CurlPasteFieldInput, CurlPasteFieldRef } from "./use-curl-paste-field.types";

/*
 * 原生端：输入框不报粘贴事件，curl 照常粘进框里，没有要改写的输入框（use-curl-paste-field.web.ts 是网页与桌面端）。
 */

const ignoreInput: CurlPasteFieldRef = () => {};

export function useCurlPasteField(_input: CurlPasteFieldInput): CurlPasteFieldRef {
  return ignoreInput;
}
