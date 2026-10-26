import type { MarkdownStyle } from "react-native-enriched-markdown";
import { contentTypeStep, type Theme } from "@/styles/theme";
import { isWeb } from "@/constants/platform";

const monoFamily = (theme: Theme) =>
  theme.fontFamily.mono === "ui-monospace" && !isWeb ? "" : theme.fontFamily.mono;

export function createMarkdownStyles(
  theme: Theme,
  { compact = false, blockGap }: { compact?: boolean; blockGap: number },
): { markdownStyle: MarkdownStyle; selectionColor: string } {
  // 正文与标题按内容字号走 Text 档位；compact 只把标题降一档，字号不变。
  const fontSize = theme.fontSize.content;
  // Every block is followed by the same gap; the library drops it after the last block.
  const block = { marginTop: 0, marginBottom: blockGap };
  const paragraph = {
    ...contentTypeStep(fontSize, "prose"),
    fontFamily: theme.fontFamily.ui,
    color: theme.colors.foregroundProse,
    ...block,
  };
  const heading = (variant: Parameters<typeof contentTypeStep>[1]) => ({
    ...paragraph,
    ...contentTypeStep(fontSize, variant),
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  });
  return {
    selectionColor: theme.colors.terminal.selectionBackground,
    markdownStyle: {
      paragraph,
      h1: heading(compact ? "title-sm" : "title-lg"),
      h2: heading(compact ? "body-lg" : "title"),
      h3: heading(compact ? "body" : "title-sm"),
      h4: heading("body-lg"),
      h5: heading("body"),
      h6: { ...heading("body"), color: theme.colors.foregroundMuted },
      list: {
        ...paragraph,
        bulletColor: theme.colors.foregroundMuted,
        markerColor: theme.colors.foregroundMuted,
        gapWidth: 7,
        itemSpacing: theme.spacing[1],
        marginLeft: 20,
      },
      blockquote: {
        ...paragraph,
        color: `${theme.colors.foreground}cc`,
        backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.surface2,
        borderWidth: 4,
        borderRadius: 0,
        padding: theme.spacing[3],
        gapWidth: theme.spacing[1],
        admonitions: {
          note: { color: theme.colors.accentBright, backgroundColor: theme.colors.surface2 },
          tip: { color: theme.colors.statusSuccess, backgroundColor: theme.colors.surface2 },
          important: { color: theme.colors.statusMerged, backgroundColor: theme.colors.surface2 },
          warning: { color: theme.colors.statusWarning, backgroundColor: theme.colors.surface2 },
          caution: { color: theme.colors.statusDanger, backgroundColor: theme.colors.surface2 },
        },
      },
      link: { color: theme.colors.accentBright, underline: false },
      linkVariants: {
        "^(?!https?://).+": {
          color: theme.colors.accentBright,
        },
      },
      code: {
        fontFamily: monoFamily(theme),
        fontSize: theme.fontSize.code,
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface2,
        borderColor: "transparent",
      },
      codeBlock: {
        ...paragraph,
        fontFamily: monoFamily(theme),
        fontSize: theme.fontSize.code,
        lineHeight: Math.round(theme.fontSize.code * 1.45),
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.borderCodeBlock,
        borderRadius: theme.radius.lg,
        padding: theme.spacing[3],
      },
      table: {
        ...paragraph,
        color: theme.colors.foreground,
        borderRadius: theme.borderRadius.md,
        cellPaddingHorizontal: theme.spacing[2],
        cellPaddingVertical: theme.spacing[2],
        borderColor: theme.colors.border,
        headerBackgroundColor: theme.colors.surface2,
        headerTextColor: theme.colors.foreground,
        rowEvenBackgroundColor: theme.colors.surface0,
        rowOddBackgroundColor: theme.colors.surface1,
      },
      taskList: {
        checkedTextColor: theme.colors.foregroundMuted,
        checkedColor: theme.colors.accent,
        checkmarkColor: theme.colors.accentForeground,
        borderColor: theme.colors.foregroundMuted,
      },
      inlineImage: { size: paragraph.lineHeight },
      image: { ...block, height: 320, resizeMode: "contain", borderRadius: theme.borderRadius.md },
      thematicBreak: { ...block, color: theme.colors.border, height: 1 },
    },
  };
}

/**
 * Web 代码块交给 HighlightedCodeBlock 自己画：外框（底色、描边、圆角）在容器上，
 * 内边距给代码正文，语言标签与复制按钮那一行在正文上方。块间距由渲染库照 codeBlock 的边距包在外面。
 */
export function createCodeBlockFrameStyle(theme: Theme) {
  return {
    inheritedStyles: {
      color: theme.colors.foreground,
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
    },
    textStyle: {
      backgroundColor: theme.colors.surface2,
      color: theme.colors.foreground,
      borderWidth: 1,
      borderColor: theme.colors.borderCodeBlock,
      borderRadius: theme.radius.lg,
      paddingHorizontal: theme.spacing[3],
      paddingTop: theme.spacing[1],
      paddingBottom: theme.spacing[3],
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
    },
  };
}
