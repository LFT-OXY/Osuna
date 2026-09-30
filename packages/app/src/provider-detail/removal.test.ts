import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissProviderRemovalError,
  removeProvider,
  selectProviderRemoval,
  useProviderRemovalStore,
} from "./removal";

function readState(provider = "junie") {
  return selectProviderRemoval(useProviderRemovalStore.getState(), "server-1", provider);
}

describe("removeProvider", () => {
  beforeEach(() => {
    useProviderRemovalStore.setState({ byKey: {} });
  });

  it("stays idle when the confirmation is declined", async () => {
    const remove = vi.fn(async () => undefined);

    await removeProvider("server-1", "junie", { confirm: async () => false, remove });

    expect(remove).not.toHaveBeenCalled();
    expect(readState()).toEqual({ status: "idle" });
  });

  it("removes the provider after confirmation and returns to idle", async () => {
    const remove = vi.fn(async () => undefined);

    await removeProvider("server-1", "junie", { confirm: async () => true, remove });

    expect(remove).toHaveBeenCalledTimes(1);
    expect(readState()).toEqual({ status: "idle" });
  });

  it("is removing while the confirmation and the config write run", async () => {
    let finishRemove: () => void = () => {};
    const remove = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRemove = resolve;
        }),
    );
    const removal = removeProvider("server-1", "junie", { confirm: async () => true, remove });

    expect(readState()).toEqual({ status: "removing" });
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(readState()).toEqual({ status: "removing" });
    finishRemove();
    await removal;
    expect(readState()).toEqual({ status: "idle" });
  });

  it("keeps the failure with its message until dismissed", async () => {
    await removeProvider("server-1", "junie", {
      confirm: async () => true,
      remove: async () => {
        throw new Error("config.json is read-only");
      },
    });

    expect(readState()).toEqual({ status: "failed", message: "config.json is read-only" });
    expect(readState("claude")).toEqual({ status: "idle" });

    dismissProviderRemovalError("server-1", "junie");

    expect(readState()).toEqual({ status: "idle" });
  });

  it("ignores a second removal while one is running", async () => {
    let finishRemove: () => void = () => {};
    const remove = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRemove = resolve;
        }),
    );
    const first = removeProvider("server-1", "junie", { confirm: async () => true, remove });
    const confirmAgain = vi.fn(async () => true);

    await removeProvider("server-1", "junie", { confirm: confirmAgain, remove });

    expect(confirmAgain).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    finishRemove();
    await first;
  });

  it("clears an earlier failure when the removal is retried", async () => {
    await removeProvider("server-1", "junie", {
      confirm: async () => true,
      remove: async () => {
        throw new Error("boom");
      },
    });

    await removeProvider("server-1", "junie", {
      confirm: async () => true,
      remove: async () => undefined,
    });

    expect(readState()).toEqual({ status: "idle" });
  });
});
