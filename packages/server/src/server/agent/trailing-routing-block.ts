const BLOCK_OPEN = "<paseo-system>\n";
const BLOCK_CLOSE = "\n</paseo-system>";

/**
 * Drop the `<paseo-system>` block that trails user-written text (the Routing block).
 * Matches by shape only. A message that is nothing but the block is an envelope and
 * is left to `isSystemInjectedEnvelope`. Run it on full text, before any whitespace
 * collapsing or truncation, or the shape is gone.
 */
export function stripTrailingRoutingBlock(text: string): string {
  const trimmed = text.trimEnd();
  if (!trimmed.endsWith(BLOCK_CLOSE)) return text;
  const start = trimmed.lastIndexOf(BLOCK_OPEN);
  if (start <= 0) return text;
  return trimmed.slice(0, start).trimEnd();
}
