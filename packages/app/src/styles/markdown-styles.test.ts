import { describe, expect, it } from "vitest";
import { createCompactMarkdownStyles, createMarkdownStyles } from "./markdown-styles";
import { darkTheme } from "./theme";

describe("createMarkdownStyles", () => {
  it("sets prose on the content size with the ramp's prose line height, toned to 86%", () => {
    const styles = createMarkdownStyles(darkTheme);
    // darkTheme 的正文字号是 15；prose 一档在 14px 基础下为 14 / 22。
    expect(darkTheme.fontSize.content).toBe(15);

    expect(styles.body).toMatchObject({
      color: darkTheme.colors.foregroundProse,
      fontSize: 15,
      lineHeight: 24,
    });
    expect(styles.bullet_list_icon).toMatchObject({ fontSize: 15, lineHeight: 24 });
    expect(styles.ordered_list_icon).toMatchObject({ fontSize: 15, lineHeight: 24 });
  });

  it("maps headings onto the Text ramp at the content size, full-strength and unruled", () => {
    const styles = createMarkdownStyles(darkTheme);

    expect(styles.heading1).toMatchObject({ fontSize: 21, lineHeight: 30 });
    expect(styles.heading2).toMatchObject({ fontSize: 19, lineHeight: 30 });
    expect(styles.heading3).toMatchObject({ fontSize: 17, lineHeight: 26 });
    expect(styles.heading4).toMatchObject({ fontSize: 16, lineHeight: 24 });
    expect(styles.heading5).toMatchObject({ fontSize: 15, lineHeight: 21 });
    expect(styles.heading6).toMatchObject({
      fontSize: 15,
      lineHeight: 21,
      color: darkTheme.colors.foregroundMuted,
    });
    expect(styles.heading6).not.toHaveProperty("borderBottomWidth");
    expect(styles.heading6).not.toHaveProperty("textTransform");
    for (const heading of [
      styles.heading1,
      styles.heading2,
      styles.heading3,
      styles.heading4,
      styles.heading5,
    ]) {
      expect(heading).toMatchObject({
        color: darkTheme.colors.foreground,
        fontWeight: darkTheme.fontWeight.semibold,
      });
      expect(heading).not.toHaveProperty("borderBottomWidth");
    }
  });

  it("steps compact headings down the ramp", () => {
    const styles = createCompactMarkdownStyles(darkTheme);

    expect(styles.heading1).toMatchObject({ fontSize: 17, lineHeight: 26 });
    expect(styles.heading2).toMatchObject({ fontSize: 16, lineHeight: 24 });
    expect(styles.heading3).toMatchObject({ fontSize: 15, lineHeight: 21 });
  });

  it("applies shrink-and-wrap constraints to long markdown text and links", () => {
    const styles = createMarkdownStyles(darkTheme);

    expect(styles.body).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      width: "100%",
    });

    expect(styles.paragraph).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      width: "100%",
      flexWrap: "wrap",
    });

    expect(styles.text).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere",
    });

    expect(styles.link).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere",
    });

    expect(styles.blocklink).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere",
    });
  });

  it("keeps assistant markdown text selectable on web", () => {
    const styles = createMarkdownStyles(darkTheme);

    expect(styles.body).toMatchObject({
      userSelect: "text",
    });
    expect(styles.text).toMatchObject({
      userSelect: "text",
    });
    expect(styles.heading1).toMatchObject({
      userSelect: "text",
    });
    expect(styles.link).toMatchObject({
      userSelect: "text",
    });
    expect(styles.code_inline).toMatchObject({
      userSelect: "text",
    });
    expect(styles.code_block).toMatchObject({
      userSelect: "text",
    });
    expect(styles.fence).toMatchObject({
      userSelect: "text",
    });
    expect(styles.bullet_list_icon).toMatchObject({
      userSelect: "text",
    });
    expect(styles.ordered_list_icon).toMatchObject({
      userSelect: "text",
    });
  });

  it("uses the mono font-size token directly for inline and block code", () => {
    const styles = createMarkdownStyles(darkTheme);
    const compactStyles = createCompactMarkdownStyles(darkTheme);

    expect(styles.code_inline).toMatchObject({
      fontFamily: darkTheme.fontFamily.mono,
      fontSize: darkTheme.fontSize.code,
    });
    expect(styles.code_inline).not.toHaveProperty("lineHeight");
    expect(styles.code_block).toMatchObject({
      fontFamily: darkTheme.fontFamily.mono,
      fontSize: darkTheme.fontSize.code,
    });
    expect(styles.fence).toMatchObject({
      fontFamily: darkTheme.fontFamily.mono,
      fontSize: darkTheme.fontSize.code,
    });
    expect(compactStyles.code_inline).toMatchObject({
      fontFamily: darkTheme.fontFamily.mono,
      fontSize: darkTheme.fontSize.code,
    });
    expect(compactStyles.code_inline).not.toHaveProperty("lineHeight");
  });

  it("scales prose and headings with the content size setting", () => {
    const largeContentTheme = {
      ...darkTheme,
      fontSize: { ...darkTheme.fontSize, content: 21 },
    };
    const styles = createMarkdownStyles(largeContentTheme);

    expect(styles.body).toMatchObject({ fontSize: 21, lineHeight: 33 });
    expect(styles.heading1).toMatchObject({ fontSize: 30, lineHeight: 42 });
    expect(styles.heading3).toMatchObject({ fontSize: 24, lineHeight: 36 });
  });

  it("frames code blocks on surface2 with the code-block border and large corners", () => {
    const styles = createMarkdownStyles(darkTheme);
    const frame = {
      backgroundColor: darkTheme.colors.surface2,
      borderWidth: 1,
      borderColor: darkTheme.colors.borderCodeBlock,
      borderRadius: darkTheme.radius.lg,
    };

    expect(styles.fence).toMatchObject(frame);
    expect(styles.code_block).toMatchObject(frame);
    expect(styles.code_inline).toMatchObject({
      backgroundColor: darkTheme.colors.surface2,
      borderRadius: darkTheme.radius.sm,
      borderWidth: 0,
    });
  });

  it("keeps blockquotes quiet with a square left edge", () => {
    const styles = createMarkdownStyles(darkTheme);

    expect(styles.blockquote).toMatchObject({
      backgroundColor: darkTheme.colors.surface1,
      color: `${darkTheme.colors.foreground}cc`,
      borderLeftColor: darkTheme.colors.surface2,
      paddingTop: darkTheme.spacing[3],
      paddingBottom: 0,
      borderTopLeftRadius: 0,
      borderBottomLeftRadius: 0,
    });
    expect(styles.paragraph.marginBottom).toBe(darkTheme.spacing[3]);
    expect(styles.text).not.toHaveProperty("color");
  });
});
