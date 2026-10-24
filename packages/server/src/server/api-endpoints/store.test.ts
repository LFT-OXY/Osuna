import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import { ApiEndpointStore, type StoredApiEndpoint } from "./store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function storeIn(): Promise<{ store: ApiEndpointStore; endpointsDir: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-endpoint-store-"));
  roots.push(root);
  const store = new ApiEndpointStore({ paseoHome: root, logger: pino({ level: "silent" }) });
  await mkdir(store.endpointsDir, { recursive: true });
  return { store, endpointsDir: store.endpointsDir };
}

function endpoint(id: string, name: string): StoredApiEndpoint {
  return {
    id,
    slug: id,
    name,
    baseUrls: [{ format: "anthropic_messages", url: "https://relay.example" }],
    models: [],
    enabled: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

const AGENTS = {
  claude: { enabled: false, defaultModelId: null },
  codex: { enabled: false, defaultModelId: null },
};

describe("endpoint snapshots", () => {
  test("a rename keeps the endpoint's multiplier, a delete keeps the one it had, and a cleared one is gone", async () => {
    const { store, endpointsDir } = await storeIn();
    await writeFile(
      path.join(endpointsDir, "endpoint-snapshots.json"),
      JSON.stringify({
        endpoints: {
          ep_a: { name: "Relay A", priceMultiplier: 0.8 },
          ep_b: { name: "Relay B", priceMultiplier: 1.5 },
          ep_c: { name: "Relay C", priceMultiplier: 2 },
        },
      }),
    );

    store.writeState({
      endpoints: [
        { ...endpoint("ep_a", "Relay A renamed"), priceMultiplier: 0.8 },
        endpoint("ep_c", "Relay C"),
      ],
      agents: AGENTS,
    });

    expect(store.readEndpointSnapshots()).toEqual({
      ep_a: { name: "Relay A renamed", priceMultiplier: 0.8 },
      ep_b: { name: "Relay B", priceMultiplier: 1.5, deleted: true },
      // 倍率清掉了：按原价。
      ep_c: { name: "Relay C" },
    });
  });
});
