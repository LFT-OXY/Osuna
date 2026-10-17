// 已下线模型记一周、厂商答一次就恢复，照 magpie（MIT，THIRD_PARTY_NOTICES）的 internal/provider/retired.go。

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { RetiredModels } from "./retired-models.js";
import type { ApiEndpointState, StoredApiEndpoint } from "./store.js";

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse("2026-10-17T00:00:00.000Z");

function endpoint(id: string, models: string[]): StoredApiEndpoint {
  return {
    id,
    slug: id,
    name: id.toUpperCase(),
    baseUrls: [{ format: "anthropic_messages", url: `https://${id}.example` }],
    models: models.map((model) => ({ id: model })),
    enabled: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

const ZEN = endpoint("zen", ["exo-free", "space-bunny-free"]);

const STATE: ApiEndpointState = {
  endpoints: [ZEN, endpoint("relay", ["exo-free"])],
  agents: {
    claude: { enabled: true, defaultModelId: "exo-free" },
    codex: { enabled: false, defaultModelId: null },
  },
};

function listedModels(state: ApiEndpointState): Record<string, string[]> {
  return Object.fromEntries(
    state.endpoints.map((entry) => [entry.id, entry.models.map((model) => model.id)]),
  );
}

let root: string;
let filePath: string;
let now: number;
let changes: number;
// 手动推进的到期定时器：只留最近一次排的。
let pending: { handler: () => void; ms: number } | null;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "paseo-retired-models-"));
  filePath = path.join(root, "retired-models.json");
  now = START;
  changes = 0;
  pending = null;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 到点：定时器跑一次后就不再排着，除非处理时又排了新的。 */
function fire(): void {
  const due = pending;
  pending = null;
  due?.handler();
}

function create(): RetiredModels {
  return new RetiredModels({
    filePath,
    logger: createTestLogger(),
    now: () => now,
    timers: {
      schedule: (handler, ms) => {
        pending = { handler, ms };
        return () => {
          pending = null;
        };
      },
    },
    onChanged: () => {
      changes += 1;
    },
  });
}

const ZEN_EXO = { endpoint: ZEN, model: "exo-free" };

describe("a model its vendor said is retired", () => {
  test("leaves that endpoint's models only, and the agents' default stays", () => {
    const retired = create();

    retired.retire(ZEN_EXO);

    const listed = retired.listed(STATE);
    expect(listedModels(listed)).toEqual({ zen: ["space-bunny-free"], relay: ["exo-free"] });
    expect(listed.agents).toEqual(STATE.agents);
    expect(changes).toBe(1);
  });

  test("is kept in a file a restarted daemon reads back", async () => {
    create().retire(ZEN_EXO);

    const file: unknown = JSON.parse(await readFile(filePath, "utf8"));
    expect(file).toEqual({
      models: [{ endpointId: "zen", model: "exo-free", retiredAt: "2026-10-17T00:00:00.000Z" }],
    });
    expect(listedModels(create().listed(STATE))).toEqual({
      zen: ["space-bunny-free"],
      relay: ["exo-free"],
    });
  });

  test("said again within the week keeps the first time and changes nothing", async () => {
    const retired = create();
    retired.retire(ZEN_EXO);
    now = START + DAY;

    retired.retire(ZEN_EXO);

    expect(changes).toBe(1);
    const file: unknown = JSON.parse(await readFile(filePath, "utf8"));
    expect(file).toEqual({
      models: [{ endpointId: "zen", model: "exo-free", retiredAt: "2026-10-17T00:00:00.000Z" }],
    });
  });

  test("comes back a week later on its own, with no one reading the lists", async () => {
    const retired = create();
    retired.retire(ZEN_EXO);
    expect(pending?.ms).toBe(7 * DAY);

    now = START + 7 * DAY;
    fire();

    expect(changes).toBe(2);
    expect(pending).toBeNull();
    const file: unknown = JSON.parse(await readFile(filePath, "utf8"));
    expect(file).toEqual({ models: [] });
    expect(listedModels(retired.listed(STATE)).zen).toEqual(["exo-free", "space-bunny-free"]);
  });

  test("reading the lists past the week shows it again but leaves the file to the timer", async () => {
    const retired = create();
    retired.retire(ZEN_EXO);
    now = START + 7 * DAY - 1;
    expect(listedModels(retired.listed(STATE)).zen).toEqual(["space-bunny-free"]);

    now = START + 7 * DAY;

    expect(listedModels(retired.listed(STATE)).zen).toEqual(["exo-free", "space-bunny-free"]);
    expect(changes).toBe(1);
    const file: unknown = JSON.parse(await readFile(filePath, "utf8"));
    expect(file).toEqual({
      models: [{ endpointId: "zen", model: "exo-free", retiredAt: "2026-10-17T00:00:00.000Z" }],
    });
  });

  test("the timer aims at the earliest record, also after a restart, and stops on dispose", () => {
    const retired = create();
    retired.retire(ZEN_EXO);
    now = START + 2 * DAY;
    retired.retire({ endpoint: ZEN, model: "space-bunny-free" });
    expect(pending?.ms).toBe(5 * DAY);
    retired.dispose();
    expect(pending).toBeNull();

    now = START + 8 * DAY;
    create();

    expect(pending?.ms).toBe(0);
    fire();
    expect(changes).toBe(3);
    expect(pending?.ms).toBe(DAY);
  });

  test("comes back as soon as the vendor answers a request for it", () => {
    const retired = create();
    retired.retire(ZEN_EXO);

    retired.restore(ZEN_EXO);
    retired.restore(ZEN_EXO);

    expect(listedModels(retired.listed(STATE)).zen).toEqual(["exo-free", "space-bunny-free"]);
    expect(changes).toBe(2);
    expect(listedModels(create().listed(STATE)).zen).toEqual(["exo-free", "space-bunny-free"]);
  });

  test("an answer for a model never said retired writes nothing", async () => {
    create().restore(ZEN_EXO);

    expect(changes).toBe(0);
    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("a Claude tier mapped to it is left out with it", () => {
    const mapped = { ...ZEN, modelMapping: { haiku: "exo-free", opus: "space-bunny-free" } };
    const state = { ...STATE, endpoints: [mapped] };
    const retired = create();

    retired.retire({ endpoint: mapped, model: "exo-free" });

    expect(retired.listed(state).endpoints[0]?.modelMapping).toEqual({ opus: "space-bunny-free" });
  });
});

describe("the retired models file", () => {
  test.each([
    ["not JSON", "{ not json"],
    ["the wrong shape", JSON.stringify({ models: [{ endpointId: "zen" }] })],
  ])("counts as empty when it is %s, and the next record rewrites it", async (_case, text) => {
    await writeFile(filePath, text);
    const retired = create();

    expect(retired.listed(STATE)).toEqual(STATE);
    retired.retire(ZEN_EXO);

    const file: unknown = JSON.parse(await readFile(filePath, "utf8"));
    expect(file).toEqual({
      models: [{ endpointId: "zen", model: "exo-free", retiredAt: "2026-10-17T00:00:00.000Z" }],
    });
  });
});
