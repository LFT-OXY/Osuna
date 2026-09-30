import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import type {
  DispatchRowState,
  DispatchSubagent,
  PaseoSubagentRow,
  ProviderSubagentRow,
  SubagentRow,
} from "./select";
import {
  buildDispatchGroupHeaderPresentation,
  buildDispatchRowPresentation,
  buildSubagentPillPresentation,
  buildSubagentRowPresentationData,
  countFinishedSubagents,
  resolveRowLabel,
} from "./track-presentation";

function row(
  overrides: Partial<PaseoSubagentRow> & Pick<PaseoSubagentRow, "id">,
): PaseoSubagentRow {
  return {
    kind: "paseo",
    id: overrides.id,
    provider: overrides.provider ?? "codex",
    title: overrides.title ?? `Agent ${overrides.id}`,
    description: null,
    subtitle: null,
    status: overrides.status ?? "idle",
    turn:
      overrides.turn ??
      (overrides.status === "running"
        ? { phase: "open", turnId: null, startedAt: null, cancellationRequestId: null }
        : { phase: "idle", cancellationRequestId: null }),
    requiresAttention: overrides.requiresAttention ?? false,
    pendingPermissionCount: overrides.pendingPermissionCount ?? 0,
    createdAt: overrides.createdAt ?? new Date("2026-04-20T00:00:00.000Z"),
  };
}

describe("buildSubagentPillPresentation", () => {
  // The real instance, so a label that names a key nobody added renders as that key and fails.
  beforeAll(async () => {
    if (!i18n.isInitialized) {
      await i18n.init();
    }
    await i18n.changeLanguage("en");
  });

  const pill = (rows: SubagentRow[]) => buildSubagentPillPresentation(i18n.t, rows);

  it("counts the children that are working, not the fan-out", () => {
    expect(pill([row({ id: "a" }), row({ id: "b", status: "running" })])).toEqual({
      segments: [{ bucket: "running", text: "1 working" }],
      accessibilityLabel: "1 working",
    });
  });

  it("counts every child in the state it reports", () => {
    expect(
      pill([
        row({ id: "a", status: "running" }),
        row({ id: "b", status: "running" }),
        row({ id: "c" }),
      ]),
    ).toEqual({
      segments: [{ bucket: "running", text: "2 working" }],
      accessibilityLabel: "2 working",
    });
  });

  it("keeps a working child visible behind a failed one instead of collapsing to the worst", () => {
    expect(
      pill([
        row({ id: "a", status: "running" }),
        row({ id: "b", status: "error", requiresAttention: true }),
        row({ id: "c", status: "error" }),
      ]),
    ).toEqual({
      segments: [
        { bucket: "failed", text: "2 failed" },
        { bucket: "running", text: "1 working" },
      ],
      accessibilityLabel: "2 failed, 1 working",
    });
  });

  it("puts a child waiting for approval ahead of the others", () => {
    expect(
      pill([
        row({ id: "a", status: "running" }),
        row({ id: "b", status: "running", pendingPermissionCount: 1 }),
        row({ id: "c", status: "error" }),
      ]),
    ).toEqual({
      segments: [
        { bucket: "needs_input", text: "1 needs input" },
        { bucket: "failed", text: "1 failed" },
        { bucket: "running", text: "1 working" },
      ],
      accessibilityLabel: "1 needs input, 1 failed, 1 working",
    });
  });

  it("names what it opens once every child is done", () => {
    expect(pill([row({ id: "a" }), row({ id: "b" })])).toEqual({
      segments: [{ bucket: null, text: "2 subagents" }],
      accessibilityLabel: "2 subagents",
    });
  });

  it("keeps the singular for a lone child", () => {
    expect(pill([row({ id: "a" })])).toEqual({
      segments: [{ bucket: null, text: "1 subagent" }],
      accessibilityLabel: "1 subagent",
    });
  });

  it("has nothing to mark without rows", () => {
    expect(pill([])).toEqual({
      segments: [{ bucket: null, text: "0 subagents" }],
      accessibilityLabel: "0 subagents",
    });
  });
});

