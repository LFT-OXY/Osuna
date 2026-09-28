import { useCallback, useEffect, useMemo, useRef, type ReactElement } from "react";
import {
  ScrollView,
  View,
  Pressable,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Box, File, Folder, SquareSlash } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { MENU_ITEM_HEIGHT } from "@/components/ui/menu/menu-geometry";
import { composerSurfaceStyle } from "@/styles/floating-surface";
import { GLASS_SURFACES_ENABLED } from "@/styles/glass-support";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { AutocompleteFadeFrame } from "./autocomplete-fade";
import {
  AUTOCOMPLETE_FADE_HEIGHT,
  getAutocompleteGroup,
  getAutocompleteScrollOffset,
  type AutocompleteGroup,
} from "./autocomplete-utils";

export interface AutocompleteOption {
  id: string;
  label: string;
  /** 参数提示，如 `<file>`。 */
  detail?: string;
  description?: string;
  kind?: "command" | "skill" | "file" | "directory";
}

interface AutocompleteProps {
  options: readonly AutocompleteOption[];
  selectedIndex: number;
  onSelect: (option: AutocompleteOption) => void;
  /** 指针移到某行时把高亮交给它，与键盘共用同一个高亮。 */
  onHighlight?: (index: number) => void;
  isLoading?: boolean;
  errorMessage?: string;
  loadingText?: string;
  emptyText?: string;
  /** 列表底部的说明行，不可选，键盘导航不经过它。 */
  footerText?: string;
  maxHeight?: number;
}

const GROUP_TITLE_KEYS = {
  commands: "agentAutocomplete.groups.commands",
  skills: "agentAutocomplete.groups.skills",
} as const satisfies Record<AutocompleteGroup, string>;

const BOLT_GLYPH_PATTERN = /\u26A1|\uFE0F/gu;

