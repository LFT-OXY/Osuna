import type { TextInputSelectionChangeEventData } from "react-native";
import type { EditingTextInputHandle, EditingTextInputProps } from "@/components/ui/text-input";
import type { InlineBlock, InlineSegment, SkillBlock, TextRange } from "@/inline-blocks";

/** 文字偏移表示的选区。 */
export type ComposerTextSelection = TextRange;

/** 编辑器读出的选区。 */
export interface ComposerLiveSelection extends ComposerTextSelection {
  /** 光标前最后一个行内块结束处的偏移，没有块时为 0；`@`、`/` 识别不往回越过它。 */
  blockBoundary: number;
}

/** Composer 按键与补全读取的输入框当前状态。 */
export interface ComposerInputSnapshot {
  text: string;
  selection: ComposerTextSelection;
  /** 光标前最后一个行内块结束处的偏移，没有块时为 0。 */
  blockBoundary: number;
}

/** Web 端的选区事件另带 blockBoundary；原生端的 RN 事件没有。 */
export type ComposerSelectionChangeEventData = TextInputSelectionChangeEventData & {
  blockBoundary?: number;
};

export interface ComposerTextInputHandle extends EditingTextInputHandle {
  /** 实时选区。原生端没有，以最近一次选区事件为准。 */
  getSelection?(): ComposerLiveSelection;
  /** 把 range 换成行内块并补一个空格。原生端没有，由 MessageInput 插入块的链接文字。 */
  insertInlineBlock?(block: InlineBlock, range: ComposerTextSelection): void;
  /**
   * 选中 skill：去掉 command 范围的 `/query`，块追加到开头块串末尾，光标回到原处。
   * 原生端没有，由 MessageInput 在正文开头插入 `/name `。
   */
  pickSkillBlock?(block: SkillBlock, command: ComposerTextSelection | null): void;
  /** 当前内容的分段结构。原生端没有，内容只有文字。 */
  getSegments?(): InlineSegment[];
  /** 以分段结构整体替换内容，块仍是块；光标默认在末尾。与 replaceText 一样不进撤销栈。 */
  replaceSegments?(segments: readonly InlineSegment[], selection?: ComposerTextSelection): void;
}

/** Web 端额外读 react-native-web 的 `dataSet`，渲染成根元素上的 `data-*`。 */
export type ComposerTextInputProps = EditingTextInputProps & {
  dataSet?: Readonly<Record<string, string>>;
  /** 挂载时的分段结构，文字与 initialValue 一致时代替它，块恢复成块。原生端忽略。 */
  initialSegments?: readonly InlineSegment[];
  /** 块里 Agent mention 的 provider 图标按这个 host 的 provider 快照解析。原生端忽略。 */
  inlineBlockServerId?: string | null;
};
