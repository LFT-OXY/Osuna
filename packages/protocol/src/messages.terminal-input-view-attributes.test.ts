import { describe, expect, it } from "vitest";
import { TerminalInputSchema } from "./messages";

// terminal_input 新增 view_attributes 消息：客户端在尺寸 claim 之后与主题变化时推送三色。
// 老消息（input/resize/mouse）必须继续解析。
describe("TerminalInput view_attributes message", () => {
  it("parses a view_attributes message carrying #rrggbb colors", () => {
    const parsed = TerminalInputSchema.parse({
      type: "terminal_input",
      terminalId: "term-1",
      message: {
        type: "view_attributes",
        attributes: { foreground: "#1a1a1e", background: "#ffffff", cursor: "#1A1A1E" },
      },
    });
    expect(parsed.message).toEqual({
      type: "view_attributes",
      attributes: { foreground: "#1a1a1e", background: "#ffffff", cursor: "#1A1A1E" },
    });
  });

  it("still parses the existing resize message (old client / back-compat)", () => {
    const parsed = TerminalInputSchema.parse({
      type: "terminal_input",
      terminalId: "term-1",
      message: { type: "resize", rows: 24, cols: 80, intent: "claim" },
    });
    expect(parsed.message).toEqual({ type: "resize", rows: 24, cols: 80, intent: "claim" });
  });

  it("rejects view_attributes with a malformed color", () => {
    expect(() =>
      TerminalInputSchema.parse({
        type: "terminal_input",
        terminalId: "term-1",
        message: {
          type: "view_attributes",
          attributes: { foreground: "#fff", background: "#ffffff", cursor: "#000000" },
        },
      }),
    ).toThrow();
  });

  it("rejects view_attributes missing the attributes object", () => {
    expect(() =>
      TerminalInputSchema.parse({
        type: "terminal_input",
        terminalId: "term-1",
        message: { type: "view_attributes" },
      }),
    ).toThrow();
  });
});
