import { describe, expect, it } from "vitest";
import { ReplyModelName, chainedTidy, type ReplyTidy } from "./reply-tidy";

/** 按给的切法一段段喂进去，收齐交出的文字。 */
function fed(tidy: ReplyTidy, chunks: string[]): string {
  return chunks.map((chunk) => tidy.write(chunk)).join("") + tidy.end();
}

function renamed(input: { format: "anthropic_messages" | "openai_responses"; stream: boolean }) {
  return new ReplyModelName({ ...input, sent: "zhipu/glm-4.6", shown: "glm-4.6" });
}

const ANTHROPIC_STREAM =
  'event: message_start\ndata: {"type":"message_start","message":{"id":"m1","model":"zhipu/glm-4.6","usage":{"input_tokens":3}}}\n\n' +
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"the \\"model\\" is zhipu/glm-4.6"}}\n\n' +
  'event: message_stop\ndata: {"type":"message_stop"}\n\n';

describe("the model name in a passed-through reply", () => {
  it("is the model's own name again, wherever the stream is cut", () => {
    const want = ANTHROPIC_STREAM.replace('"model":"zhipu/glm-4.6"', '"model":"glm-4.6"');
    for (const cut of [1, 7, 40, 85, 120, ANTHROPIC_STREAM.length - 1]) {
      const chunks = [ANTHROPIC_STREAM.slice(0, cut), ANTHROPIC_STREAM.slice(cut)];
      expect(fed(renamed({ format: "anthropic_messages", stream: true }), chunks)).toBe(want);
    }
    const byChar = [...ANTHROPIC_STREAM];
    expect(fed(renamed({ format: "anthropic_messages", stream: true }), byChar)).toBe(want);
  });

  it("changes nothing else, byte for byte, text that mentions the name included", () => {
    const out = fed(renamed({ format: "anthropic_messages", stream: true }), [ANTHROPIC_STREAM]);
    expect(out.replace('"model":"glm-4.6"', '"model":"zhipu/glm-4.6"')).toBe(ANTHROPIC_STREAM);
  });

  it("leaves a different model the upstream says answered as it is", () => {
    const other = ANTHROPIC_STREAM.replace('zhipu/glm-4.6","usage', 'zhipu/glm-4.6-air","usage');
    expect(fed(renamed({ format: "anthropic_messages", stream: true }), [other])).toBe(other);
  });

  it("renames a whole Responses reply and its events, spacing kept", () => {
    const whole = '{ "object": "response",  "model" : "zhipu/glm-4.6", "output": [] }';
    expect(
      fed(renamed({ format: "openai_responses", stream: false }), [
        whole.slice(0, 9),
        whole.slice(9),
      ]),
    ).toBe('{ "object": "response",  "model" : "glm-4.6", "output": [] }');
    const event =
      'data: {"type":"response.completed","response":{"model":"zhipu/glm-4.6","status":"completed"}}\n\n';
    expect(fed(renamed({ format: "openai_responses", stream: true }), [event])).toBe(
      'data: {"type":"response.completed","response":{"model":"glm-4.6","status":"completed"}}\n\n',
    );
  });

  it("passes what is not JSON through, and chains after another tidy", () => {
    const broken = 'data: {not json "model"\n\n';
    expect(fed(renamed({ format: "anthropic_messages", stream: true }), [broken])).toBe(broken);
    const upper: ReplyTidy = { write: (text) => text.toUpperCase(), end: () => "" };
    const chained = chainedTidy([upper, renamed({ format: "anthropic_messages", stream: false })]);
    expect(chained && fed(chained, ['{"model":"zhipu/glm-4.6"}'])).toBe(
      '{"MODEL":"ZHIPU/GLM-4.6"}',
    );
  });
});
