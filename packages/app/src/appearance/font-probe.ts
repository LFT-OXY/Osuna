import { isWeb } from "@/constants/platform";
import { formatFontFamily, isGenericFontFamily } from "./font-family-name";

// 本机字体探测：列出已安装的字体族，并用 canvas 测宽判断某个字体是否已安装、是否等宽。
// 只在桌面端和 Web 端的字体选择器里用。字体来源可以注入，测试用假来源替换 Local Font Access API。

/** 返回本机字体族名（可重复）；API 不存在时返回 null，被拒时抛错。 */
export type LocalFontSource = () => Promise<readonly string[] | null>;

export type LocalFontFamilies =
  | { status: "available"; families: readonly string[] }
  | { status: "unavailable" };

export interface FontProbe {
  listFamilies(): Promise<LocalFontFamilies>;
  isInstalled(family: string): boolean;
  isMonospace(family: string): boolean;
}

const UNAVAILABLE: LocalFontFamilies = { status: "unavailable" };

const MEASURE_FONT_SIZE = 72;
const BASELINE_FAMILIES = ["monospace", "serif", "sans-serif"] as const;
const INSTALLED_SAMPLE = "mmmmmmmmmmlli10OoWw@#";
const MONOSPACE_GLYPHS = ["i", "l", "m", "W", "0", "."] as const;
// 等宽字体的各字形宽度完全一致；留一点余量吸收亚像素误差。
const MONOSPACE_TOLERANCE = 0.05;

interface WindowWithLocalFonts extends Window {
  queryLocalFonts?: () => Promise<readonly { family: string }[]>;
}

// 非安全上下文或不支持的浏览器上 queryLocalFonts 不存在；用户拒绝授权时它会 reject。
async function queryLocalFontFamilies(): Promise<readonly string[] | null> {
  if (!isWeb || typeof window === "undefined") return null;
  const query = (window as WindowWithLocalFonts).queryLocalFonts;
  if (typeof query !== "function") return null;
  const fonts = await query.call(window);
  return fonts.map((font) => font.family);
}

function normalizeFamilies(families: readonly string[]): string[] {
  const unique = new Set(
    families.map((family) => family.trim()).filter((family) => family && !family.startsWith(".")),
  );
  return [...unique].sort((a, b) => a.localeCompare(b));
}

function createMeasureContext(): CanvasRenderingContext2D | null {
  if (!isWeb || typeof document === "undefined") return null;
  return document.createElement("canvas").getContext("2d");
}

export function createFontProbe(source: LocalFontSource): FontProbe {
  let cachedFamilies: LocalFontFamilies | null = null;
  let context: CanvasRenderingContext2D | null | undefined;
  const installedCache = new Map<string, boolean>();
  const monospaceCache = new Map<string, boolean>();

  function getContext(): CanvasRenderingContext2D | null {
    if (context === undefined) context = createMeasureContext();
    return context;
  }

  function measure(ctx: CanvasRenderingContext2D, fontFamily: string, text: string): number {
    ctx.font = `${MEASURE_FONT_SIZE}px ${fontFamily}`;
    return ctx.measureText(text).width;
  }

  // 分别以三种 generic 字体作回退测同一段文字，任一宽度与回退本身不同，说明这款字体真的被用上了。
  // 不用 document.fonts.check()：它对没装的字体也返回 true。
  function rendersFamily(ctx: CanvasRenderingContext2D, family: string): boolean {
    const formatted = formatFontFamily(family);
    return BASELINE_FAMILIES.some(
      (baseline) =>
        measure(ctx, `${formatted}, ${baseline}`, INSTALLED_SAMPLE) !==
        measure(ctx, baseline, INSTALLED_SAMPLE),
    );
  }

  // generic 关键字总是可用；无法测量时不提示，视为已安装。
  function measureInstalled(family: string): boolean {
    if (isGenericFontFamily(family)) return true;
    const ctx = getContext();
    return ctx ? rendersFamily(ctx, family) : true;
  }

  // 字体没被用上（没装，或 Chromium 不支持的 ui-monospace 这类关键字）时测到的是回退字体，
  // 按"无法测量"视为等宽。回退用 serif：只含符号的字体（如 Symbols Nerd Font）缺拉丁字形时
  // 会落到比例字体上，不算等宽。
  function measureMonospace(family: string): boolean {
    const ctx = getContext();
    if (!ctx || !rendersFamily(ctx, family)) return true;
    const fontFamily = `${formatFontFamily(family)}, serif`;
    const widths = MONOSPACE_GLYPHS.map((glyph) => measure(ctx, fontFamily, glyph));
    const first = widths[0];
    if (!(first > 0)) return true;
    return widths.every((width) => Math.abs(width - first) <= MONOSPACE_TOLERANCE);
  }

  function cached(cache: Map<string, boolean>, family: string, compute: (f: string) => boolean) {
    const hit = cache.get(family);
    if (hit !== undefined) return hit;
    const result = compute(family);
    cache.set(family, result);
    return result;
  }

  return {
    // PRD 要求 API 不可用、被拒或抛错时一律返回"不可用"而不抛异常，所以这里不区分错误类型。
    // 只缓存成功的结果：被拒或临时失败后，下次展开还会再问一次。
    async listFamilies() {
      if (cachedFamilies) return cachedFamilies;
      try {
        const families = await source();
        if (families === null) return UNAVAILABLE;
        cachedFamilies = { status: "available", families: normalizeFamilies(families) };
        return cachedFamilies;
      } catch {
        return UNAVAILABLE;
      }
    },
    isInstalled: (family) => cached(installedCache, family, measureInstalled),
    isMonospace: (family) => cached(monospaceCache, family, measureMonospace),
  };
}

export const localFontProbe = createFontProbe(queryLocalFontFamilies);
