import type { ComposerTextSource } from "@/composer/text-source";
import {
  splitLeadingSkillBlocks,
  type SkillChip,
  type SkillChipSplit,
} from "@/composer/skill-chips";
import { parseInlineSegments, type InlineSegment } from "@/inline-blocks";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

interface RewindComposerRestoreContextValue {
  completeRewind: (text: string) => void;
}

interface RewindComposerRestoreProviderProps {
  textSource: ComposerTextSource;
  /** 该 agent 的 skill 名；拿不到时为 null，开头的 `/name` 按文字写回。 */
  skillNames: ReadonlySet<string> | null;
  setText: (text: string, segments: readonly InlineSegment[]) => void;
  /** chip 也是输入框里的内容：有 chip 时与有文字一样，不写回。 */
  hasSkillChips: boolean;
  setSkillChips: (chips: readonly SkillChip[]) => void;
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

/** 气泡文本写回输入框：按气泡的解析规则认出块，开头的 Skill block 回到 chip。 */
export function resolveRewoundComposerContent(
  rewoundText: string,
  skillNames: ReadonlySet<string> | null,
): SkillChipSplit {
  return splitLeadingSkillBlocks(parseInlineSegments(rewoundText, { skillNames }));
}

export function RewindComposerRestoreProvider({
  textSource,
  skillNames,
  setText,
  hasSkillChips,
  setSkillChips,
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
      if (!hasSkillChips && nextText !== currentText) {
        const content = resolveRewoundComposerContent(nextText, skillNames);
        if (content.chips.length > 0) setSkillChips(content.chips);
        setText(content.text, content.body);
      }
      onRewindComplete();
    },
    [hasSkillChips, onRewindComplete, setSkillChips, setText, skillNames, textSource],
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
