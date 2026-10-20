import { describe, expect, it } from "vitest";
import type { ApiEndpointLongConversations } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { openLongConversationsForm, type LongConversationsChange } from "./long-conversations-form";
import { tokenFormatOf } from "./model-settings-form";

const EN = tokenFormatOf("en");

function recorder(results: Array<string | null> = []) {
  const sent: LongConversationsChange[] = [];
  const save = (change: LongConversationsChange) => {
    sent.push(change);
    return Promise.resolve(results.shift() ?? null);
  };
  return { sent, save };
}

function open(initial: ApiEndpointLongConversations, results: Array<string | null> = []) {
  const { sent, save } = recorder(results);
  const form = openLongConversationsForm({ initial, save, tokenFormat: EN });
  return { form, sent };
}

describe("openLongConversationsForm", () => {
  it("opens with the host's settings, the Compact at in the language's digits and 272K as the placeholder", () => {
    const { form } = open({ compactAt: 400_000 });
    expect(form.getState()).toMatchObject({
      fullContext: false,
      compactAt: { text: "400,000", invalid: false },
      placeholder: "272,000",
      status: { kind: "idle" },
    });
    expect(open({ fullContext: true }).form.getState()).toMatchObject({
      fullContext: true,
      compactAt: { text: "" },
    });
  });

  it("the switch saves at once; a refusal puts it back and says why", async () => {
    const { form, sent } = open({}, [null, "host refused"]);
    await form.setFullContext(true);
    expect(sent).toEqual([{ fullContext: true }]);
    expect(form.getState().fullContext).toBe(true);

    await form.setFullContext(false);
    expect(sent[1]).toEqual({ fullContext: false });
    expect(form.getState()).toMatchObject({
      fullContext: true,
      status: { kind: "failed", message: "host refused" },
    });
  });

  it("a typed Compact at is saved when committed, with Full window off; empty goes back to 272K", async () => {
    const { form, sent } = open({ compactAt: 400_000 });
    form.setCompactText("500,000");
    expect(await form.commitCompact()).toBe("saved");
    expect(sent).toEqual([{ fullContext: false, compactAt: 500_000 }]);

    // 没改不发。
    expect(await form.commitCompact()).toBe("unchanged");
    expect(sent).toHaveLength(1);

    form.setCompactText("");
    expect(await form.commitCompact()).toBe("saved");
    expect(sent[1]).toEqual({ fullContext: false, compactAt: null });

    // 272K 就是不设：已经没设时交它不算改动。
    form.setCompactText("272000");
    expect(await form.commitCompact()).toBe("unchanged");
    expect(sent).toHaveLength(2);
  });

  it("an unreadable number is marked and never sent; a failed save keeps what was typed", async () => {
    const { form, sent } = open({}, ["host refused"]);
    form.setCompactText("lots");
    expect(await form.commitCompact()).toBe("invalid");
    expect(form.getState().compactAt.invalid).toBe(true);
    expect(sent).toEqual([]);

    form.setCompactText("300k");
    expect(form.getState().compactAt.invalid).toBe(true);
    form.setCompactText("300000");
    expect(await form.commitCompact()).toBe("failed");
    expect(form.getState()).toMatchObject({
      compactAt: { text: "300000", invalid: false },
      status: { kind: "failed", message: "host refused" },
    });
  });
});
