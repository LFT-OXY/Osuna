import { afterEach, describe, expect, it } from "vitest";
import { installWebSurfaceGrain } from "@/styles/install-web-surface-grain";

let uninstall: (() => void) | null = null;

afterEach(() => {
  uninstall?.();
  uninstall = null;
});

describe("web surface grain", () => {
  it("lays a click-through noise tile over the whole window", () => {
    uninstall = installWebSurfaceGrain();
    const grain = getComputedStyle(document.body, "::after");

    expect(grain.position).toBe("fixed");
    expect(grain.pointerEvents).toBe("none");
    expect(grain.backgroundImage).toContain("feTurbulence");
    expect(grain.backgroundSize).toBe("256px 256px");
  });

  it("removes the grain when uninstalled", () => {
    installWebSurfaceGrain()();

    expect(getComputedStyle(document.body, "::after").backgroundImage).toBe("none");
  });
});
