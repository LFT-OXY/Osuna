import type { EditingTextInputHandle } from "@/components/ui/text-input";

/*
 * 原生端：多行框随内容自己长高，不用指定行数（text-box-lines.web.ts 是网页与桌面端）。
 */
export function wrapAnywhereAndCountLines(_handle: EditingTextInputHandle | null): number | null {
  return null;
}
