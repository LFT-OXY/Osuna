import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissProviderEnablementError,
  selectProviderEnablement,
  setProviderEnabled,
  useProviderEnablementStore,
} from "./enablement";

function readState(provider = "copilot") {
  return selectProviderEnablement(useProviderEnablementStore.getState(), "server-1", provider);
}

describe("setProviderEnabled", () => {
  beforeEach(() => {
    useProviderEnablementStore.setState({ byKey: {} });
  });

  it("is saving while the config write runs, then returns to idle", async () => {
    let finishWrite: () => void = () => {};
    const write = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    const saving = setProviderEnabled("server-1", "copilot", { enabled: true, write });

    expect(readState()).toEqual({ status: "saving" });
    finishWrite();
    await saving;
    expect(write).toHaveBeenCalledTimes(1);
    expect(readState()).toEqual({ status: "idle" });
  });

  it("keeps the failure with the target value and message until dismissed", async () => {
    await setProviderEnabled("server-1", "copilot", {
      enabled: false,
      write: async () => {
        throw new Error("config.json is read-only");
      },
    });

    expect(readState()).toEqual({
      status: "failed",
      enabled: false,
      message: "config.json is read-only",
    });
    expect(readState("claude")).toEqual({ status: "idle" });

    dismissProviderEnablementError("server-1", "copilot");

    expect(readState()).toEqual({ status: "idle" });
  });

  it("ignores a second write while one is running", async () => {
    let finishWrite: () => void = () => {};
    const write = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    const first = setProviderEnabled("server-1", "copilot", { enabled: true, write });
    const writeAgain = vi.fn(async () => undefined);

    await setProviderEnabled("server-1", "copilot", { enabled: false, write: writeAgain });

    expect(writeAgain).not.toHaveBeenCalled();
    finishWrite();
    await first;
  });

  it("clears an earlier failure when the switch is pressed again", async () => {
    await setProviderEnabled("server-1", "copilot", {
      enabled: true,
      write: async () => {
        throw new Error("boom");
      },
    });

    await setProviderEnabled("server-1", "copilot", {
      enabled: true,
      write: async () => undefined,
    });

    expect(readState()).toEqual({ status: "idle" });
  });
});
