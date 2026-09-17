import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrateSessionHistoryScopeState, useSessionHistoryScopeStore } from "./scope-store";

// The persist middleware hydrates through AsyncStorage on import, and its web
// build reaches `window`, which the Node `unit` project does not have.
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("session history scope store", () => {
  beforeEach(() => {
    useSessionHistoryScopeStore.setState({ scope: "project" });
  });

  it("defaults to project scope", () => {
    expect(useSessionHistoryScopeStore.getState().scope).toBe("project");
  });

  it("remembers the last chosen scope", () => {
    useSessionHistoryScopeStore.getState().setScope("host");
    expect(useSessionHistoryScopeStore.getState().scope).toBe("host");
  });

  it("migrates persisted state back to project when the scope is unknown", () => {
    expect(migrateSessionHistoryScopeState({ scope: "workspace" })).toEqual({
      scope: "workspace",
    });
    expect(migrateSessionHistoryScopeState({ scope: "everything" })).toEqual({
      scope: "project",
    });
    expect(migrateSessionHistoryScopeState(null)).toEqual({ scope: "project" });
  });
});
