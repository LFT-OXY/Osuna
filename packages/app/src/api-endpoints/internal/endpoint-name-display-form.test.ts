import { describe, expect, it } from "vitest";
import { openEndpointNameDisplayForm } from "./endpoint-name-display-form";

function open(initial: string | undefined, results: Array<string | null> = []) {
  const sent: string[] = [];
  const save = (display: string) => {
    sent.push(display);
    return Promise.resolve(results.shift() ?? null);
  };
  return { form: openEndpointNameDisplayForm({ initial, save }), sent };
}

describe("openEndpointNameDisplayForm", () => {
  it("opens with the host's choice; an older host's missing one, or one it does not know, is Always", () => {
    expect(open("clash").form.getState()).toEqual({ display: "clash", status: { kind: "idle" } });
    expect(open(undefined).form.getState().display).toBe("always");
    expect(open("sometimes").form.getState().display).toBe("always");
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
