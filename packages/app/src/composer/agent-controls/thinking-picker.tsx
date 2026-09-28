import type { ReactElement, RefObject } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { ThinkingSlider } from "@/composer/agent-controls/thinking-slider";
import { shouldUseThinkingSlider } from "@/composer/agent-controls/thinking";

const DESKTOP_SEARCH_THRESHOLD = 6;
const LIST_POPOVER_WIDTH = 200;
const SLIDER_POPOVER_WIDTH = 240;
const NO_OPTIONS: ComboboxOption[] = [];

export interface ThinkingPickerProps {
  /** toolbar：桌面工具栏的锚定浮层；sheet：手机 Agent controls sheet 里推入的页面。 */
  surface: "toolbar" | "sheet";
  options: ComboboxOption[];
  selectedId: string | undefined;
  provider: string;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: RefObject<View | null>;
  /** 滑条选档，浮层保持打开。 */
  onSelect: (id: string) => void;
  /** 列表选项；列表按原来的方式处理关闭。 */
  onSelectFromList: (id: string) => void;
  renderOption: (args: {
    option: ComboboxOption;
    selected: boolean;
    active: boolean;
    onPress: () => void;
  }) => ReactElement;
}

/** 思考等级的浮层内容：2 到 6 档用滑条，其余档数保留原来的列表。 */
export function ThinkingPicker({
  surface,
  options,
  selectedId,
  provider,
  disabled,
  open,
  onOpenChange,
  anchorRef,
  onSelect,
  onSelectFromList,
  renderOption,
}: ThinkingPickerProps) {
  const { t } = useTranslation();
  const isSheet = surface === "sheet";
  const presentationProps = isSheet
    ? { title: t("agentControls.thinking.title"), presentation: "push" as const }
    : { desktopPlacement: "top-start" as const };

  if (!shouldUseThinkingSlider(options.length)) {
    return (
      <Combobox
        {...presentationProps}
        options={options}
        value={selectedId ?? ""}
        onSelect={onSelectFromList}
        searchable={!isSheet && options.length > DESKTOP_SEARCH_THRESHOLD}
        open={open}
        onOpenChange={onOpenChange}
        anchorRef={anchorRef}
        desktopMinWidth={LIST_POPOVER_WIDTH}
        renderOption={renderOption}
      />
    );
  }

  return (
    <Combobox
      {...presentationProps}
      options={NO_OPTIONS}
      value={selectedId ?? ""}
      onSelect={onSelect}
      open={open}
      onOpenChange={onOpenChange}
      anchorRef={anchorRef}
      desktopMinWidth={SLIDER_POPOVER_WIDTH}
      desktopChildrenScrollEnabled={false}
      mobileChildrenScrollEnabled={false}
    >
      <View style={isSheet ? styles.sheetBody : styles.popoverBody}>
        <ThinkingSlider
          options={options}
          selectedId={selectedId}
          provider={provider}
          disabled={disabled}
          onSelect={onSelect}
        />
      </View>
    </Combobox>
  );
}

const styles = StyleSheet.create((theme) => ({
  popoverBody: {
    padding: theme.spacing[3],
  },
  sheetBody: {
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[3],
  },
}));
