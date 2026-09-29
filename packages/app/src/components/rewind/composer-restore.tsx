import type { ComposerTextSource } from "@/composer/text-source";
import {
  inlineSegmentsText,
  leadingSkillSegments,
  parseInlineSegments,
  splitLeadingSkillBlocks,
  type InlineSegment,
} from "@/inline-blocks";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

interface RewindComposerRestoreContextValue {
  completeRewind: (text: string) => void;
}

interface RewindComposerRestoreProviderProps {
  textSource: ComposerTextSource;
  /** 该 agent 的 skill 名；拿不到时为 null，开头的 `/name` 按文字写回。 */
  skillNames: ReadonlySet<string> | null;
  setText: (text: string, segments: readonly InlineSegment[]) => void;
  onRewindComplete: () => void;
  children: ReactNode;
}

const RewindComposerRestoreContext = createContext<RewindComposerRestoreContextValue | null>(null);

export function restoreComposerTextIfEmpty(input: {
  currentText: string;
  rewoundText: string;
}): string {
  if (input.currentText.length > 0) {
    return input.currentText;
  }
  return input.rewoundText;
}

export interface RewoundComposerContent {
  text: string;
  segments: InlineSegment[];
}

/** 气泡文本写回输入框：按气泡的解析规则认出块，开头的 Skill block 在输入框里各跟一个空格。 */
export function resolveRewoundComposerContent(
  rewoundText: string,
  skillNames: ReadonlySet<string> | null,
): RewoundComposerContent {
  const { blocks, rest } = splitLeadingSkillBlocks(
    parseInlineSegments(rewoundText, { skillNames }),
  );
  const segments = leadingSkillSegments(blocks, rest);
  return { text: inlineSegmentsText(segments), segments };
}

export function RewindComposerRestoreProvider({
  textSource,
  skillNames,
  setText,
  onRewindComplete,
  children,
}: RewindComposerRestoreProviderProps) {
  const completeRewind = useCallback(
    (rewoundText: string) => {
      const currentText = textSource.getSnapshot();
      const nextText = restoreComposerTextIfEmpty({
        currentText: currentText,
        rewoundText,
      });
      if (nextText !== currentText) {
        const content = resolveRewoundComposerContent(nextText, skillNames);
        setText(content.text, content.segments);
      }
      onRewindComplete();
    },
    [onRewindComplete, setText, skillNames, textSource],
  );

  const value = useMemo(() => ({ completeRewind }), [completeRewind]);

  return (
    <RewindComposerRestoreContext.Provider value={value}>
      {children}
    </RewindComposerRestoreContext.Provider>
  );
}

export function useRewindComposerRestore(): RewindComposerRestoreContextValue | null {
  return useContext(RewindComposerRestoreContext);
}