describe("countFinishedSubagents", () => {
  it("counts eligible managed and terminal provider-owned children", () => {
    const providerRows: SubagentRow[] = [
      {
        kind: "provider",
        id: "native-running",
        parentAgentId: "parent",
        provider: "claude",
        title: "running",
        description: null,
        subtitle: null,
        status: "running",
        requiresAttention: false,
        createdAt: new Date("2026-04-20T00:00:00.000Z"),
      },
      {
        kind: "provider",
        id: "native-failed",
        parentAgentId: "parent",
        provider: "claude",
        title: "failed",
        description: null,
        subtitle: null,
        status: "failed",
        requiresAttention: true,
        createdAt: new Date("2026-04-20T00:00:01.000Z"),
      },
    ];

    expect(
      countFinishedSubagents([
        row({ id: "managed-running", status: "running" }),
        row({ id: "managed-idle", status: "idle" }),
        ...providerRows,
      ]),
    ).toBe(2);
  });

  it("excludes running and initializing managed children", () => {
    expect(
      countFinishedSubagents([
        row({ id: "running", status: "running" }),
        row({ id: "initializing", status: "initializing" }),
        row({ id: "finished", status: "idle" }),
      ]),
    ).toBe(1);
  });
});

describe("resolveRowLabel", () => {
  it("returns null when title is not a string", () => {
    expect(resolveRowLabel(null as unknown as SubagentRow["title"])).toBe(null);
  });

  it("returns null for whitespace-only titles", () => {
    expect(resolveRowLabel("   ")).toBe(null);
  });

  it("returns null for the placeholder 'new agent' regardless of case", () => {
    expect(resolveRowLabel("new agent")).toBe(null);
    expect(resolveRowLabel("New Agent")).toBe(null);
    expect(resolveRowLabel("  NEW AGENT  ")).toBe(null);
  });

  it("returns the trimmed title for real names", () => {
    expect(resolveRowLabel("  Build the thing  ")).toBe("Build the thing");
  });
});

describe("buildSubagentRowPresentationData", () => {
  it("namespaces the key with a subagent prefix", () => {
    expect(buildSubagentRowPresentationData(row({ id: "child-a" })).key).toBe(
      "paseo_subagent_child-a",
    );
  });

  it("marks the row ready when the title resolves to a real label", () => {
    const presentation = buildSubagentRowPresentationData(row({ id: "a", title: "Build it" }));
    expect(presentation.titleState).toBe("ready");
    expect(presentation.label).toBe("Build it");
  });

  it("marks the row loading and blanks the label for the placeholder title", () => {
    const presentation = buildSubagentRowPresentationData(row({ id: "a", title: "new agent" }));
    expect(presentation.titleState).toBe("loading");
    expect(presentation.label).toBe("");
  });

  it("maps a running row to the running status bucket so callers render the synced loader", () => {
    expect(buildSubagentRowPresentationData(row({ id: "a", status: "running" })).statusBucket).toBe(
      "running",
    );
  });

  it("maps an idle row to the done status bucket so callers render the static provider icon", () => {
    expect(buildSubagentRowPresentationData(row({ id: "a", status: "idle" })).statusBucket).toBe(
      "done",
    );
  });

  it("ignores requiresAttention on the source row when computing the bucket", () => {
    expect(
      buildSubagentRowPresentationData(row({ id: "a", status: "idle", requiresAttention: true }))
        .statusBucket,
    ).toBe("done");
  });

  it("puts a row waiting for approval in needs input, even while its turn is open", () => {
    expect(
      buildSubagentRowPresentationData(row({ id: "a", status: "idle", pendingPermissionCount: 1 }))
        .statusBucket,
    ).toBe("needs_input");
    expect(
      buildSubagentRowPresentationData(
        row({ id: "b", status: "running", pendingPermissionCount: 2 }),
      ).statusBucket,
    ).toBe("needs_input");
  });
});

