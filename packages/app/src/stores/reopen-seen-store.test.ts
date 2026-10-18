import { describe, expect, it } from "vitest";
import { reopenSeenKey, useReopenSeenStore } from "./reopen-seen-store";

describe("reopen seen store", () => {
  it("keeps a dismissal per host and provider", () => {
    useReopenSeenStore.getState().markSeen({ serverId: "a", provider: "codex", signature: "s1" });
    useReopenSeenStore.getState().markSeen({ serverId: "b", provider: "codex", signature: "s2" });
    useReopenSeenStore.getState().markSeen({ serverId: "a", provider: "claude", signature: "s3" });
    expect(useReopenSeenStore.getState().seen).toEqual({
      [reopenSeenKey({ serverId: "a", provider: "codex" })]: "s1",
      [reopenSeenKey({ serverId: "b", provider: "codex" })]: "s2",
      [reopenSeenKey({ serverId: "a", provider: "claude" })]: "s3",
    });
  });
});
