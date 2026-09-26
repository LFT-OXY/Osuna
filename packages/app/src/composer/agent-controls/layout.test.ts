import { describe, expect, it } from "vitest";
import {
  COMPOSER_TOOLBAR_GEOMETRY,
  resolveComposerControlDensity,
  resolveComposerControlPresentation,
  resolveComposerSeparators,
  resolveComposerToolbarGlyphSize,
} from "./layout";

describe("composer control layout", () => {
  it("removes labels in priority order as the toolbar narrows", () => {
    expect(resolveComposerControlPresentation("full")).toEqual({
      showCarets: true,
      showThinkingLabel: true,
      showModeLabel: true,
      showSeparators: true,
      aggregateFeatures: false,
    });
    expect(resolveComposerControlPresentation("condensed")).toEqual({
      showCarets: false,
      showThinkingLabel: false,
      showModeLabel: true,
      showSeparators: false,
      aggregateFeatures: true,
    });
    expect(resolveComposerControlPresentation("tight")).toEqual({
      showCarets: false,
      showThinkingLabel: false,
      showModeLabel: false,
      showSeparators: false,
      aggregateFeatures: true,
    });
  });

  it("uses local available width and hysteresis to avoid density churn", () => {
    const controls = {
      hasModel: true,
      hasThinking: true,
      hasMode: true,
      features: [{ type: "toggle" as const }],
      fontScale: 1,
    };

    expect(
      resolveComposerControlDensity({
        availableWidth: 420,
        currentDensity: "full",
        controls,
      }),
    ).toBe("full");
    expect(
      resolveComposerControlDensity({
        availableWidth: 380,
        currentDensity: "full",
        controls,
      }),
    ).toBe("condensed");
    expect(
      resolveComposerControlDensity({
        availableWidth: 290,
        currentDensity: "condensed",
        controls,
      }),
    ).toBe("condensed");
    expect(
      resolveComposerControlDensity({
        availableWidth: 280,
        currentDensity: "condensed",
        controls,
      }),
    ).toBe("tight");
    expect(
      resolveComposerControlDensity({
        availableWidth: 300,
        currentDensity: "tight",
        controls,
      }),
    ).toBe("tight");
    expect(
      resolveComposerControlDensity({
        availableWidth: 312,
        currentDensity: "tight",
        controls,
      }),
    ).toBe("condensed");
  });

  it("budgets extra features and larger text before restoring full labels", () => {
    const base = {
      availableWidth: 450,
      currentDensity: "condensed" as const,
    };

    expect(
      resolveComposerControlDensity({
        ...base,
        controls: {
          hasModel: true,
          hasThinking: true,
          hasMode: true,
          features: [{ type: "toggle" }],
          fontScale: 1,
        },
      }),
    ).toBe("full");
    expect(
      resolveComposerControlDensity({
        ...base,
        controls: {
          hasModel: true,
          hasThinking: true,
          hasMode: true,
          features: [{ type: "toggle" }, { type: "select", label: "Tools" }],
          fontScale: 1,
        },
      }),
    ).toBe("condensed");
    expect(
      resolveComposerControlDensity({
        ...base,
        controls: {
          hasModel: true,
          hasThinking: true,
          hasMode: true,
          features: [{ type: "toggle" }],
          fontScale: 1.25,
        },
      }),
    ).toBe("condensed");
  });

  it("condenses before a labeled feature would overflow", () => {
    const base = {
      availableWidth: 430,
      currentDensity: "full" as const,
      controls: {
        hasModel: true,
        hasThinking: true,
        hasMode: true,
        fontScale: 1,
      },
    };

    expect(
      resolveComposerControlDensity({
        ...base,
        controls: { ...base.controls, features: [{ type: "toggle" }] },
      }),
    ).toBe("full");
    expect(
      resolveComposerControlDensity({
        ...base,
        controls: {
          ...base.controls,
          features: [{ type: "select", label: "A much longer localized feature label" }],
        },
      }),
    ).toBe("condensed");
  });

  it("reserves room for the separators between model, thinking, and mode", () => {
    const controls = {
      hasModel: true,
      hasThinking: true,
      hasMode: true,
      features: [],
      fontScale: 1,
    };

    // 三个控件本身加间距是 380，两条分隔线各占 1 + 2 * 2 + 4。
    expect(
      resolveComposerControlDensity({ availableWidth: 386, currentDensity: "full", controls }),
    ).toBe("full");
    expect(
      resolveComposerControlDensity({ availableWidth: 385, currentDensity: "full", controls }),
    ).toBe("condensed");
    expect(
      resolveComposerControlDensity({
        availableWidth: 385,
        currentDensity: "full",
        controls: { ...controls, hasThinking: false },
      }),
    ).toBe("full");
  });

  it("draws a separator only between neighbouring model, thinking, and mode controls", () => {
    expect(
      resolveComposerSeparators({ showSeparators: true, hasModel: true, hasThinking: true }),
    ).toEqual({ beforeThinking: true, beforeMode: true });
    expect(
      resolveComposerSeparators({ showSeparators: true, hasModel: false, hasThinking: true }),
    ).toEqual({ beforeThinking: false, beforeMode: true });
    expect(
      resolveComposerSeparators({ showSeparators: true, hasModel: false, hasThinking: false }),
    ).toEqual({ beforeThinking: false, beforeMode: false });
    expect(
      resolveComposerSeparators({ showSeparators: false, hasModel: true, hasThinking: true }),
    ).toEqual({ beforeThinking: false, beforeMode: false });
  });

  it("gives every toolbar control one shell and one platform glyph envelope", () => {
    expect(COMPOSER_TOOLBAR_GEOMETRY).toEqual({
      controlSize: 28,
      controlGap: 4,
      iconLabelGap: 4,
      labelPadding: 8,
      caretSize: 14,
      separatorWidth: 1,
      separatorInset: 2,
    });
    expect(resolveComposerToolbarGlyphSize("web")).toBe(16);
    expect(resolveComposerToolbarGlyphSize("native")).toBe(20);
  });
});