describe("buildSubagentRowPresentationData for provider rows", () => {
  function providerRow(overrides: Partial<ProviderSubagentRow> = {}): ProviderSubagentRow {
    return {
      kind: "provider",
      id: overrides.id ?? "toolu_1",
      parentAgentId: "parent",
      provider: "claude",
      title: "title" in overrides ? (overrides.title ?? null) : "general-purpose",
      description: overrides.description ?? null,
      subtitle: overrides.subtitle ?? null,
      status: overrides.status ?? "running",
      requiresAttention: false,
      createdAt: overrides.createdAt ?? new Date("2026-07-26T00:00:00.000Z"),
    };
  }

  it("names the row after the task and demotes the subagent type", () => {
    const presentation = buildSubagentRowPresentationData(
      providerRow({ title: "general-purpose", description: "Reply with banana" }),
    );
    expect(presentation.label).toBe("Reply with banana");
    expect(presentation.subtitle).toBe("general-purpose");
  });

  it("tells two siblings of the same type apart", () => {
    const left = buildSubagentRowPresentationData(
      providerRow({ id: "a", description: "Summarize the docs" }),
    );
    const right = buildSubagentRowPresentationData(
      providerRow({ id: "b", description: "Reply with banana" }),
    );
    expect(left.label).not.toBe(right.label);
  });

  it("keeps type-as-label and an empty subtitle when a provider reports no task", () => {
    const presentation = buildSubagentRowPresentationData(
      providerRow({ title: "Provider child", description: null }),
    );
    expect(presentation.label).toBe("Provider child");
    expect(presentation.subtitle).toBe("");
  });

  it("stays in the loading state when neither field is known", () => {
    const presentation = buildSubagentRowPresentationData(
      providerRow({ title: null, description: null }),
    );
    expect(presentation.titleState).toBe("loading");
  });

  it("leaves managed subagent rows with no subtitle", () => {
    expect(buildSubagentRowPresentationData(row({ id: "a", title: "Managed" })).subtitle).toBe("");
  });
});

describe("provider-owned row subtitles", () => {
  function providerRow(overrides: Partial<ProviderSubagentRow> = {}): ProviderSubagentRow {
    return {
      kind: "provider",
      id: "toolu_1",
      parentAgentId: "parent",
      provider: "claude",
      title: "general-purpose",
      description: "Reply with banana",
      subtitle: null,
      status: "running",
      requiresAttention: false,
      createdAt: new Date("2026-07-26T00:00:00.000Z"),
      ...overrides,
    };
  }

  it("displays provider context without interpreting it", () => {
    expect(
      buildSubagentRowPresentationData(
        providerRow({ subtitle: "general-purpose · Opus 5 · High · 16.5k tokens" }),
      ).subtitle,
    ).toBe("general-purpose · Opus 5 · High · 16.5k tokens");
  });

  it("falls back to the type when an older provider sends no subtitle", () => {
    expect(buildSubagentRowPresentationData(providerRow()).subtitle).toBe("general-purpose");
  });

  it("does not duplicate the type when it is already the primary label", () => {
    expect(
      buildSubagentRowPresentationData(
        providerRow({ description: null, subtitle: null, title: "general-purpose" }),
      ).subtitle,
    ).toBe("");
  });
});

