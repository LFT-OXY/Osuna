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
    enabled: true,
    models: [{ id: "kimi-k2", label: "Kimi K2" }, { id: "glm-5" }],
    modelSettings: { models: { "glm-5": { name: "GLM Five" } } },
  };
  const relayB = { name: "Relay B", enabled: true, models: [{ id: "kimi-k2", label: "kimi k2" }] };
  const off = { name: "Off", enabled: false, models: [{ id: "glm five" }] };

  it("names the endpoint's first model as the lists would, the endpoint's name after it by the setting", () => {
    const endpoints = [relayA, relayB, off];
    expect(endpointNamePreview({ endpoint: relayA, endpoints, display: "always" })).toBe(
      "Kimi K2 (Relay A)",
    );
    // 只差大小写也算同名；关着的接口不在选单里。
    expect(endpointNamePreview({ endpoint: relayA, endpoints, display: "clash" })).toBe(
      "Kimi K2 (Relay A)",
    );
    expect(
      endpointNamePreview({ endpoint: relayA, endpoints: [relayA, off], display: "clash" }),
    ).toBe("Kimi K2");
    expect(endpointNamePreview({ endpoint: relayA, endpoints, display: "never" })).toBe("Kimi K2");
  });

  it("is null for an endpoint with no model selected", () => {
    const empty = { name: "Empty", enabled: true, models: [] };
    expect(endpointNamePreview({ endpoint: empty, endpoints: [empty], display: "always" })).toBe(
      null,
    );
  });
});
