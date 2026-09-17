import { describe, expect, it } from "vitest";
import { CreateTerminalRequestSchema, ServerInfoStatusPayloadSchema } from "./messages";

// 创建请求可选携带客户端终端的前景/背景/光标色，daemon 用它回答 TUI 的颜色查询。
// 老客户端不带该字段仍必须能解析。
describe("CreateTerminalRequest viewAttributes", () => {
  const base = {
    type: "create_terminal_request" as const,
    cwd: "/work/repo",
    requestId: "req-1",
  };

  it("parses a request without view attributes (old client / back-compat)", () => {
    const parsed = CreateTerminalRequestSchema.parse({ ...base });
    expect(parsed).toEqual(base);
  });

  it("parses a request carrying #rrggbb view attributes", () => {
    const parsed = CreateTerminalRequestSchema.parse({
      ...base,
      viewAttributes: { foreground: "#1a1a1e", background: "#ffffff", cursor: "#1A1A1E" },
    });
    expect(parsed.viewAttributes).toEqual({
      foreground: "#1a1a1e",
      background: "#ffffff",
      cursor: "#1A1A1E",
    });
  });

  it("rejects colors that are not #rrggbb", () => {
    expect(() =>
      CreateTerminalRequestSchema.parse({
        ...base,
        viewAttributes: { foreground: "#fff", background: "#ffffff", cursor: "#000000" },
      }),
    ).toThrow();
    expect(() =>
      CreateTerminalRequestSchema.parse({
        ...base,
        viewAttributes: {
          foreground: "rgb(0,0,0)",
          background: "#ffffff",
          cursor: "#000000",
        },
      }),
    ).toThrow();
  });

  it("rejects view attributes missing one of the three colors", () => {
    expect(() =>
      CreateTerminalRequestSchema.parse({
        ...base,
        viewAttributes: { foreground: "#000000", background: "#ffffff" },
      }),
    ).toThrow();
  });
});

describe("server_info terminalViewAttributes feature", () => {
  it("parses the feature flag when advertised", () => {
    const parsed = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "srv-1",
      features: { terminalViewAttributes: true },
    });
    expect(parsed.features?.terminalViewAttributes).toBe(true);
  });
});
