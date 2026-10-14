import { describe, expect, test } from "vitest";
import { joinToolRuns, orphanedToolOutputs, pairToolItems } from "./responses.js";

/*
 * Responses 请求的工具配对修补。例子照 magpie（MIT，THIRD_PARTY_NOTICES）的
 * join_tool_runs_test.go、pair_tool_items_test.go 与 orphan_tool_output_test.go。
 */

const INTERRUPTED = "[The result of this tool call is unavailable: the turn was interrupted.]";

function inputOf(body: string): Record<string, unknown>[] {
  return (JSON.parse(body) as { input: Record<string, unknown>[] }).input;
}

describe("a call with no result in a Responses request (magpie pair_tool_items_test.go)", () => {
  test("a lone call gets a synthetic result after it", () => {
    const input = inputOf(
      pairToolItems(
        '{"model":"m","input":[' +
          '{"type":"message","role":"user","content":[{"type":"input_text","text":"hi"}]},' +
          '{"type":"function_call","call_id":"call_lone","name":"echo","arguments":"{}"},' +
          '{"type":"message","role":"user","content":[{"type":"input_text","text":"again"}]}]}',
      ),
    );
    expect(input).toHaveLength(4);
    expect(input[2]).toEqual({
      type: "function_call_output",
      call_id: "call_lone",
      output: INTERRUPTED,
    });
  });

  test("a custom tool call gets a custom result", () => {
    const input = inputOf(
      pairToolItems(
        '{"model":"m","input":[{"type":"custom_tool_call","call_id":"call_c","name":"apply_patch","input":"x"}]}',
      ),
    );
    expect(input[1]).toEqual({
      type: "custom_tool_call_output",
      call_id: "call_c",
      output: INTERRUPTED,
    });
  });

  test("the synthetic result goes at the end of the run of calls and results", () => {
    const input = inputOf(
      pairToolItems(
        '{"model":"m","input":[' +
          '{"type":"function_call","call_id":"c1","name":"echo","arguments":"{}"},' +
          '{"type":"function_call","call_id":"c2","name":"echo","arguments":"{}"},' +
          '{"type":"function_call_output","call_id":"c2","output":"second"},' +
          '{"type":"message","role":"user","content":[{"type":"input_text","text":"next"}]}]}',
      ),
    );
    expect(input.map((item) => `${String(item.type)}:${String(item.call_id ?? "")}`)).toEqual([
      "function_call:c1",
      "function_call:c2",
      "function_call_output:c2",
      "function_call_output:c1",
      "message:",
    ]);
  });

  test("a request with nothing to mend comes back byte for byte", () => {
    for (const body of [
      '{"model":"m","input":[{"type":"function_call","call_id":"c1","name":"echo","arguments":"{}"},{"type":"function_call_output","call_id":"c1","output":"ok"}]}',
      '{"model":"m","input":[{"type":"function_call","call_id":"c1","name":"echo","arguments":"{}"},{"type":"function_call","call_id":"c2","name":"echo","arguments":"{}"},{"type":"function_call_output","call_id":"c2","output":"second"},{"type":"function_call_output","call_id":"c1","output":"first"}]}',
      '{"model":"m","input":[{"type":"custom_tool_call","call_id":"c3","name":"apply_patch","input":"x"},{"type":"custom_tool_call_output","call_id":"c3","output":"done"}]}',
      '{"model":"m","input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"hi"}]}]}',
      '{"model":"m","previous_response_id":"resp_1","input":[{"type":"function_call_output","call_id":"call_gone","output":"late result"}]}',
      "not json",
      "{}",
      '{"input":"hello"}',
    ]) {
      expect(pairToolItems(body)).toBe(body);
    }
  });
});

