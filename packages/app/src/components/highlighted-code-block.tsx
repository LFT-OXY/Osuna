import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Pressable,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MarkdownTextSpan } from "@/components/markdown-text";
import { Text } from "@/components/ui/text";
import {
  iconButtonChromeGlyphSize,
  iconButtonChromeStyle,
} from "@/components/ui/icon-button-chrome";
import * as Clipboard from "expo-clipboard";
import { Check, Copy } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { HighlightToken } from "@getpaseo/highlight";
import { isWeb } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { highlightToKeyedLines, type KeyedLine } from "@/utils/highlight-cache";
import {
  markdownCopyCodeBlockDataSet,
  markdownCopyDataSet,
  TRAILING_CODE_LINE_BREAKS,
} from "@/assistant-selection-copy/markup";

interface HighlightedCodeBlockProps {
  code: string;
  language: string | null | undefined;
  inheritedStyles: TextStyle;
  textStyle: TextStyle;
  /** 头部里排在复制按钮之前的额外控件（Mermaid 源码视图的切回图表按钮）。 */
  renderHeaderActions?: () => ReactNode;
}

// Fence info strings ("```ts", "```typescript", "```ts {1,3}") map to the
// extension-based parser table in @getpaseo/highlight. Aliases here only
// cover names that don't already match an extension key in parsers.ts.
const LANGUAGE_ALIASES: Record<string, string> = {
  typescript: "ts",
  javascript: "js",
  python: "py",
  rust: "rs",
  golang: "go",
  "c++": "cpp",
  csharp: "cs",
  "c#": "cs",
  objc: "m",
  "objective-c": "m",
  markdown: "md",
  elixir: "ex",
};

