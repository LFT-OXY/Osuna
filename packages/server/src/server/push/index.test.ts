import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type pino from "pino";
import { afterEach, describe, expect, test } from "vitest";

import { createPushNotifications } from "./index.js";

function createLogger(): pino.Logger {
  const logger = {
    child: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger as unknown as pino.Logger;
}

describe("push notifications", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("an offline device stops receiving notifications after 48 hours", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "osuna-push-notifications-"));
    homes.push(home);
    const filePath = path.join(home, "push-subscriptions.json");
    let now = Date.parse("2026-08-10T00:00:00.000Z");
    const deliveries: string[][] = [];
    const pushNotifications = createPushNotifications({
      logger: createLogger(),
      home,
      now: () => now,
      deliver: async (tokens) => deliveries.push(tokens),
    });

    pushNotifications.renew("ExponentPushToken[offline-device]");
    now += 48 * 60 * 60 * 1000;
    await pushNotifications.send({ title: "Agent finished", body: "Done" });

    expect(deliveries).toEqual([]);
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({ subscriptions: [] });
  });

  test("online revocation stops notifications immediately", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "osuna-push-notifications-"));
    homes.push(home);
    const deliveries: string[][] = [];
    const pushNotifications = createPushNotifications({
      logger: createLogger(),
      home,
      now: () => Date.parse("2026-08-10T00:00:00.000Z"),
      deliver: async (tokens) => deliveries.push(tokens),
    });

    pushNotifications.renew("ExponentPushToken[online-device]");
    pushNotifications.revoke("ExponentPushToken[online-device]");
    await pushNotifications.send({ title: "Agent finished", body: "Done" });

    expect(deliveries).toEqual([]);
  });

  test("tokens left behind by 0.14.x are never sent to and their file is left as it was", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "osuna-push-notifications-"));
    homes.push(home);
    const now = Date.parse("2026-10-09T00:00:00.000Z");
    // 0.14.x 写下的文件：上游手机 App 注册的令牌，租约还没到期。
    const leftBehind = `${JSON.stringify(
      {
        subscriptions: [
          { token: "ExponentPushToken[upstream-app]", expiresAt: "2026-10-10T00:00:00.000Z" },
        ],
        tokens: ["ExponentPushToken[older-format]"],
      },
      null,
      2,
    )}\n`;
    writeFileSync(path.join(home, "push-tokens.json"), leftBehind);
    const deliveries: string[][] = [];

    const pushNotifications = createPushNotifications({
      logger: createLogger(),
      home,
      now: () => now,
      deliver: async (tokens) => deliveries.push(tokens),
    });
    await pushNotifications.send({ title: "Agent finished", body: "Done" });

    expect(deliveries).toEqual([]);
    expect(readFileSync(path.join(home, "push-tokens.json"), "utf8")).toBe(leftBehind);
    expect(existsSync(path.join(home, "push-subscriptions.json"))).toBe(false);
  });
});
