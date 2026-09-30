import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAutocompleteFallbackIndex,
  getAutocompleteNextIndex,
  hasSelectableAutocompleteOption,
  type SelectableOption,
} from "@/components/ui/autocomplete-utils";

interface AutocompleteKeyPressEvent {
  key: string;
  preventDefault: () => void;
}

interface UseAutocompleteInput<
  TOption extends SelectableOption,
  TKeyPressEvent extends AutocompleteKeyPressEvent = AutocompleteKeyPressEvent,
> {
  isVisible: boolean;
  options: readonly TOption[];
  query: string;
  onSelectOption: (option: TOption, event?: TKeyPressEvent) => void;
  onEscape?: () => void;
}

interface UseAutocompleteResult<TKeyPressEvent extends AutocompleteKeyPressEvent> {
  selectedIndex: number;
  /** 悬停与键盘共用同一个高亮。 */
  onHighlight: (index: number) => void;
  onKeyPress: (event: TKeyPressEvent) => boolean;
}

export function useAutocomplete<
  TOption extends SelectableOption,
  TKeyPressEvent extends AutocompleteKeyPressEvent = AutocompleteKeyPressEvent,
>(input: UseAutocompleteInput<TOption, TKeyPressEvent>): UseAutocompleteResult<TKeyPressEvent> {
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const previousQueryRef = useRef("");

  useEffect(() => {
    if (!input.isVisible) {
      previousQueryRef.current = input.query;
      setSelectedIndex(-1);
      return;
    }

    const queryChanged = previousQueryRef.current !== input.query;
    previousQueryRef.current = input.query;

    setSelectedIndex((current) => {
      const fallbackIndex = getAutocompleteFallbackIndex(input.options);

      if (queryChanged) {
        return fallbackIndex;
      }
      const currentOption = input.options[current];
      const currentIsSelectable = currentOption !== undefined && !currentOption.disabled;
      return currentIsSelectable ? current : fallbackIndex;
    });
  }, [input.isVisible, input.options, input.query]);

  const onKeyPress = useCallback(
    (event: TKeyPressEvent) => {
      if (!input.isVisible || !hasSelectableAutocompleteOption(input.options)) {
        return false;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((current) =>
          getAutocompleteNextIndex({
            currentIndex: current,
            options: input.options,
            key: "ArrowUp",
          }),
        );
        return true;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((current) =>
          getAutocompleteNextIndex({
            currentIndex: current,
            options: input.options,
            key: "ArrowDown",
          }),
        );
        return true;
      }

      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        const resolvedIndex =
          selectedIndex >= 0 && !input.options[selectedIndex]?.disabled
            ? selectedIndex
            : getAutocompleteFallbackIndex(input.options);
        const selectedOption = input.options[resolvedIndex];
        if (selectedOption) {
          input.onSelectOption(selectedOption, event);
        }
        return true;
      }

      if (event.key === "Escape" && input.onEscape) {
        event.preventDefault();
        input.onEscape();
        return true;
      }

      return false;
    },
    [input, selectedIndex],
  );

  const onHighlight = useCallback(
    (index: number) => {
      const option = input.options[index];
      if (option && !option.disabled) setSelectedIndex(index);
    },
    [input.options],
  );

  return {
    selectedIndex,
    onHighlight,
    onKeyPress,
  };
}
