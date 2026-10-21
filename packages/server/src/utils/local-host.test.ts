import { describe, expect, it } from "vitest";
import { isLocalHost } from "./local-host.js";

describe("isLocalHost", () => {
  it("counts this computer and the local network, as Go's IsLoopback and IsPrivate do", () => {
    for (const host of [
      "localhost",
      "box.local",
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.9",
      "192.168.1.20",
      "[::1]",
      "[fd00::1]",
      "[::ffff:127.0.0.1]",
      "[::ffff:7f00:1]",
      "[::ffff:a00:1]",
      "[::ffff:192.168.1.20]",
    ]) {
      expect(isLocalHost(host), host).toBe(true);
    }
  });

  it("doesn't count public hosts", () => {
    for (const host of [
      "relay.example",
      "8.8.8.8",
      "172.32.0.1",
      "[2001:db8::1]",
      "[::ffff:8.8.8.8]",
    ]) {
      expect(isLocalHost(host), host).toBe(false);
    }
  });

  it("reads hosts the way URL writes them", () => {
    expect(isLocalHost(new URL("http://[::ffff:127.0.0.1]:8080/v1").hostname)).toBe(true);
    expect(isLocalHost(new URL("http://[::ffff:10.0.0.2]/v1").hostname)).toBe(true);
  });
});
