import type { TFunction } from "i18next";

/**
 * 用量相关的纯函数不拼英文，返回「翻译键 + 参数」由组件层渲染；`{ text }` 是
 * 无需翻译的原文（数字、模型名、单位缩写）。与 `utils/schedule-format.ts` 的
 * `ScheduleDescription` 同形，参数里可以再嵌套一个描述。
 */
export type UsageText =
  | { key: string; params?: Record<string, string | number | UsageText> }
  | { text: string };

export function renderUsageText(t: TFunction, text: UsageText): string {
  if ("text" in text) return text.text;
  const params = text.params
    ? Object.fromEntries(
        Object.entries(text.params).map(([name, value]) => [
          name,
          typeof value === "object" ? renderUsageText(t, value) : value,
        ]),
      )
    : undefined;
  return t(text.key, params);
}
