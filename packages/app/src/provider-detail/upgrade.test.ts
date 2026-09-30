import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissProviderUpgradeError,
  selectProviderUpgrade,
  upgradeProvider,
  useProviderUpgradeStore,
} from "./upgrade";
import type { ProviderUpgradeResponsePayload as ProviderUpgradeResponse } from "@getpaseo/protocol/messages";

function readState(provider = "pi") {
  return selectProviderUpgrade(useProviderUpgradeStore.getState(), "server-1", provider);
}

function response(overrides: Partial<ProviderUpgradeResponse>): ProviderUpgradeResponse {
  return { requestId: "upgrade", provider: "pi", ok: true, ...overrides };
}

describe("upgradeProvider", () => {
  beforeEach(() => {
    useProviderUpgradeStore.setState({ byKey: {} });
  });

  it("is upgrading until the daemon answers, then idle with the new version reported", async () => {
    let answer: (value: ProviderUpgradeResponse) => void = () => {};
    const run = vi.fn(
      () =>
        new Promise<ProviderUpgradeResponse>((resolve) => {
          answer = resolve;
        }),
    );
    const onUpgraded = vi.fn();

    const upgrade = upgradeProvider("server-1", "pi", { run, onUpgraded });

    expect(readState()).toEqual({ status: "upgrading" });
    answer(response({ version: "0.80.0" }));
    await upgrade;
    expect(readState()).toEqual({ status: "idle" });
    expect(onUpgraded).toHaveBeenCalledWith("0.80.0");
  });

  it("ignores a second press while the first upgrade runs", async () => {
    let answer: (value: ProviderUpgradeResponse) => void = () => {};
    const run = vi.fn(
      () =>
        new Promise<ProviderUpgradeResponse>((resolve) => {
          answer = resolve;
        }),
    );

    const first = upgradeProvider("server-1", "pi", { run, onUpgraded: vi.fn() });
    await upgradeProvider("server-1", "pi", { run, onUpgraded: vi.fn() });
    answer(response({}));
    await first;

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps the command output of a failed upgrade until dismissed", async () => {
    const onUpgraded = vi.fn();

    await upgradeProvider("server-1", "pi", {
      run: async () =>
        response({
          ok: false,
          errorCode: "command_failed",
          error: "pi update exited with code 1",
          output: "npm ERR! EACCES\n",
        }),
      onUpgraded,
    });

    expect(onUpgraded).not.toHaveBeenCalled();
    expect(readState()).toEqual({
      status: "failed",
      errorCode: "command_failed",
      error: "pi update exited with code 1",
      output: "npm ERR! EACCES\n",
    });
    expect(readState("omp")).toEqual({ status: "idle" });

    dismissProviderUpgradeError("server-1", "pi");
    expect(readState()).toEqual({ status: "idle" });
  });

  it("fails with the request error when the daemon cannot be reached", async () => {
    await upgradeProvider("server-1", "pi", {
      run: async () => {
        throw new Error("Transport not connected");
      },
      onUpgraded: vi.fn(),
    });

    expect(readState()).toEqual({
      status: "failed",
      errorCode: null,
      error: "Transport not connected",
      output: null,
    });
  });

  it("clears an earlier failure when the upgrade is tried again", async () => {
    await upgradeProvider("server-1", "pi", {
      run: async () => response({ ok: false, errorCode: "timeout", output: "Downloading" }),
      onUpgraded: vi.fn(),
    });
    let answer: (value: ProviderUpgradeResponse) => void = () => {};
    const retry = upgradeProvider("server-1", "pi", {
      run: () =>
        new Promise<ProviderUpgradeResponse>((resolve) => {
          answer = resolve;
        }),
      onUpgraded: vi.fn(),
    });

    expect(readState()).toEqual({ status: "upgrading" });
    answer(response({ version: "0.80.0" }));
    await retry;
    expect(readState()).toEqual({ status: "idle" });
  });
});
