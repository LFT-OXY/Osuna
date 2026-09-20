import { mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "vitest";
import { editPersistedConfig } from "@osuna/server";
import {
  outputPairingResult,
  resolveLocalPairingOffer,
  type PairCommandOutput,
  type PairingOffer,
} from "./pair.js";

test("offline pairing requires relay consent and saves it in the selected home", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-offline-pair-"));
  const home = path.join(root, "home");
  try {
    expect(await resolveLocalPairingOffer({ paseoHome: home })).toEqual({
      relayEnabled: false,
      url: null,
      qr: null,
      unavailableReason: "relay_disabled",
    });
    expect(existsSync(home)).toBe(false);

    // relay 端点与 app 地址都没有默认值，不显式配置就出不了链接
    editPersistedConfig(home, "daemon.relay.endpoint", { value: "127.0.0.1:9" });
    editPersistedConfig(home, "app.baseUrl", { value: "https://app.example.test" });

    const offer = await resolveLocalPairingOffer({ paseoHome: home, enableRelay: true });
    expect(offer.relayEnabled).toBe(true);
    expect(offer.url).toContain("offer=");
    expect(offer.unavailableReason).toBeNull();
    expect(
      JSON.parse(await readFile(path.join(home, "config.json"), "utf8")).daemon.relay.enabled,
    ).toBe(true);
    expect(existsSync(path.join(home, "server-id"))).toBe(true);
    expect(existsSync(path.join(home, "daemon-keypair.json"))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("relay pairing without an app base URL names the missing setting", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "osuna-pair-no-app-url-"));
  const home = path.join(root, "home");
  try {
    editPersistedConfig(home, "daemon.relay.endpoint", { value: "127.0.0.1:9" });

    expect(await resolveLocalPairingOffer({ paseoHome: home, enableRelay: true })).toEqual({
      relayEnabled: true,
      url: null,
      qr: null,
      unavailableReason: "app_base_url_unset",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("relay pairing without a relay endpoint names the missing setting", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "osuna-pair-no-relay-endpoint-"));
  const home = path.join(root, "home");
  try {
    editPersistedConfig(home, "app.baseUrl", { value: "https://app.example.test" });

    expect(await resolveLocalPairingOffer({ paseoHome: home, enableRelay: true })).toEqual({
      relayEnabled: true,
      url: null,
      qr: null,
      unavailableReason: "relay_endpoint_unset",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function captureOutput(): PairCommandOutput & { stdout: string; stderr: string; exitCode: number } {
  const captured = {
    columns: 80,
    stdout: "",
    stderr: "",
    exitCode: 0,
    writeStdout(message: string) {
      captured.stdout += message;
    },
    writeStderr(message: string) {
      captured.stderr += message;
    },
    setExitCode(code: number) {
      captured.exitCode = code;
    },
    success() {},
  };
  return captured;
}

const OFFLINE_TARGET = { kind: "instance", home: "/nonexistent" } as const;

function makeOffer(overrides: Partial<PairingOffer>): PairingOffer {
  return { relayEnabled: true, url: null, qr: null, unavailableReason: null, ...overrides };
}

test("a pairing offer without a link exits 1 and names the missing setting", () => {
  const output = captureOutput();
  outputPairingResult(
    makeOffer({ unavailableReason: "app_base_url_unset" }),
    { daemonTarget: OFFLINE_TARGET },
    output,
  );

  expect(output.exitCode).toBe(1);
  expect(output.stdout).toBe("");
  expect(output.stderr).toContain("no app base URL");
  expect(output.stderr).toContain("osuna daemon config set app.baseUrl");
});

test("--json reports the pairing failure as a structured error code", () => {
  const disabled = captureOutput();
  outputPairingResult(
    makeOffer({ relayEnabled: false, unavailableReason: "relay_disabled" }),
    { daemonTarget: OFFLINE_TARGET, json: true },
    disabled,
  );
  expect(disabled.exitCode).toBe(1);
  expect(JSON.parse(disabled.stderr).code).toBe("RELAY_DISABLED");

  // 远端 daemon 不回原因，只能退到兜底码
  const remote = captureOutput();
  outputPairingResult(makeOffer({}), { daemonTarget: OFFLINE_TARGET, json: true }, remote);
  expect(remote.exitCode).toBe(1);
  expect(JSON.parse(remote.stderr).code).toBe("PAIRING_LINK_UNAVAILABLE");

  // 本机 daemon 配置已配齐却仍没有链接，缺的是一次重启
  const stale = captureOutput();
  outputPairingResult(
    makeOffer({ unavailableReason: "config_not_applied" }),
    { daemonTarget: OFFLINE_TARGET, json: true },
    stale,
  );
  expect(JSON.parse(stale.stderr).code).toBe("DAEMON_RESTART_REQUIRED");

  const endpoint = captureOutput();
  outputPairingResult(
    makeOffer({ unavailableReason: "relay_endpoint_unset" }),
    { daemonTarget: OFFLINE_TARGET, json: true },
    endpoint,
  );
  expect(JSON.parse(endpoint.stderr).code).toBe("RELAY_ENDPOINT_UNSET");
});
