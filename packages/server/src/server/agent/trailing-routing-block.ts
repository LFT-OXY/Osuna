const BLOCK_OPEN = "<paseo-system>\n";
const BLOCK_CLOSE = "\n</paseo-system>";

/**
 * Drop the `<paseo-system>` blocks that trail user-written text: the Routing block and
 * the logic map instruction block, which the daemon appends in that order. Matches by
 * shape only. A message that is nothing but blocks is an envelope and is left to
 * `isSystemInjectedEnvelope`. Run it on full text, before any whitespace collapsing or
 * truncation, or the shape is gone.
 */
export function stripTrailingRoutingBlock(text: string): string {
  let result = text;
  for (;;) {
    const trimmed = result.trimEnd();
    if (!trimmed.endsWith(BLOCK_CLOSE)) return result;
    const start = trimmed.lastIndexOf(BLOCK_OPEN);
    // 只剩块、没有用户文字：整条是信封，原样返回。
    if (start <= 0) return text;
    result = trimmed.slice(0, start).trimEnd();
  }
}
