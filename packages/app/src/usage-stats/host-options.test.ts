import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import {
  buildUsageHostOptions,
  resolveUsageHostSelection,
  usageHostStatusKey,
  USAGE_HOST_AVAILABILITIES,
  type UsageHostOption,
} from "./host-options";

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.init();
  }
});

const HOSTS = [
  { serverId: "laptop", label: "Laptop" },
  { serverId: "mini", label: "mini" },
  { serverId: "studio", label: "studio" },
  { serverId: "homelab", label: "homelab" },
];

function build(
  entries: Record<string, { supported: boolean | null; connection: HostRuntimeConnectionStatus }>,
): UsageHostOption[] {
  return buildUsageHostOptions({
    hosts: HOSTS,
    supported: new Map(Object.entries(entries).map(([id, value]) => [id, value.supported])),
    connection: new Map(Object.entries(entries).map(([id, value]) => [id, value.connection])),
  });
}

const MIXED = build({
  laptop: { supported: true, connection: "online" },
  mini: { supported: true, connection: "online" },
  studio: { supported: false, connection: "online" },
  homelab: { supported: null, connection: "offline" },
});

describe("buildUsageHostOptions", () => {
  it("separates hosts that count from hosts that are too old or unreachable", () => {
    expect(MIXED).toEqual([
      { serverId: "laptop", serverName: "Laptop", availability: "available" },
      { serverId: "mini", serverName: "mini", availability: "available" },
      { serverId: "studio", serverName: "studio", availability: "unsupported" },
      { serverId: "homelab", serverName: "homelab", availability: "disconnected" },
    ]);
  });

  it("reads a supported host that went offline as disconnected, not as one needing an update", () => {
    const options = build({
      laptop: { supported: true, connection: "offline" },
      mini: { supported: false, connection: "error" },
      studio: { supported: null, connection: "online" },
      homelab: { supported: null, connection: "connecting" },
    });
    expect(options.map((option) => option.availability)).toEqual([
      "disconnected",
      "disconnected",
      // Online but silent: its flags are unknown, so it cannot be called outdated yet.
      "disconnected",
      "disconnected",
    ]);
  });
});

describe("resolveUsageHostSelection", () => {
  it("asks every counted host when nothing is selected", () => {
    expect(resolveUsageHostSelection({ options: MIXED, selectedServerId: null })).toEqual({
      selectedServerId: null,
      hosts: [
        { serverId: "laptop", serverName: "Laptop" },
        { serverId: "mini", serverName: "mini" },
      ],
      countedCount: 2,
    });
  });

  it("narrows to the selected host and still counts the others for the All row", () => {
    expect(resolveUsageHostSelection({ options: MIXED, selectedServerId: "mini" })).toEqual({
      selectedServerId: "mini",
      hosts: [{ serverId: "mini", serverName: "mini" }],
      countedCount: 2,
    });
  });

  it("widens back to every counted host when the selected one stops counting", () => {
    for (const serverId of ["studio", "homelab", "gone"]) {
      const selection = resolveUsageHostSelection({ options: MIXED, selectedServerId: serverId });
      expect(selection.selectedServerId, serverId).toBeNull();
      expect(
        selection.hosts.map((host) => host.serverId),
        serverId,
      ).toEqual(["laptop", "mini"]);
    }
  });

  it("asks nobody when no host counts", () => {
    const options = build({
      laptop: { supported: false, connection: "online" },
      mini: { supported: null, connection: "offline" },
      studio: { supported: null, connection: "offline" },
      homelab: { supported: null, connection: "offline" },
    });
    expect(resolveUsageHostSelection({ options, selectedServerId: null })).toEqual({
      selectedServerId: null,
      hosts: [],
      countedCount: 0,
    });
  });
});

describe("runtime-assembled host filter keys", () => {
  it("has a pill for every availability that carries one", () => {
    for (const availability of USAGE_HOST_AVAILABILITIES) {
      const key = usageHostStatusKey(availability);
      if (availability === "available") {
        expect(key).toBeNull();
        continue;
      }
      if (key === null) {
        expect.fail(`${availability} carries no pill key`);
      }
      expect(i18n.exists(key), availability).toBe(true);
    }
  });

  it("has every key the host filter renders", () => {
    for (const key of [
      "usage.hostFilter.label",
      "usage.hostFilter.allHosts",
      "usage.hostFilter.countedOne",
      "usage.hostFilter.countedMany",
    ]) {
      expect(i18n.exists(key), key).toBe(true);
    }
  });
});