function fenceLanguageToExtension(info: string | null | undefined): string | null {
  if (!info) return null;
  const first = info.trim().split(/\s+/)[0]?.toLowerCase();
  if (!first) return null;
  const normalized = first.replace(/^\./, "");
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

function stripTerminalFenceNewline(code: string): string {
  return code.endsWith("\n") ? code.slice(0, -1) : code;
}

export const HighlightedCodeBlock = React.memo(function HighlightedCodeBlock({
  code,
  language,
  inheritedStyles,
  textStyle,
  renderHeaderActions,
}: HighlightedCodeBlockProps) {
  // 外框（底色、描边、圆角、外边距）画在容器上，内边距给代码文本，头部一行因此落在外框内、
  // 代码上方，标签与代码左侧对齐。代码文本必须是容器的直接子节点：选中复制按 `pre > code` 取代码。
  const { containerStyle, headerStyle, innerTextStyle } = useMemo(
    () => splitFenceStyle(inheritedStyles, textStyle),
    [inheritedStyles, textStyle],
  );
  const renderedCode = useMemo(() => stripTerminalFenceNewline(code), [code]);
  const copyDataSet = useMemo(
    () => ({ ...CODE_SURFACE_DATASET, ...markdownCopyCodeBlockDataSet(language) }),
    [language],
  );

  const keyedLines = useMemo<KeyedLine[] | null>(
    () => highlightToKeyedLines(renderedCode, fenceLanguageToExtension(language)),
    [renderedCode, language],
  );

  // Copy the code without its trailing blank lines. A fence body ends in a newline,
  // and ends in more than one when the author left a blank line before the closing
  // fence; pasting any of them into a terminal runs the last line.
  const getCode = useCallback(() => code.replace(TRAILING_CODE_LINE_BREAKS, ""), [code]);

  return (
    <View style={containerStyle} dataSet={copyDataSet}>
      {/* 头部是外观元素，选中复制会丢弃它，复制出的代码块不带语言标签。 */}
      <View style={headerStyle} dataSet={markdownCopyDataSet.ignore}>
        <Text
          variant="micro"
          color="foregroundMuted"
          numberOfLines={1}
          selectable={false}
          style={codeBlockHeaderStyles.language}
        >
          {language ?? ""}
        </Text>
        <View style={codeBlockHeaderStyles.actions}>
          {renderHeaderActions?.()}
          <CopyButton getCode={getCode} />
        </View>
      </View>
      {keyedLines ? (
        <MarkdownTextSpan style={innerTextStyle} copyTag="code">
          {renderCodeSegments(keyedLines)}
        </MarkdownTextSpan>
      ) : (
        <MarkdownTextSpan style={innerTextStyle} copyTag="code">
          {renderedCode}
        </MarkdownTextSpan>
      )}
    </View>
  );
});

function renderCodeSegments(keyedLines: KeyedLine[]): React.ReactNode[] {
  const segments: React.ReactNode[] = [];
  for (let lineIndex = 0; lineIndex < keyedLines.length; lineIndex += 1) {
    const line = keyedLines[lineIndex];
    if (lineIndex > 0) {
      segments.push(<CodeTextSpan key={`${line.key}-newline`} text={"\n"} />);
    }
    for (const { key, token } of line.tokens) {
      segments.push(<TokenSpan key={`${line.key}-${key}`} token={token} />);
    }
  }
  return segments;
}

interface TokenSpanProps {
  token: HighlightToken;
}

const TokenSpan = React.memo(function TokenSpan({ token }: TokenSpanProps) {
  return (
    <MarkdownTextSpan style={token.style ? syntaxTokenStyleFor(token.style) : undefined}>
      {token.text}
    </MarkdownTextSpan>
  );
});

interface CodeTextSpanProps {
  text: string;
}

const CodeTextSpan = React.memo(function CodeTextSpan({ text }: CodeTextSpanProps) {
  return <MarkdownTextSpan>{text}</MarkdownTextSpan>;
});

interface SplitStyles {
  containerStyle: StyleProp<ViewStyle>;
  headerStyle: StyleProp<ViewStyle>;
  innerTextStyle: StyleProp<TextStyle>;
}

const WEB_SELECTABLE: TextStyle = isWeb ? ({ userSelect: "text" } as TextStyle) : {};

function splitFenceStyle(inheritedStyles: TextStyle, textStyle: TextStyle): SplitStyles {
  const {
    fontFamily,
    fontSize,
    color,
    padding,
    paddingHorizontal,
    paddingTop,
    paddingBottom,
    ...frame
  } = textStyle;
  const textOnly: TextStyle = { ...WEB_SELECTABLE };
  if (fontFamily !== undefined) textOnly.fontFamily = fontFamily;
  if (fontSize !== undefined) textOnly.fontSize = fontSize;
  if (fontSize !== undefined) textOnly.lineHeight = Math.round(fontSize * 1.45);
  if (color !== undefined) textOnly.color = color;
  const inset: TextStyle = { padding, paddingHorizontal, paddingTop, paddingBottom };
  return {
    containerStyle: frame as ViewStyle,
    headerStyle: [codeBlockHeaderStyles.header, { paddingLeft: paddingHorizontal ?? padding }],
    innerTextStyle: [inheritedStyles, textOnly, inset],
  };
}

interface CopyButtonProps {
  getCode: () => string;
}

const COPIED_RESET_MS = 1500;

const copyButtonChromeStyle = (state: PressableStateCallbackType & { hovered?: boolean }) =>
  iconButtonChromeStyle({ size: "small", state });
const compactCopyButtonChromeStyle = (state: PressableStateCallbackType & { hovered?: boolean }) =>
  iconButtonChromeStyle({ size: "small", state, compact: true });

const CopyButton = React.memo(function CopyButton({ getCode }: CopyButtonProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [copied, setCopied] = useState(false);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    [],
  );

  const handlePress = useCallback(async () => {
    const content = getCode();
    if (!content) return;
    await Clipboard.setStringAsync(content);
    setCopied(true);
    if (resetRef.current) clearTimeout(resetRef.current);
    resetRef.current = setTimeout(() => {
      setCopied(false);
      resetRef.current = null;
    }, COPIED_RESET_MS);
  }, [getCode]);

  const glyphSize = iconButtonChromeGlyphSize("small", isCompact);

  return (
    <Pressable
      onPress={handlePress}
      style={isCompact ? compactCopyButtonChromeStyle : copyButtonChromeStyle}
      accessibilityRole="button"
      accessibilityLabel={copied ? t("message.actions.copied") : t("message.actions.copyCode")}
      dataSet={markdownCopyDataSet.ignore}
    >
      {({ hovered }) => {
        const iconColor = hovered
          ? codeBlockHeaderStyles.iconHoveredColor.color
          : codeBlockHeaderStyles.iconColor.color;
        return copied ? (
          <Check size={glyphSize} color={iconColor} />
        ) : (
          <Copy size={glyphSize} color={iconColor} />
        );
      }}
    </Pressable>
  );
});

const codeBlockHeaderStyles = StyleSheet.create((theme) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: theme.controlHeight.md,
    paddingRight: theme.spacing[1],
  },
  language: {
    flex: 1,
    minWidth: 0,
    fontFamily: theme.fontFamily.mono,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[0.5],
  },
  iconColor: {
    color: theme.colors.foregroundMuted,
  },
  iconHoveredColor: {
    color: theme.colors.foreground,
  },
}));
