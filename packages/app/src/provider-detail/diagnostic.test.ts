import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  revealProviderDiagnostic,
  runProviderDiagnostic,
  selectProviderDiagnostic,
  selectProviderDiagnosticReveal,
  useProviderDiagnosticStore,
} from "./diagnostic";

function readState(provider = "codex") {
  return selectProviderDiagnostic(useProviderDiagnosticStore.getState(), "server-1", provider);
}

function readReveal(provider = "codex") {
  return selectProviderDiagnosticReveal(
    useProviderDiagnosticStore.getState(),
    "server-1",
    provider,
  );
}

describe("runProviderDiagnostic", () => {
  beforeEach(() => {
    useProviderDiagnosticStore.setState({ byKey: {}, reveals: {} });
  });

  it("starts idle", () => {
    expect(readState()).toEqual({ status: "idle" });
  });

  it("is running until the output arrives, then keeps it with the time it ran", async () => {
    let finish: (output: string) => void = () => {};
    const fetchDiagnostic = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );

    const run = runProviderDiagnostic("server-1", "codex", fetchDiagnostic);
    expect(readState()).toEqual({ status: "running" });

    finish("Codex\n  Binary: /usr/local/bin/codex");
    await run;

    expect(readState()).toEqual({
      status: "ready",
      output: "Codex\n  Binary: /usr/local/bin/codex",
      ranAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it("keeps the failure with its message", async () => {
    await runProviderDiagnostic("server-1", "codex", async () => {
      throw new Error("daemon unreachable");
    });

    expect(readState()).toEqual({ status: "failed", message: "daemon unreachable" });
  });

  it("does not start a second run while one is running", async () => {
    let finish: (output: string) => void = () => {};
    const fetchDiagnostic = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );

    const first = runProviderDiagnostic("server-1", "codex", fetchDiagnostic);
    await runProviderDiagnostic("server-1", "codex", fetchDiagnostic);
    finish("done");
    await first;

    expect(fetchDiagnostic).toHaveBeenCalledTimes(1);
  });

  it("keeps each provider's diagnostic apart", async () => {
    await runProviderDiagnostic("server-1", "codex", async () => "codex output");

    expect(readState("codex").status).toBe("ready");
    expect(readState("opencode")).toEqual({ status: "idle" });
  });
});

describe("revealProviderDiagnostic", () => {
  beforeEach(() => {
    useProviderDiagnosticStore.setState({ byKey: {}, reveals: {} });
  });

  it("counts each request for this provider only", () => {
    expect(readReveal()).toBe(0);

    revealProviderDiagnostic("server-1", "codex");
    revealProviderDiagnostic("server-1", "codex");

    expect(readReveal()).toBe(2);
    expect(readReveal("opencode")).toBe(0);
  });
});
