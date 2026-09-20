import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetResumeTerminal,
  lookupResumeTerminal,
  rememberResumeTerminal,
  resetResumeTerminalsForTests,
} from "./resume-terminals";

const ref = { serverId: "server-1", workspaceId: "ws-1", sessionKey: "claude:handle-1" };

describe("resume terminals", () => {
  beforeEach(() => {
    resetResumeTerminalsForTests();
  });

  it("knows nothing about a session until a terminal is remembered", () => {
    expect(lookupResumeTerminal(ref)).toBeNull();

    rememberResumeTerminal({ ...ref, terminalId: "term-1" });

    expect(lookupResumeTerminal(ref)).toBe("term-1");
  });

  it("keeps one terminal per workspace for the same session", () => {
    rememberResumeTerminal({ ...ref, terminalId: "term-1" });
    rememberResumeTerminal({ ...ref, workspaceId: "ws-2", terminalId: "term-2" });
    rememberResumeTerminal({ ...ref, serverId: "server-2", terminalId: "term-3" });

    expect(lookupResumeTerminal(ref)).toBe("term-1");
    expect(lookupResumeTerminal({ ...ref, workspaceId: "ws-2" })).toBe("term-2");
    expect(lookupResumeTerminal({ ...ref, serverId: "server-2" })).toBe("term-3");
  });

  it("replaces the terminal when the session is opened again", () => {
    rememberResumeTerminal({ ...ref, terminalId: "term-1" });
    rememberResumeTerminal({ ...ref, terminalId: "term-2" });

    expect(lookupResumeTerminal(ref)).toBe("term-2");
  });

  it("forgets only the named session", () => {
    rememberResumeTerminal({ ...ref, terminalId: "term-1" });
    rememberResumeTerminal({ ...ref, sessionKey: "codex:other", terminalId: "term-2" });

    forgetResumeTerminal(ref);
    forgetResumeTerminal({ ...ref, sessionKey: "never-remembered" });

    expect(lookupResumeTerminal(ref)).toBeNull();
    expect(lookupResumeTerminal({ ...ref, sessionKey: "codex:other" })).toBe("term-2");
  });
});
