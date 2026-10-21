import { describe, expect, it } from "vitest";
import { parseAgentDeepLinkFromArgv } from "./agent-navigation.js";
import { ImportLinkInbox, parseImportLinkFromArgv } from "./import-link.js";

describe("desktop import links", () => {
  it("finds paseo://import among Electron launch arguments", () => {
    expect(
      parseImportLinkFromArgv([
        "/Applications/Osuna.app/Contents/MacOS/Osuna",
        "--no-sandbox",
        "paseo://import?preset=deepseek&key=sk-abc",
      ]),
    ).toBe("paseo://import?preset=deepseek&key=sk-abc");
  });

  it("leaves Agent links and project paths to their own handlers", () => {
    const agentArgv = ["Osuna", "paseo://h/server-1/agent/agent-2"];
    expect(parseImportLinkFromArgv(agentArgv)).toBeNull();
    expect(parseAgentDeepLinkFromArgv(agentArgv)).toEqual({
      serverId: "server-1",
      agentId: "agent-2",
    });
    expect(parseImportLinkFromArgv(["Osuna", "/Users/me/project"])).toBeNull();
    expect(parseAgentDeepLinkFromArgv(["Osuna", "paseo://import?preset=deepseek"])).toBeNull();
  });

  it("holds a link until the window's renderer is ready", () => {
    const inbox = new ImportLinkInbox();
    expect(inbox.deliverOrQueue(7, "paseo://import?preset=deepseek")).toBeNull();
    expect(inbox.windowReady(7)).toBe("paseo://import?preset=deepseek");
    expect(inbox.deliverOrQueue(7, "paseo://import?preset=openai")).toBe(
      "paseo://import?preset=openai",
    );
  });
});
