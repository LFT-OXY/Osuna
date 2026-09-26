import React, { act } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  composerSurfaceStyle,
  dialogScrimFill,
  floatingSurfaceFill,
} from "@/styles/floating-surface";
import { GLASS_SURFACES_ENABLED } from "@/styles/glass-support";

const styles = StyleSheet.create((theme) => ({
  glassSurface: floatingSurfaceFill(theme, { glass: true }),
  opaqueSurface: floatingSurfaceFill(theme, { glass: false }),
  glassScrim: dialogScrimFill(theme, { glass: true }),
  opaqueScrim: dialogScrimFill(theme, { glass: false }),
  glassComposer: composerSurfaceStyle(theme, { glass: true }),
  opaqueComposer: composerSurfaceStyle(theme, { glass: false }),
}));

interface MountedView {
  root: Root;
  container: HTMLDivElement;
}

const mounted: MountedView[] = [];

function mountStyled(style: object): CSSStyleDeclaration {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<View testID="styled" style={style} />));
  mounted.push({ root, container });
  const element = container.querySelector('[data-testid="styled"]');
  if (!(element instanceof HTMLElement)) {
    throw new Error("styled view did not render");
  }
  return getComputedStyle(element);
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

describe("floating surface fill", () => {
  it("turns glass on for the web build", () => {
    expect(GLASS_SURFACES_ENABLED).toBe(true);
  });

  it("paints web menus and dialogs as translucent card with a blurred, saturated backdrop", () => {
    const style = mountStyled(styles.glassSurface);

    expect(style.backgroundColor).toBe("rgba(255, 255, 255, 0.8)");
    expect(style.backdropFilter).toBe("blur(12px) saturate(1.14)");
  });

  it("falls back to the opaque card color with no blur on native", () => {
    const style = mountStyled(styles.opaqueSurface);

    expect(style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(style.backdropFilter).toBe("none");
  });

  it("blurs what sits behind a web dialog's scrim", () => {
    const style = mountStyled(styles.glassScrim);

    expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0.18)");
    expect(style.backdropFilter).toBe("blur(4px)");
  });

  it("keeps the native dialog scrim a plain tint", () => {
    const style = mountStyled(styles.opaqueScrim);

    expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0.18)");
    expect(style.backdropFilter).toBe("none");
  });
});

describe("composer surface", () => {
  it("is a glass card with 22px corners, a 9% foreground outline and the composer shadow on web", () => {
    const style = mountStyled(styles.glassComposer);

    expect(style.backgroundColor).toBe("rgba(255, 255, 255, 0.8)");
    expect(style.backdropFilter).toBe("blur(12px) saturate(1.14)");
    expect(style.borderTopLeftRadius).toBe("22px");
    expect(style.borderTopWidth).toBe("1px");
    expect(style.borderTopColor).toBe("rgba(39, 39, 42, 0.09)");
    expect(style.boxShadow).toBe(
      "rgba(0, 0, 0, 0.4) 0px 12px 28px -18px, rgba(0, 0, 0, 0) 0px 1px 0px 0px inset",
    );
  });

  it("keeps the same shape over an opaque card with no blur on native", () => {
    const style = mountStyled(styles.opaqueComposer);

    expect(style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(style.backdropFilter).toBe("none");
    expect(style.borderTopLeftRadius).toBe("22px");
    expect(style.borderTopColor).toBe("rgba(39, 39, 42, 0.09)");
  });
});
