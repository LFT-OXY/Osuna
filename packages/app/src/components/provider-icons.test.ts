import { Bot } from "lucide-react-native";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SvgXml } from "react-native-svg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROVIDER_COLOR_ICON_SVGS } from "@/assets/provider-color-icons";
import { replaceProviderSnapshotIcons } from "./provider-icon-name";
import {
  getProviderBrandColor,
  getProviderIcon,
  resolveProviderGlyph,
  type ProviderIconComponent,
} from "./provider-icons";

const svgXmlRenders = vi.hoisted(() => [] as { xml: string; color: string }[]);

vi.mock("react-native-svg", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native-svg")>();
  return {
    ...actual,
    SvgXml: (props: { xml: string; color: string }) => {
      svgXmlRenders.push(props);
      return null;
    },
  };
});

afterEach(() => {
  svgXmlRenders.length = 0;
  replaceProviderSnapshotIcons("server-1", []);
});

// 彩色版组件用了 hook，要经过 React 渲染，不能直接当函数调用。
function renderColorIcons(Icon: ProviderIconComponent, count: number) {
  renderToStaticMarkup(
    createElement(
      Fragment,
      null,
      Array.from({ length: count }, (_, index) =>
        createElement(Icon, { key: index, size: 18, color: "#123456" }),
      ),
    ),
  );
  return svgXmlRenders.splice(0);
}

function renderIcon(Component: ProviderIconComponent) {
  if (typeof Component !== "function") throw new Error("Expected a function component");
  return (Component as (props: { size: number; color: string }) => unknown)({
    size: 18,
    color: "#123456",
  });
}

describe("getProviderIcon", () => {
  it("renders registered snapshot SVG metadata with the requested size and color", () => {
    const svg = '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" /></svg>';
    replaceProviderSnapshotIcons("server-1", [{ provider: "rendered-provider", iconSvg: svg }]);

    const rendered = renderIcon(getProviderIcon("rendered-provider", "server-1"));

    expect(rendered).toMatchObject({
      type: SvgXml,
      props: { xml: svg, width: 18, height: 18, color: "#123456" },
    });
  });

  it("uses the normal Bot fallback without snapshot SVG metadata", () => {
    replaceProviderSnapshotIcons("server-1", [{ provider: "plain-provider" }]);

    expect(getProviderIcon("plain-provider", "server-1")).toBe(Bot);
  });
});

function withoutIds(svg: string): string {
  return svg.replace(/\sid="[^"]*"/g, "").replace(/url\(#[^)]*\)/g, "url()");
}

describe("resolveProviderGlyph", () => {
  const COLOR_PROVIDERS = ["codex", "kiro", "minimax", "kimi", "gemini", "omp"] as const;

  it.each(COLOR_PROVIDERS)("renders the color SVG for %s under brand tone", (provider) => {
    const glyph = resolveProviderGlyph({ provider, serverId: null, tone: "brand" });

    expect(glyph.Icon).not.toBe(getProviderIcon(provider));
    // 彩色版自带品牌色，不再叠加品牌色。
    expect(glyph.brandColor).toBeNull();
    const [rendered] = renderColorIcons(glyph.Icon, 1);
    expect(rendered?.xml).toContain("<svg");
    expect(withoutIds(rendered?.xml ?? "")).toBe(withoutIds(PROVIDER_COLOR_ICON_SVGS[provider]));
  });

  it("keeps color SVG brand fills fixed, so the passed color cannot recolor them", () => {
    for (const provider of COLOR_PROVIDERS.filter((id) => id !== "kimi")) {
      expect(PROVIDER_COLOR_ICON_SVGS[provider]).not.toContain("currentColor");
    }
    // Kimi 的 K 跟随前景色，品牌蓝点写死。
    expect(PROVIDER_COLOR_ICON_SVGS.kimi).toContain('fill="#1783FF"');
    expect(PROVIDER_COLOR_ICON_SVGS.kimi).toContain('fill="currentColor"');
  });

  it("drops the white rounded square from the Codex color SVG", () => {
    expect(PROVIDER_COLOR_ICON_SVGS.codex).not.toMatch(/fill="#fff(fff)?"/i);
  });

  it("gives every rendered color icon its own gradient ids", () => {
    const { Icon } = resolveProviderGlyph({ provider: "codex", serverId: null, tone: "brand" });

    const [first, second] = renderColorIcons(Icon, 2);
    const idOf = (xml: string | undefined) => xml?.match(/<linearGradient[^>]* id="([^"]+)"/)?.[1];

    expect(idOf(first?.xml)).toBeTruthy();
    expect(idOf(first?.xml)).not.toBe(idOf(second?.xml));
    expect(first?.xml).toContain(`url(#${idOf(first?.xml)})`);
    expect(second?.xml).toContain(`url(#${idOf(second?.xml)})`);
  });

  it.each(["muted", "foreground"] as const)(
    "keeps the monochrome icon for color providers under %s tone",
    (tone) => {
      expect(resolveProviderGlyph({ provider: "codex", serverId: null, tone })).toEqual({
        Icon: getProviderIcon("codex"),
        brandColor: null,
      });
    },
  );

  it("keeps Claude's monochrome sparkle in its brand color under brand tone", () => {
    expect(resolveProviderGlyph({ provider: "claude", serverId: null, tone: "brand" })).toEqual({
      Icon: getProviderIcon("claude"),
      brandColor: "#d97757",
    });
  });

  it.each(["copilot", "opencode", "pi", "cursor"])(
    "falls back to the monochrome icon for %s under brand tone",
    (provider) => {
      expect(resolveProviderGlyph({ provider, serverId: null, tone: "brand" })).toEqual({
        Icon: getProviderIcon(provider),
        brandColor: null,
      });
    },
  );

  it("keeps snapshot SVG metadata ahead of the color SVG", () => {
    const svg = '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" /></svg>';
    replaceProviderSnapshotIcons("server-1", [{ provider: "gemini", iconSvg: svg }]);

    const glyph = resolveProviderGlyph({ provider: "gemini", serverId: "server-1", tone: "brand" });

    expect(glyph.Icon).toBe(getProviderIcon("gemini", "server-1"));
    expect(renderIcon(glyph.Icon)).toMatchObject({ props: { xml: svg, color: "#123456" } });
  });
});

describe("getProviderBrandColor", () => {
  it("returns the brand color for each branded provider", () => {
    expect(getProviderBrandColor("claude")).toBe("#d97757");
    expect(getProviderBrandColor("codex")).toBe("#3941ff");
    expect(getProviderBrandColor("kiro")).toBe("#9046ff");
    expect(getProviderBrandColor("minimax")).toBe("#e73562");
    expect(getProviderBrandColor("kimi")).toBe("#1783ff");
    expect(getProviderBrandColor("omp")).toBe("#9b4dff");
    expect(getProviderBrandColor("gemini")).toBe("#207cfe");
  });

  it("leaves providers without a brand color on null", () => {
    expect(getProviderBrandColor("copilot")).toBeNull();
    expect(getProviderBrandColor("custom-provider")).toBeNull();
  });
});
