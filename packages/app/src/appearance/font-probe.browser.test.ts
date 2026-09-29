import { describe, expect, it } from "vitest";
import { createFontProbe, type LocalFontSource } from "./font-probe";

// 本机一定没有的字体名：canvas 会落到基准字体上。
const MISSING_FAMILY = "Paseo Missing Font 7f3a";

function countingSource(result: () => Promise<readonly string[] | null>) {
  const counter = { calls: 0 };
  const source: LocalFontSource = () => {
    counter.calls += 1;
    return result();
  };
  return { source, counter };
}

describe("createFontProbe listFamilies", () => {
  it("dedupes, sorts, and drops macOS internal families", async () => {
    const { source } = countingSource(async () => [
      "Menlo",
      ".SF NS Mono",
      "Arial",
      "Menlo",
      "Fira Code",
      ".AppleSystemUIFont",
    ]);

    await expect(createFontProbe(source).listFamilies()).resolves.toEqual({
      status: "available",
      families: ["Arial", "Fira Code", "Menlo"],
    });
  });

  it("asks the source once per session", async () => {
    const { source, counter } = countingSource(async () => ["Menlo"]);
    const probe = createFontProbe(source);

    await probe.listFamilies();
    await probe.listFamilies();

    expect(counter.calls).toBe(1);
  });

  it("reports unavailable when the API is missing", async () => {
    const { source } = countingSource(async () => null);

    await expect(createFontProbe(source).listFamilies()).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("reports unavailable instead of throwing when access is denied, and asks again later", async () => {
    let denied = true;
    const { source, counter } = countingSource(async () => {
      if (denied) throw new DOMException("Permission denied", "NotAllowedError");
      return ["Menlo"];
    });
    const probe = createFontProbe(source);

    await expect(probe.listFamilies()).resolves.toEqual({ status: "unavailable" });
    denied = false;
    await expect(probe.listFamilies()).resolves.toEqual({
      status: "available",
      families: ["Menlo"],
    });
    expect(counter.calls).toBe(2);
  });
});

// generic 关键字在任何 Chromium 上都有确定的字体：monospace 等宽，serif 不等宽。
describe("createFontProbe canvas checks", () => {
  const probe = createFontProbe(async () => null);

  it("detects whether a family is installed", () => {
    expect(probe.isInstalled("monospace")).toBe(true);
    expect(probe.isInstalled("serif")).toBe(true);
    expect(probe.isInstalled(MISSING_FAMILY)).toBe(false);
  });

  it("detects whether a family is monospace", () => {
    expect(probe.isMonospace("monospace")).toBe(true);
    expect(probe.isMonospace("serif")).toBe(false);
    expect(probe.isMonospace("sans-serif")).toBe(false);
  });

  // Chromium 不支持 ui-monospace：canvas 接受这个字体串，但画出来的是回退字体，测不出真实结果。
  it("does not flag a generic keyword the browser cannot render", () => {
    expect(probe.isInstalled("ui-monospace")).toBe(true);
    expect(probe.isMonospace("ui-monospace")).toBe(true);
    expect(probe.isMonospace(MISSING_FAMILY)).toBe(true);
  });
});
