import { describe, expect, it } from "vitest";
import { resolveActiveTheme } from "./resolve-theme";

describe("resolveActiveTheme", () => {
  it("follows the system into the paired dark theme", () => {
    expect(
      resolveActiveTheme({
        preference: "auto",
        autoDarkTheme: "dracula",
        autoLightTheme: "githubLight",
        systemColorScheme: "dark",
        contributedColorScheme: null,
      }),
    ).toBe("darkDracula");
  });

  it("follows the system into the paired light theme", () => {
    expect(
      resolveActiveTheme({
        preference: "auto",
        autoDarkTheme: "dracula",
        autoLightTheme: "githubLight",
        systemColorScheme: "light",
        contributedColorScheme: null,
      }),
    ).toBe("lightGithub");
  });

  it("keeps today's behavior with the default pairing", () => {
    const base = {
      preference: "auto",
      autoDarkTheme: "dark",
      autoLightTheme: "light",
      contributedColorScheme: null,
    } as const;
    expect(resolveActiveTheme({ ...base, systemColorScheme: "dark" })).toBe("dark");
    expect(resolveActiveTheme({ ...base, systemColorScheme: "light" })).toBe("light");
  });

  it("locks a directly chosen variant regardless of the system scheme", () => {
    const base = {
      preference: "solarizedLight",
      autoDarkTheme: "nord",
      autoLightTheme: "oneLight",
      contributedColorScheme: null,
    } as const;
    expect(resolveActiveTheme({ ...base, systemColorScheme: "dark" })).toBe("lightSolarized");
    expect(resolveActiveTheme({ ...base, systemColorScheme: "light" })).toBe("lightSolarized");
  });

  it("routes an installed plugin theme to its plugin slot", () => {
    expect(
      resolveActiveTheme({
        preference: "plugin",
        autoDarkTheme: "nord",
        autoLightTheme: "oneLight",
        systemColorScheme: "light",
        contributedColorScheme: "dark",
      }),
    ).toBe("pluginDark");
  });

  it("falls back to the system pairing when the selected plugin theme is not installed", () => {
    expect(
      resolveActiveTheme({
        preference: "plugin",
        autoDarkTheme: "nord",
        autoLightTheme: "oneLight",
        systemColorScheme: "dark",
        contributedColorScheme: null,
      }),
    ).toBe("darkNord");
  });
});