describe("a tool result with no call id (magpie orphan_tool_output_test.go)", () => {
  test("becomes a user message with its text and images", () => {
    const fixed = orphanedToolOutputs(
      '{"model":"fake/m1","previous_response_id":"resp_synthetic","input":[{"type":"function_call_output","output":[{"type":"text","text":"look"},{"type":"input_image","image_url":"data:image/png;base64,AQID"}]},{"type":"function_call_output","output":""}]}',
    );
    expect(JSON.parse(fixed)).toEqual({
      model: "fake/m1",
      previous_response_id: "resp_synthetic",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "look" },
            { type: "input_image", detail: "auto", image_url: "data:image/png;base64,AQID" },
          ],
        },
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Tool result received." }],
        },
      ],
    });
    expect(orphanedToolOutputs(fixed)).toBe(fixed);
  });

  test("inside a run of calls it waits until the run's results are in", () => {
    const input = inputOf(
      orphanedToolOutputs(
        '{"input":[{"type":"function_call","call_id":"call_synthetic","name":"echo","arguments":"{}"},' +
          '{"type":"function_call_output","id":"fco_synthetic","output":"<codex_delegation>synthetic delivery</codex_delegation>"},' +
          '{"type":"function_call_output","call_id":"call_synthetic","output":"paired result"}]}',
      ),
    );
    expect(input.map((item) => item.type)).toEqual([
      "function_call",
      "function_call_output",
      "message",
    ]);
  });

  test("a request with no such result comes back byte for byte", () => {
    for (const body of [
      "not json",
      "{}",
      '{"input":"hello"}',
      '{"input":[{"type":"function_call_output","call_id":"paired","output":"ok"}]}',
      '{"input":[{"role":"user","content":"ordinary"}]}',
    ]) {
      expect(orphanedToolOutputs(body)).toBe(body);
    }
  });
});

const RESIZE_NOTICE = `<image_resize_notice>
Image 1 of 1 in the preceding tool output was resized from 1024x9000 to 233x2048 pixels.
</image_resize_notice>`;

function orderOf(body: string): string[] {
  return inputOf(body).map((item) => `${String(item.type)}:${String(item.call_id ?? "")}`);
}

describe("an item inside a run of calls and results (magpie join_tool_runs_test.go)", () => {
  test("Codex's resize notice between two results moves to the end of the run", () => {
    const fixed = joinToolRuns(
      '{"model":"m","input":[' +
        '{"type":"message","role":"user","content":[{"type":"input_text","text":"look"}]},' +
        '{"type":"function_call","call_id":"call_00","name":"view_image","arguments":"{\\"path\\":\\"wide.png\\"}"},' +
        '{"type":"function_call","call_id":"call_01","name":"exec_command","arguments":"{}"},' +
        '{"type":"function_call_output","call_id":"call_00","output":[{"type":"input_image","image_url":"data:image/png;base64,AQID"}]},' +
        `{"type":"message","role":"developer","content":[{"type":"input_text","text":${JSON.stringify(RESIZE_NOTICE)}}]},` +
        '{"type":"function_call_output","call_id":"call_01","output":"PIL 11.3.0\\r\\n"}]}',
    );
    expect(orderOf(fixed)).toEqual([
      "message:",
      "function_call:call_00",
      "function_call:call_01",
      "function_call_output:call_00",
      "function_call_output:call_01",
      "message:",
    ]);
    expect(fixed).toContain("image_resize_notice");
    expect(joinToolRuns(fixed)).toBe(fixed);
  });

  test("whole exchanges, a call nobody answers and results out of order are left byte for byte", () => {
    for (const body of [
      '{"model":"m","input":[{"type":"function_call","call_id":"call_a","name":"echo","arguments":"{}"},{"type":"function_call_output","call_id":"call_a","output":"a"},{"type":"message","role":"developer","content":[{"type":"input_text","text":"a note"}]},{"type":"function_call","call_id":"call_b","name":"echo","arguments":"{}"},{"type":"function_call_output","call_id":"call_b","output":"b"}]}',
      '{"model":"m","input":[{"type":"function_call","call_id":"call_a","name":"echo","arguments":"{}"},{"type":"message","role":"user","content":[{"type":"input_text","text":"never mind"}]}]}',
      '{"model":"m","input":[{"type":"function_call","call_id":"call_a","name":"echo","arguments":"{}"},{"type":"function_call","call_id":"call_b","name":"echo","arguments":"{}"},{"type":"function_call_output","call_id":"call_b","output":"b"},{"type":"function_call_output","call_id":"call_a","output":"a"}]}',
      '{"model":"m","input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"hi"}]}]}',
      "not json",
      "{}",
      '{"input":"hello"}',
    ]) {
      expect(joinToolRuns(body)).toBe(body);
    }
  });
});