function removeBoltGlyphs(value?: string): string | undefined {
  if (!value) {
    return value;
  }
  const cleaned = value.replace(BOLT_GLYPH_PATTERN, "").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

const ThemedBox = withUnistyles(Box);
const ThemedFile = withUnistyles(File);
const ThemedFolder = withUnistyles(Folder);
const ThemedSquareSlash = withUnistyles(SquareSlash);

const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function AutocompleteOptionIcon({ kind }: { kind: AutocompleteOption["kind"] }) {
  switch (kind) {
    case "skill":
      return <ThemedBox size={ICON_SIZE.md} uniProps={mutedIconColor} />;
    case "directory":
      return <ThemedFolder size={ICON_SIZE.md} uniProps={mutedIconColor} />;
    case "file":
      return <ThemedFile size={ICON_SIZE.md} uniProps={mutedIconColor} />;
    default:
      return <ThemedSquareSlash size={ICON_SIZE.md} uniProps={mutedIconColor} />;
  }
}

interface AutocompleteRowProps {
  index: number;
  option: AutocompleteOption;
  isHighlighted: boolean;
  onSelect: (option: AutocompleteOption) => void;
  onHighlight?: (index: number) => void;
  onRowLayout: (index: number, event: LayoutChangeEvent) => void;
}

function AutocompleteRow({
  index,
  option,
  isHighlighted,
  onSelect,
  onHighlight,
  onRowLayout,
}: AutocompleteRowProps) {
  const label = removeBoltGlyphs(option.label) ?? option.label;
  const description = removeBoltGlyphs(option.description);
  const argumentHint = removeBoltGlyphs(option.detail);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => onRowLayout(index, event),
    [index, onRowLayout],
  );
  const handlePointerMove = useCallback(() => onHighlight?.(index), [index, onHighlight]);
  const handlePress = useCallback(() => onSelect(option), [onSelect, option]);
  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.row,
      (pressed || isHighlighted) && styles.rowHighlighted,
    ],
    [isHighlighted],
  );

  // 悬停按 docs/hover.md 的"A highlight the keyboard also moves"：用 pointermove，不用 enter/leave。
  return (
    <View style={styles.rowEnvelope} onLayout={handleLayout} onPointerMove={handlePointerMove}>
      <Pressable
        role="option"
        aria-selected={isHighlighted}
        onPress={handlePress}
        style={pressableStyle}
      >
        <View style={styles.rowIcon}>
          <AutocompleteOptionIcon kind={option.kind} />
        </View>
        <Text
          variant="label"
          numberOfLines={1}
          style={styles.rowLabel}
          testID="autocomplete-option-label"
        >
          {label}
        </Text>
        {description ? (
          <Text
            variant="label"
            color="foregroundMuted"
            numberOfLines={1}
            style={styles.rowDescription}
          >
            {description}
          </Text>
        ) : null}
        {argumentHint ? (
          <Text
            variant="label"
            color="foregroundExtraMuted"
            numberOfLines={1}
            style={styles.rowArgumentHint}
          >
            {argumentHint}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

interface AutocompleteGroupTitleProps {
  group: AutocompleteGroup;
  /** 标题下面那一行的下标。 */
  firstRowIndex: number;
  onTitleLayout: (firstRowIndex: number, event: LayoutChangeEvent) => void;
}

function AutocompleteGroupTitle({
  group,
  firstRowIndex,
  onTitleLayout,
}: AutocompleteGroupTitleProps) {
  const { t } = useTranslation();
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => onTitleLayout(firstRowIndex, event),
    [firstRowIndex, onTitleLayout],
  );
  return (
    <View style={styles.groupTitle} onLayout={handleLayout}>
      <Text
        variant="caption"
        color="foregroundMuted"
        weight="medium"
        testID="autocomplete-group-title"
      >
        {t(GROUP_TITLE_KEYS[group])}
      </Text>
    </View>
  );
}

interface ListLayoutCache {
  /** 这份缓存对应的列表签名。 */
  signature: string;
  rows: Map<number, { top: number; height: number }>;
  /** 组标题的顶边，按它下面那一行的下标存。 */
  groupTitleTops: Map<number, number>;
}

function createListLayoutCache(signature: string): ListLayoutCache {
  return { signature, rows: new Map(), groupTitleTops: new Map() };
}

/** 加载中、出错、无匹配与列表不完整的提示行，不可选。 */
function AutocompleteHint({ text }: { text: string }) {
  return (
    <View style={styles.hint}>
      <Text variant="label" color="foregroundMuted">
        {text}
      </Text>
    </View>
  );
}

export function Autocomplete({
  options,
  selectedIndex,
  onSelect,
  onHighlight,
  isLoading = false,
  errorMessage,
  loadingText,
  emptyText,
  footerText,
  maxHeight = 300,
}: AutocompleteProps) {
  const { t } = useTranslation();
  const resolvedLoadingText = loadingText ?? t("common.states.loading");
  const resolvedEmptyText = emptyText ?? t("common.empty.noResults");
  const scrollRef = useRef<ScrollView>(null);
  const layoutCacheRef = useRef<ListLayoutCache>(createListLayoutCache(""));
  const viewportHeightRef = useRef(0);
  const scrollOffsetRef = useRef(0);

  // 行与标题的位置只由这串 id 与 kind 决定。它变了就整体重挂列表：Web 上的 onLayout 只在尺寸
  // 变化时触发，过滤后只挪了位置的行不会重报，缓存会停在旧位置。
  const listSignature = useMemo(
    () => options.map((option) => `${option.kind ?? ""}:${option.id}`).join("\n"),
    [options],
  );

  // 缓存跟签名绑定，读写时发现签名变了就换一份新的：新行的 onLayout 可能早于任何 effect。
  const getLayoutCache = useCallback(() => {
    if (layoutCacheRef.current.signature !== listSignature) {
      layoutCacheRef.current = createListLayoutCache(listSignature);
    }
    return layoutCacheRef.current;
  }, [listSignature]);

  const ensureActiveItemVisible = useCallback(() => {
    if (selectedIndex < 0) {
      return;
    }

    const cache = getLayoutCache();
    const layout = cache.rows.get(selectedIndex);
    if (!layout) {
      return;
    }

    // 高亮落在某组第一行时，把组标题一起带进视野。
    const itemTop = cache.groupTitleTops.get(selectedIndex) ?? layout.top;
    const nextOffset = getAutocompleteScrollOffset({
      currentOffset: scrollOffsetRef.current,
      viewportHeight: viewportHeightRef.current,
      bottomInset: AUTOCOMPLETE_FADE_HEIGHT,
      itemTop,
      itemHeight: layout.top + layout.height - itemTop,
    });

    if (Math.abs(nextOffset - scrollOffsetRef.current) < 1) {
      return;
    }

    scrollOffsetRef.current = nextOffset;
    scrollRef.current?.scrollTo({ y: nextOffset, animated: false });
  }, [getLayoutCache, selectedIndex]);

  useEffect(() => {
    scrollOffsetRef.current = 0;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [listSignature]);

  useEffect(() => {
    const raf = requestAnimationFrame(ensureActiveItemVisible);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [ensureActiveItemVisible, options.length]);

  const handleScrollViewLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewportHeightRef.current = event.nativeEvent.layout.height;
      ensureActiveItemVisible();
    },
    [ensureActiveItemVisible],
  );

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
  }, []);

  const handleRowLayout = useCallback(
    (index: number, event: LayoutChangeEvent) => {
      getLayoutCache().rows.set(index, {
        top: event.nativeEvent.layout.y,
        height: event.nativeEvent.layout.height,
      });
      ensureActiveItemVisible();
    },
    [ensureActiveItemVisible, getLayoutCache],
  );

  const handleGroupTitleLayout = useCallback(
    (firstRowIndex: number, event: LayoutChangeEvent) => {
      getLayoutCache().groupTitleTops.set(firstRowIndex, event.nativeEvent.layout.y);
      ensureActiveItemVisible();
    },
    [ensureActiveItemVisible, getLayoutCache],
  );

  const containerStyle = useMemo(() => [styles.container, { maxHeight }], [maxHeight]);

  if (isLoading) {
    return (
      <View style={containerStyle}>
        <View style={styles.list}>
          <AutocompleteHint text={resolvedLoadingText} />
        </View>
      </View>
    );
  }

  if (errorMessage) {
    return (
      <View style={containerStyle}>
        <View style={styles.list}>
          <AutocompleteHint text={t("agentAutocomplete.error", { message: errorMessage })} />
        </View>
      </View>
    );
  }

  if (options.length === 0) {
    return (
      <View style={containerStyle}>
        <View style={styles.list}>
          <AutocompleteHint text={resolvedEmptyText} />
          {footerText ? <AutocompleteHint text={footerText} /> : null}
        </View>
      </View>
    );
  }

  // 选项已按组排好（orderAutocompleteGroups），组变化处插入标题；文件列表没有组，不插标题。
  const items: ReactElement[] = [];
  let previousGroup: AutocompleteGroup | null = null;
  options.forEach((option, index) => {
    const group = getAutocompleteGroup(option.kind);
    if (group && group !== previousGroup) {
      items.push(
        <AutocompleteGroupTitle
          key={`group:${group}`}
          group={group}
          firstRowIndex={index}
          onTitleLayout={handleGroupTitleLayout}
        />,
      );
    }
    previousGroup = group;
    items.push(
      <AutocompleteRow
        key={option.id}
        index={index}
        option={option}
        isHighlighted={index === selectedIndex}
        onSelect={onSelect}
        onHighlight={onHighlight}
        onRowLayout={handleRowLayout}
      />,
    );
  });

  return (
    <View style={containerStyle}>
      <AutocompleteFadeFrame>
        <ScrollView
          ref={scrollRef}
          onLayout={handleScrollViewLayout}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          style={styles.scrollView}
          keyboardShouldPersistTaps="always"
        >
          <View key={listSignature} style={styles.list}>
            {items}
            {footerText ? <AutocompleteHint text={footerText} /> : null}
          </View>
        </ScrollView>
      </AutocompleteFadeFrame>
    </View>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  // 与 Composer 同一种表面，但立在它的顶边上：底边由 Composer 的顶边描边充当，只画上、左、右
  // 三条边；Composer 的投影朝下，会落到 Composer 身上，只留顶部内高光。
  container: {
    flexShrink: 1,
    minHeight: 0,
    ...composerSurfaceStyle(theme, { glass: GLASS_SURFACES_ENABLED }),
    borderBottomWidth: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    boxShadow: `inset 0 1px 0 ${theme.colors.insetHighlight}`,
    overflow: "hidden",
  },
  scrollView: {
    flexGrow: 0,
    flexShrink: 1,
  },
  // 顶部多留一点，首行高亮的圆角不被面板的大圆角切掉；底部留出渐隐区，滚到底时末行完整可见。
  list: {
    paddingTop: theme.spacing[2],
    paddingBottom: AUTOCOMPLETE_FADE_HEIGHT,
  },
  rowEnvelope: {
    position: "relative",
  },
  // 与菜单行（components/ui/menu/menu-item.tsx）同一套几何：离面板边 4，圆角 sm。
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: MENU_ITEM_HEIGHT,
    gap: theme.spacing[2],
    marginHorizontal: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.radius.sm,
  },
  rowHighlighted: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  rowIcon: {
    width: ICON_SIZE.md,
    alignItems: "center",
    justifyContent: "center",
  },
  // 空间不够时先压缩描述，名字最后才截断；参数提示保持完整。
  rowLabel: {
    flexShrink: 1,
    minWidth: 0,
  },
  rowDescription: {
    flexShrink: 100,
    minWidth: 0,
  },
  rowArgumentHint: {
    flexShrink: 0,
  },
  groupTitle: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  hint: {
    justifyContent: "center",
    minHeight: MENU_ITEM_HEIGHT,
    paddingHorizontal: theme.spacing[3],
  },
})) as unknown as Record<string, object>;
