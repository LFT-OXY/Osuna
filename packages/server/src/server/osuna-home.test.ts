import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { resolveOsunaHome } from "./osuna-home.js";
describe("resolveOsunaHome", () => {
  test("resolves OSUNA_HOME without creating it", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "osuna-home-parent-"));
    const osunaHome = path.join(parent, "home");
    try {
      expect(resolveOsunaHome({ OSUNA_HOME: osunaHome })).toBe(osunaHome);
      expect(existsSync(osunaHome)).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
