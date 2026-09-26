import React, { act } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { dialogScrimFill, floatingSurfaceFill } from "@/styles/floating-surface";
import { GLASS_SURFACES_ENABLED } from "@/styles/glass-support";

const styles = StyleSheet.create((theme) => ({
  glassSurface: floatingSurfaceFill(theme, { glass: true }),
  opaqueSurface: floatingSurfaceFill(theme, { glass: false }),
  glassScrim: dialogScrimFill(theme, { glass: true }),
  opaqueScrim: dialogScrimFill(theme, { glass: false }),
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
