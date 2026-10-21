import { describe, expect, it } from "vitest";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  disableChoices,
  disabledModelHits,
  openDisabledModelsList,
  withoutDisabledEndpointModels,
} from "./disabled-models-list";

function endpoint(input: {
  slug: string;
  name: string;
  models: string[];
  enabled?: boolean;
}): ApiEndpoint {
  return {
    id: `ep_${input.slug}`,
    provider: "claude",
    slug: input.slug,
    name: input.name,
    baseUrl: "https://relay.example",
    models: input.models.map((id) => ({ id })),
    defaultModelId: input.models[0] ?? "",
    enabled: input.enabled ?? true,
    hasApiKey: true,
  };
}

function modelIdsOf(rows: ApiEndpoint[]): string[][] {
  return rows.map((row) => row.models.map((model) => model.id));
}

const ENDPOINTS = [
  endpoint({ slug: "relay-a", name: "Relay A", models: ["kimi-k2", "gemini-3-preview"] }),
  endpoint({ slug: "relay-b", name: "Relay B", models: ["glm-5-preview"] }),
  endpoint({ slug: "off", name: "Off", models: ["o3-preview"], enabled: false }),
];

function recorder(results: Array<string | null> = []) {
  const sent: string[][] = [];
  const save = (models: string[]) => {
    sent.push(models);
    return Promise.resolve(results.shift() ?? null);
  };
  return { sent, save };
}

describe("disabled models list", () => {
  it("says what each entry turns off now among the endpoints that are on, as endpoint/model", () => {
    expect(
      disabledModelHits({ patterns: ["*-PREVIEW", "nothing-*"], endpoints: ENDPOINTS }),
    ).toEqual({
      "*-PREVIEW": ["relay-a/gemini-3-preview", "relay-b/glm-5-preview"],
      "nothing-*": [],
    });
  });

  it("offers the models of the endpoints that are on, by endpoint, without the ones already disabled", () => {
    expect(disableChoices({ endpoints: ENDPOINTS, patterns: ["kimi-*"] })).toEqual([
      { id: "relay-a/gemini-3-preview", label: "gemini-3-preview", description: "Relay A" },
      { id: "relay-b/glm-5-preview", label: "glm-5-preview", description: "Relay B" },
    ]);
  });

  it("leaves disabled models out of the default model choices", () => {
    const kept = withoutDisabledEndpointModels({ endpoints: ENDPOINTS, patterns: ["*-preview"] });
    expect(modelIdsOf(kept)).toEqual([["kimi-k2"], [], []]);
    expect(withoutDisabledEndpointModels({ endpoints: ENDPOINTS, patterns: [] })).toBe(ENDPOINTS);
  });

  it("adds a typed pattern trimmed at the end of the list and saves the whole list", async () => {
    const { sent, save } = recorder();
    const list = openDisabledModelsList({ initial: ["*fable*"], save });
    expect(await list.disable(" *-preview ")).toBe("saved");
    expect(sent).toEqual([["*fable*", "*-preview"]]);
    expect(list.getState()).toEqual({
      patterns: ["*fable*", "*-preview"],
      status: { kind: "idle" },
    });
  });

  it("takes nothing for an empty entry or one already on the list in another case", async () => {
    const { sent, save } = recorder();
    const list = openDisabledModelsList({ initial: ["*fable*"], save });
    expect(await list.disable("  ")).toBe("unchanged");
    expect(await list.disable("*FABLE*")).toBe("duplicate");
    expect(sent).toEqual([]);
    expect(list.getState()).toEqual({ patterns: ["*fable*"], status: { kind: "idle" } });
  });

  it("enables an entry by taking it off the list; a refusal keeps the list as it was and says why", async () => {
    const { sent, save } = recorder([null, "host refused"]);
    const list = openDisabledModelsList({ initial: ["*fable*", "o3"], save });
    expect(await list.enable("*fable*")).toBe("saved");
    expect(list.getState().patterns).toEqual(["o3"]);
    expect(await list.disable("gpt-5")).toBe("failed");
    expect(sent).toEqual([["o3"], ["o3", "gpt-5"]]);
    expect(list.getState()).toEqual({
      patterns: ["o3"],
      status: { kind: "failed", message: "host refused" },
    });
  });
});
