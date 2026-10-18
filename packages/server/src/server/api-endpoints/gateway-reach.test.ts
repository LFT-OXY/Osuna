import { describe, expect, it } from "vitest";
import { createGatewayReach, proxyBase } from "./gateway-reach.js";

const GATEWAY = "http://127.0.0.1:6767/api-endpoint-gateway";

describe("proxyBase", () => {
  it("takes an address on another machine as a way that may reach the gateway", () => {
    expect(proxyBase({ value: "https://ai.corp.example/osuna/", gateway: GATEWAY })).toBe(
      "https://ai.corp.example/osuna",
    );
  });

  it("takes a loopback address with a path of its own", () => {
    expect(proxyBase({ value: "http://127.0.0.1:8788/claude-code", gateway: GATEWAY })).toBe(
      "http://127.0.0.1:8788/claude-code",
    );
  });

  it("does not take the gateway's own path on another port, a bare loopback address, or one with credentials", () => {
    expect(
      proxyBase({ value: "http://127.0.0.1:6769/api-endpoint-gateway", gateway: GATEWAY }),
    ).toBeNull();
    expect(proxyBase({ value: "http://localhost:9000", gateway: GATEWAY })).toBeNull();
    expect(proxyBase({ value: "https://me:pw@corp.example/x", gateway: GATEWAY })).toBeNull();
    expect(proxyBase({ value: "not a url", gateway: GATEWAY })).toBeNull();
  });
});

describe("createGatewayReach", () => {
  it("keeps an answer for 20 seconds, then asks again", async () => {
    let clock = 0;
    const asked: string[] = [];
    const reaches = createGatewayReach({
      probe: async (base) => {
        asked.push(base);
        return true;
      },
      now: () => clock,
    });
    expect(await reaches("https://corp.example")).toBe(true);
    clock = 20_000;
    await reaches("https://corp.example");
    expect(asked).toHaveLength(1);
    clock = 20_001;
    await reaches("https://corp.example");
    expect(asked).toHaveLength(2);
  });
});
