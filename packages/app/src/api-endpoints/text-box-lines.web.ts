import type { EditingTextInputHandle } from "@/components/ui/text-input";

/**
 * 网页与桌面端：让多行框按任意字符换行（key 里的连字符不当断词点，行尾的「-」不会被误读），
 * 再量出按当前宽度占几行。多行框不会随内容自己长高，也不会在删字后变矮，
 * 所以先临时设成一行再读 scrollHeight（原生端见 text-box-lines.ts）。
 */
export function wrapAnywhereAndCountLines(handle: EditingTextInputHandle | null): number | null {
  const node = handle?.getNativeRef();
  if (!(node instanceof HTMLTextAreaElement)) return null;
  node.style.wordBreak = "break-all";
  const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return null;
  const rows = node.rows;
  node.rows = 1;
  const lines = Math.max(1, Math.round(node.scrollHeight / lineHeight));
  node.rows = rows;
  return lines;
}
