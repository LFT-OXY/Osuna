import type { EditingTextInputHandle, EditingTextInputProps } from "@/components/ui/text-input";

/** 文字偏移表示的选区。 */
export interface ComposerTextSelection {
  start: number;
  end: number;
}

export interface ComposerTextInputHandle extends EditingTextInputHandle {
  /** 实时选区。原生端没有，以最近一次选区事件为准。 */
  getSelection?(): ComposerTextSelection;
}

/** Web 端额外读 react-native-web 的 `dataSet`，渲染成根元素上的 `data-*`。 */
export type ComposerTextInputProps = EditingTextInputProps & {
  dataSet?: Readonly<Record<string, string>>;
};
