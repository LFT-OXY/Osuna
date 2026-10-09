import { describe, expect, test } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import type { ProviderSnapshotEntry } from "@osuna/protocol/agent-types";
import {
  type FetchLatestVersionInput,
  isNewerVersion,
  ProviderVersionCheckService,
} from "./provider-version-check.js";

describe("isNewerVersion", () => {
  test.each([
    ["2.1.280", "2.1.285"],
    ["2.1.285", "2.2.0"],
    ["2.9.9", "3.0.0"],
    // 按数字比，不按字符串比。
    ["0.9.0", "0.10.0"],
    ["1.0.89", "1.0.100"],
    ["v18.1.18", "18.4.4"],
  ])("%s → %s is an update", (installed, latest) => {
    expect(isNewerVersion({ installed, latest })).toBe(true);
  });

  test.each([
    ["2.1.285", "2.1.285"],
    ["2.1.285", "2.1.280"],
    ["3.0.0", "2.99.99"],
    // latest 是同一版本的预发布，不算更新。
    ["1.2.3", "1.2.3-beta.1"],
    ["1.2.3", "1.2.3+build.5"],
  ])("%s → %s is not an update", (installed, latest) => {
    expect(isNewerVersion({ installed, latest })).toBe(false);
  });

  test.each([
    ["dev", "1.0.0"],
    ["1.0.0", ""],
    ["1.0", "1.1"],
    ["1.0.0", "latest"],
  ])("unparseable %s → %s is not an update", (installed, latest) => {
    expect(isNewerVersion({ installed, latest })).toBe(false);
  });
});

describe("ProviderVersionCheckService", () => {
  const claude: ProviderSnapshotEntry = {
    provider: "claude",
    status: "ready",
    enabled: true,
    source: "builtin",
    label: "Claude",
    version: "2.1.280",
  };

  // 桩 registry：每次查询排进 lookups，由测试决定何时、用哪个版本回答。
  function createRegistry() {
    const lookups: Array<{ npmPackage: string; answer: (version: string) => void }> = [];
    return {
      lookups,
      fetchLatestVersion: ({ npmPackage }: FetchLatestVersionInput) =>
        new Promise<string>((resolve) => lookups.push({ npmPackage, answer: resolve })),
    };
  }

  function createService(registry: ReturnType<typeof createRegistry>, clock: { now: number }) {
    return new ProviderVersionCheckService({
      listProviders: async () => [claude],
      fetchLatestVersion: registry.fetchLatestVersion,
      logger: createTestLogger(),
      now: () => clock.now,
    });
  }

  async function answerNext(registry: ReturnType<typeof createRegistry>, version: string) {
    await expect.poll(() => registry.lookups.length).toBeGreaterThan(0);
    registry.lookups.shift()!.answer(version);
  }

  test("asks npm again once the cached answer is an hour old", async () => {
    const registry = createRegistry();
    const clock = { now: 0 };
    const service = createService(registry, clock);
    const first = service.check();
    await answerNext(registry, "2.1.285");
    await first;

    clock.now = 59 * 60 * 1000;
    expect((await service.check())[0]?.latestVersion).toBe("2.1.285");

    clock.now = 60 * 60 * 1000;
    const expired = service.check();
    await answerNext(registry, "2.1.290");
    expect((await expired)[0]?.latestVersion).toBe("2.1.290");
  });

  test("concurrent checks for one provider share one lookup", async () => {
    const registry = createRegistry();
    const service = createService(registry, { now: 0 });

    const page = service.check();
    const refresh = service.check({ providers: ["claude"], force: true });
    await answerNext(registry, "2.1.285");

    expect((await page)[0]?.latestVersion).toBe("2.1.285");
    // 第二次查询若另发了请求，它会留在这里没人回答。
    expect(registry.lookups).toEqual([]);
    expect((await refresh)[0]?.latestVersion).toBe("2.1.285");
  });
});
