import { describe, expect, test } from "vitest";
import { stampCodexTurnIds, type AgentTurnTimestamp } from "./codex-turn-match.js";

const TIMELINE: AgentTurnTimestamp[] = [
  { turnId: "turn-a", at: "2026-09-18T10:00:00.000Z" },
  { turnId: "turn-b", at: "2026-09-18T10:05:00.000Z" },
];

function turn(overrides: {
  cli?: "claude" | "codex" | "pi" | "omp";
  startedAt: string;
  turnId?: string | null;
}) {
  return {
    cli: overrides.cli ?? ("codex" as const),
    startedAt: overrides.startedAt,
    turnId: overrides.turnId ?? null,
  };
}

describe("stampCodexTurnIds", () => {
  test("takes the nearest user message inside the window", () => {
    const rows = stampCodexTurnIds(
      [
        turn({ startedAt: "2026-09-18T10:00:20.000Z" }),
        turn({ startedAt: "2026-09-18T10:04:40.000Z" }),
      ],
      TIMELINE,
    );

    expect(rows.map((row) => row.turnId)).toEqual(["turn-a", "turn-b"]);
  });

  test("leaves a turn that started outside the window alone", () => {
    const rows = stampCodexTurnIds([turn({ startedAt: "2026-09-18T10:00:31.000Z" })], TIMELINE);

    expect(rows[0]?.turnId).toBe(null);
  });

  test("only Codex turns are matched, and only ones with no id yet", () => {
    const rows = stampCodexTurnIds(
      [
        turn({ cli: "claude", startedAt: "2026-09-18T10:00:00.000Z" }),
        turn({ cli: "pi", startedAt: "2026-09-18T10:00:00.000Z" }),
        turn({ cli: "omp", startedAt: "2026-09-18T10:00:00.000Z" }),
        turn({ startedAt: "2026-09-18T10:00:00.000Z", turnId: "already-known" }),
      ],
      TIMELINE,
    );

    expect(rows.map((row) => row.turnId)).toEqual([null, null, null, "already-known"]);
  });

  test("an unparsable timestamp on either side matches nothing", () => {
    const rows = stampCodexTurnIds([turn({ startedAt: "not-a-date" })], TIMELINE);
    const rowsWithBadTimeline = stampCodexTurnIds(
      [turn({ startedAt: "2026-09-18T10:00:00.000Z" })],
      [{ turnId: "turn-x", at: "whenever" }],
    );

    expect(rows[0]?.turnId).toBe(null);
    expect(rowsWithBadTimeline[0]?.turnId).toBe(null);
  });
});
