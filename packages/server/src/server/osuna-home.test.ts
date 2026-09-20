import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { resolvePaseoHome } from "./osuna-home.js";
describe("resolvePaseoHome", () => {
  test("resolves OSUNA_HOME without creating it", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "osuna-home-parent-"));
    const paseoHome = path.join(parent, "home");
    try {
      expect(resolvePaseoHome({ OSUNA_HOME: paseoHome })).toBe(paseoHome);
      expect(existsSync(paseoHome)).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
