import { describe, expect, it } from "vitest";
import type { ApiEndpointNameDisplay } from "@getpaseo/protocol/api-endpoint/endpoint-names";
import { endpointNamePreview, openEndpointNameDisplayForm } from "./endpoint-name-display-form";

function open(initial: ApiEndpointNameDisplay, results: Array<string | null> = []) {
  const sent: string[] = [];
  const save = (display: string) => {
    sent.push(display);
    return Promise.resolve(results.shift() ?? null);
  };
  return { form: openEndpointNameDisplayForm({ initial, save }), sent };
}

describe("openEndpointNameDisplayForm", () => {
  it("opens with the host's choice", () => {
    expect(open("clash").form.getState()).toEqual({ display: "clash", status: { kind: "idle" } });
  });

  it("follows a change another client made, but not while its own choice is being saved", async () => {
    const { form } = open("always");
    form.hostChanged("never");
    expect(form.getState()).toEqual({ display: "never", status: { kind: "idle" } });
    const saving = form.choose("clash");
    form.hostChanged("never");
    expect(form.getState().display).toBe("clash");
    await saving;
    expect(form.getState().display).toBe("clash");
  });

  it("a choice is saved at once and shows while it is being saved", async () => {
    const { form, sent } = open("always");
    const saving = form.choose("never");
    expect(form.getState()).toEqual({ display: "never", status: { kind: "saving" } });
    await saving;
    expect(sent).toEqual(["never"]);
    expect(form.getState()).toEqual({ display: "never", status: { kind: "idle" } });
  });

  it("choosing what is already chosen sends nothing", async () => {
    const { form, sent } = open("clash");
    await form.choose("clash");
    expect(sent).toEqual([]);
  });

  it("a refusal puts the saved choice back and says why, until the next choice", async () => {
    const { form } = open("always", ["host refused"]);
    await form.choose("clash");
    expect(form.getState()).toEqual({
      display: "always",
      status: { kind: "failed", message: "host refused" },
    });
    await form.choose("never");
    expect(form.getState()).toEqual({ display: "never", status: { kind: "idle" } });
  });
});

describe("endpointNamePreview", () => {
  const relayA = {
    name: "Relay A",
    slug: "relay-a",
    enabled: true,
    models: [{ id: "kimi-k2" }, { id: "glm-5" }],
    modelFacts: { "kimi-k2": { name: "Kimi K2" }, "glm-5": { name: "GLM-5" } },
    modelSettings: { models: { "glm-5": { name: "GLM Five" } } },
  };
  const relayB = {
    name: "Relay B",
    slug: "relay-b",
    enabled: true,
    models: [{ id: "kimi-k2" }],
    modelFacts: { "kimi-k2": { name: "kimi k2" } },
  };
  const off = { name: "Off", slug: "off", enabled: false, models: [{ id: "Kimi K2" }] };
  const preview = (input: {
    endpoints?: (typeof relayA | typeof relayB | typeof off)[];
    display: ApiEndpointNameDisplay;
    disabledModels?: string[];
  }) =>
    endpointNamePreview({
      endpoint: relayA,
      endpoints: input.endpoints ?? [relayA, relayB, off],
      display: input.display,
      disabledModels: input.disabledModels ?? [],
    });

  it("names the endpoint's first model by its shown name, the endpoint's name after it by the setting", () => {
    expect(preview({ display: "always" })).toBe("Kimi K2 (Relay A)");
    expect(preview({ display: "never" })).toBe("Kimi K2");
  });

  it("only when names clash: another endpoint that is on offering the name, ignoring case, keeps it; one that is off doesn't", () => {
    expect(preview({ display: "clash" })).toBe("Kimi K2 (Relay A)");
    expect(preview({ endpoints: [relayA, off], display: "clash" })).toBe("Kimi K2");
  });

  it("a disabled model is in no list: the clash it made goes, and the first model left is the one shown", () => {
    expect(preview({ display: "clash", disabledModels: ["relay-b/kimi-k2"] })).toBe("Kimi K2");
    expect(preview({ display: "always", disabledModels: ["kimi-*"] })).toBe("GLM Five (Relay A)");
  });

  it("two models of the endpoint the list would call the same are shown by their ids, as in the picker", () => {
    const twins = {
      ...relayA,
      modelFacts: { "kimi-k2": { name: "Kimi" }, "glm-5": { name: "kimi" } },
      modelSettings: undefined,
    };
    expect(
      endpointNamePreview({
        endpoint: twins,
        endpoints: [twins],
        display: "never",
        disabledModels: [],
      }),
    ).toBe("kimi-k2");
  });

  it("is null when the endpoint serves no model", () => {
    const empty = { name: "Empty", slug: "empty", enabled: true, models: [] };
    expect(
      endpointNamePreview({
        endpoint: empty,
        endpoints: [empty],
        display: "always",
        disabledModels: [],
      }),
    ).toBe(null);
    expect(preview({ display: "always", disabledModels: ["*"] })).toBe(null);
  });
});
