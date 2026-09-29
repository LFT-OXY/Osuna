export interface FileMentionRange {
  start: number;
  end: number;
  query: string;
}

interface FindActiveFileMentionInput {
  text: string;
  cursorIndex: number;
  /** 光标前最后一个行内块的结束偏移：`@` 不能在块里或块之前。 */
  blockBoundary: number;
}

const INVALID_MENTION_QUERY_CHARS = /[\s\n\r\t"']/;

export function findActiveFileMention(input: FindActiveFileMentionInput): FileMentionRange | null {
  const clampedCursor = Math.max(0, Math.min(input.cursorIndex, input.text.length));
  const beforeCursor = input.text.slice(0, clampedCursor);

  for (
    let atIndex = beforeCursor.lastIndexOf("@");
    atIndex >= 0;
    atIndex = atIndex === 0 ? -1 : beforeCursor.lastIndexOf("@", atIndex - 1)
  ) {
    const query = beforeCursor.slice(atIndex + 1);
    if (INVALID_MENTION_QUERY_CHARS.test(query)) {
      continue;
    }
    if (atIndex < input.blockBoundary) return null;
    return {
      start: atIndex,
      end: clampedCursor,
      query,
    };
  }

  return null;
}