describe("dispatch group presentation", () => {
  beforeAll(async () => {
    if (!i18n.isInitialized) {
      await i18n.init();
    }
    await i18n.changeLanguage("en");
  });

  const CALL_INPUT = { title: "Write tests", provider: "codex", model: "gpt-5.4", modeId: "auto" };
  const providerLabel = (provider: string) => (provider === "codex" ? "Codex" : provider);

  function subagent(
    overrides: Partial<PaseoSubagentRow> & Pick<PaseoSubagentRow, "id">,
    extra: Partial<Omit<DispatchSubagent, "row">> = {},
  ): DispatchRowState {
    return {
      kind: "subagent",
      callId: `call-${overrides.id}`,
      input: CALL_INPUT,
      subagent: {
        row: row(overrides),
        model: "gpt-5.4",
        modeLabel: "Auto",
        pendingPermissionName: null,
        updatedAt: new Date("2026-04-20T00:02:05.000Z"),
        archived: false,
        detached: false,
        ...extra,
      },
    };
  }

  const starting: DispatchRowState = { kind: "starting", callId: "call-s", input: CALL_INPUT };

  it("counts rows in the track's order with starting before done", () => {
    const header = buildDispatchGroupHeaderPresentation(i18n.t, [
      subagent({ id: "a" }),
      starting,
      subagent({ id: "b", status: "running" }),
      subagent({ id: "c", pendingPermissionCount: 1 }),
      subagent({ id: "d", status: "error" }),
    ]);

    expect(header).toEqual({
      title: "Dispatched 5 subagents",
      segments: [
        { bucket: "needs_input", text: "1 waiting for approval" },
        { bucket: "failed", text: "1 failed" },
        { bucket: "running", text: "1 working" },
        { bucket: "starting", text: "1 starting" },
        { bucket: "done", text: "1 done" },
      ],
      accessibilityLabel:
        "Dispatched 5 subagents: 1 waiting for approval, 1 failed, 1 working, 1 starting, 1 done",
    });
  });

  it("names a lone dispatch in the singular", () => {
    expect(buildDispatchGroupHeaderPresentation(i18n.t, [starting]).title).toBe(
      "Dispatched 1 subagent",
    );
  });

  it("draws a starting row from the call input and does not open it", () => {
    expect(
      buildDispatchRowPresentation({ t: i18n.t, state: starting, providerLabelOf: providerLabel }),
    ).toEqual({
      key: "call-s",
      agentId: null,
      provider: "codex",
      label: "Write tests",
      subtitle: "Codex · gpt-5.4 · auto",
      tone: "default",
      bucket: "starting",
      timing: { kind: "starting" },
    });
  });

  it("shows provider, model, and mode under a running row and times it live", () => {
    const presentation = buildDispatchRowPresentation({
      t: i18n.t,
      state: subagent({ id: "a", title: "Write tests", status: "running" }),
      providerLabelOf: providerLabel,
    });

    expect(presentation).toMatchObject({
      agentId: "a",
      label: "Write tests",
      subtitle: "Codex · gpt-5.4 · Auto",
      bucket: "running",
      timing: { kind: "live", startedAt: new Date("2026-04-20T00:00:00.000Z") },
    });
  });

  it("swaps the subtitle for the pending tool while it waits for approval", () => {
    expect(
      buildDispatchRowPresentation({
        t: i18n.t,
        state: subagent({ id: "a", pendingPermissionCount: 1 }, { pendingPermissionName: "Bash" }),
        providerLabelOf: providerLabel,
      }),
    ).toMatchObject({
      subtitle: "Waiting for approval · Bash",
      tone: "warning",
      bucket: "needs_input",
    });
  });

  it("freezes the duration at the last update once the subagent stops", () => {
    expect(
      buildDispatchRowPresentation({
        t: i18n.t,
        state: subagent({ id: "a" }),
        providerLabelOf: providerLabel,
      }).timing,
    ).toEqual({ kind: "frozen", durationMs: 125_000 });
  });

  it("marks archived and detached rows and drops the duration the archive time would inflate", () => {
    const archived = buildDispatchRowPresentation({
      t: i18n.t,
      state: subagent({ id: "a" }, { archived: true }),
      providerLabelOf: providerLabel,
    });
    const detached = buildDispatchRowPresentation({
      t: i18n.t,
      state: subagent({ id: "b" }, { detached: true }),
      providerLabelOf: providerLabel,
    });

    expect(archived).toMatchObject({
      subtitle: "Codex · gpt-5.4 · Auto · Archived",
      bucket: "done",
      timing: { kind: "none" },
    });
    expect(detached.subtitle).toBe("Codex · gpt-5.4 · Auto · Detached");
  });

  it("names the row after the dispatched task even once the child is renamed", () => {
    const renamed = subagent({ id: "a", title: "Renamed later" });

    expect(
      buildDispatchRowPresentation({ t: i18n.t, state: renamed, providerLabelOf: providerLabel })
        .label,
    ).toBe("Write tests");
  });
});
