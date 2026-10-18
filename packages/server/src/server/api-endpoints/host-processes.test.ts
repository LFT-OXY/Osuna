import { describe, expect, test } from "vitest";
import {
  createSystemHostProcesses,
  parseElapsed,
  parseProcessList,
  RealHostProcessesInTestError,
} from "./host-processes.js";

const NOW = new Date("2026-10-19T10:00:00.000Z");

describe("parseElapsed", () => {
  test("reads ps's etime, [[dd-]hh:]mm:ss", () => {
    expect(parseElapsed("00:05")).toBe(5);
    expect(parseElapsed("  12:34 ")).toBe(12 * 60 + 34);
    expect(parseElapsed("01:02:03")).toBe(3600 + 2 * 60 + 3);
    expect(parseElapsed("3-01:02:03")).toBe(3 * 86_400 + 3600 + 2 * 60 + 3);
  });

  test("anything else is not a time", () => {
    expect(parseElapsed("")).toBeNull();
    expect(parseElapsed("5")).toBeNull();
    expect(parseElapsed("1:2:3:4")).toBeNull();
    expect(parseElapsed("x-01:02")).toBeNull();
    expect(parseElapsed("aa:bb")).toBeNull();
  });
});

describe("parseProcessList", () => {
  test("reads pid, parent, elapsed time and the whole command line", () => {
    const output = [
      "  101     1    03:00 /opt/homebrew/bin/codex -m gpt-6",
      "  202   101 1-00:00:00 /Users/me/.codex/bin/codex app-server --managed-daemon",
      "  303   202    00:07 claude",
    ].join("\n");
    expect(parseProcessList({ output, now: NOW })).toEqual([
      {
        pid: 101,
        parentPid: 1,
        startedAt: new Date("2026-10-19T09:57:00.000Z"),
        commandLine: "/opt/homebrew/bin/codex -m gpt-6",
      },
      {
        pid: 202,
        parentPid: 101,
        startedAt: new Date("2026-10-18T10:00:00.000Z"),
        commandLine: "/Users/me/.codex/bin/codex app-server --managed-daemon",
      },
      {
        pid: 303,
        parentPid: 202,
        startedAt: new Date("2026-10-19T09:59:53.000Z"),
        commandLine: "claude",
      },
    ]);
  });

  test("skips lines it can't read", () => {
    const output = [
      "",
      "garbage",
      "0 1 00:01 kernel",
      "12 x 00:01 bad parent",
      "13 1 never x",
    ].join("\n");
    expect(parseProcessList({ output, now: NOW })).toEqual([]);
  });
});

describe("createSystemHostProcesses", () => {
  test("refuses to be made inside a test run", () => {
    expect(() => createSystemHostProcesses({ findCodex: async () => null })).toThrow(
      RealHostProcessesInTestError,
    );
  });
});
