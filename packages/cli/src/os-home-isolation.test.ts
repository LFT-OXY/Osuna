import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it("runs CLI unit tests against a throwaway OS home, never the developer's", () => {
  expect(path.basename(os.homedir())).toMatch(/^osuna-vitest-os-home-/);
});
