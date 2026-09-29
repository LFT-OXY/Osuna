import type { InlineSegment } from "@/inline-blocks";

/** Live text is read by editing consumers; containers subscribe only to what they display. */
export interface ComposerTextSource {
  getSnapshot: () => string;
  /** 与 getSnapshot 对应的分段结构，只在含块时有；输入框挂载时用它恢复块。 */
  getSegmentsSnapshot?: () => readonly InlineSegment[] | undefined;
  subscribe: (listener: () => void) => () => void;
}
