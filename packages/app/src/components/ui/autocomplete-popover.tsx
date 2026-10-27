import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";
import { View, useWindowDimensions } from "react-native";
import { Portal } from "@gorhom/portal";
import Animated, { useAnimatedReaction, useAnimatedStyle } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Autocomplete,
  type AutocompleteGroupNotices,
  type AutocompleteOption,
  type AutocompleteOptionIconRenderer,
} from "@/components/ui/autocomplete";
import { hasSelectableAutocompleteOption } from "@/components/ui/autocomplete-utils";
import {
  measureFloatingPanelPortalHost,
  useFloatingPanelPortalHostName,
} from "@/components/ui/floating-panel-portal";
import { KeyboardTranslateView, useKeyboardAnchor, useKeyboardShift } from "@/keyboard/shift";
import { SPACING } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

// 面板左右相对 Composer 内缩，与 Composer context strip 的 marginHorizontal 相同。
const PANEL_INSET = SPACING[6];
// 面板顶边与可用空间上沿之间至少留出的距离。
const TOP_CLEARANCE = SPACING[3];

interface RelativeAnchorRect {
  x: number;
  y: number;
  width: number;
  hostHeight: number;
}

interface AutocompletePopoverProps {
  visible: boolean;
  anchorRef: RefObject<View | null>;
  options: readonly AutocompleteOption[];
  selectedIndex: number;
  onSelect: (option: AutocompleteOption) => void;
  onHighlight?: (index: number) => void;
  isLoading?: boolean;
  errorMessage?: string;
  loadingText?: string;
  emptyText?: string;
  footerText?: string;
  groupNotices?: AutocompleteGroupNotices;
  renderOptionIcon?: AutocompleteOptionIconRenderer;
}

export function AutocompletePopover({
  visible,
  anchorRef,
  options,
  selectedIndex,
  onSelect,
  onHighlight,
  isLoading,
  errorMessage,
  loadingText,
  emptyText,
  footerText,
  groupNotices,
  renderOptionIcon,
}: AutocompletePopoverProps): ReactElement | null {
  "use no memo";
  // React Compiler memoizes effect captures by reading SharedValue.value during render.
  const [relativeAnchorRect, setRelativeAnchorRect] = useState<RelativeAnchorRect | null>(null);
  const windowDimensions = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const portalHostName = useFloatingPanelPortalHostName();
  const { isMoving } = useKeyboardShift();
  const anchor = useKeyboardAnchor();
  const { measureAtRest } = anchor;
  const measurementGeneration = useRef(0);
  // 高亮就位后才显示，免得首帧没有高亮行；全是置灰行时没有可高亮的行，直接显示。
  const hasSelectableOption = hasSelectableAutocompleteOption(options);
  const canMeasure = visible && (!hasSelectableOption || selectedIndex >= 0);

  const remeasure = useCallback(() => {
    if (!canMeasure) return;
    const anchorElement = anchorRef.current;
    if (!anchorElement) return;
    const generation = measurementGeneration.current;
    void Promise.all([
      measureAtRest(anchorElement),
      measureFloatingPanelPortalHost(portalHostName),
    ]).then(([anchorRect, hostRect]) => {
      if (generation !== measurementGeneration.current || !anchorRect || !hostRect) {
        return undefined;
      }
      setRelativeAnchorRect({
        x: anchorRect.x - hostRect.x,
        y: anchorRect.y - hostRect.y,
        width: anchorRect.width,
        hostHeight: hostRect.height,
      });
      return undefined;
    });
  }, [anchorRef, canMeasure, measureAtRest, portalHostName]);

  useEffect(() => {
    measurementGeneration.current += 1;
    if (!canMeasure) {
      setRelativeAnchorRect(null);
      return;
    }

    remeasure();
    const raf = requestAnimationFrame(remeasure);

    return () => {
      measurementGeneration.current += 1;
      cancelAnimationFrame(raf);
    };
  }, [canMeasure, remeasure, windowDimensions.width, windowDimensions.height]);

  useAnimatedReaction(
    () => isMoving.value,
    (moving, wasMoving) => {
      if (wasMoving && !moving) {
        scheduleOnRN(remeasure);
      }
    },
    [isMoving, remeasure],
  );

  // Lay out at the anchor's resting position; the KeyboardTranslateView below lifts
  // it with the anchor. Height changes only at keyboard boundaries.
  const baseStyle = useMemo(() => {
    if (!relativeAnchorRect) return null;
    return inlineUnistylesStyle({
      position: "absolute" as const,
      left: relativeAnchorRect.x + PANEL_INSET,
      width: Math.max(0, relativeAnchorRect.width - PANEL_INSET * 2),
      // 底边正好落在 Composer 顶边上：Portal 画在 Composer 之上，再往下伸会盖住它的顶边描边。
      bottom: relativeAnchorRect.hostHeight - relativeAnchorRect.y,
    });
  }, [relativeAnchorRect]);

  const anchorY = relativeAnchorRect?.y ?? 0;
  const reservedLift = anchor.reservedLift;
  const heightStyle = useAnimatedStyle(
    () => ({
      maxHeight: Math.max(0, anchorY - reservedLift.value - safeAreaInsets.top - TOP_CLEARANCE),
    }),
    [anchorY, reservedLift, safeAreaInsets.top],
  );

  if (!visible || !relativeAnchorRect || !baseStyle) return null;
  if (hasSelectableOption && selectedIndex < 0) return null;

  // The translate view is the popover's own frame, so it lifts only the popover.
  return (
    <Portal hostName={portalHostName}>
      <KeyboardTranslateView {...anchor.translation} style={baseStyle}>
        <Animated.View testID="composer-autocomplete-popover" style={heightStyle}>
          <Autocomplete
            options={options}
            selectedIndex={selectedIndex}
            onSelect={onSelect}
            onHighlight={onHighlight}
            isLoading={isLoading}
            errorMessage={errorMessage}
            loadingText={loadingText}
            emptyText={emptyText}
            footerText={footerText}
            groupNotices={groupNotices}
            renderOptionIcon={renderOptionIcon}
          />
        </Animated.View>
      </KeyboardTranslateView>
    </Portal>
  );
}
