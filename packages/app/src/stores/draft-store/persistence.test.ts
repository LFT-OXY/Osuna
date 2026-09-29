import { describe, expect, it } from "vitest";
import type { PersistStorage, StateStorage, StorageValue } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { migrateDraftInput, PersistedDraftStoreSchema } from "./migration";
import {
  createDraftPersistStorage,
  DRAFT_PERSIST_INTERVAL_MS,
  type PersistenceScheduler,
} from "./persistence";
import {
  DraftStoreStateSchema,
  editDraftRecordText,
  hasDraftContent,
  isCanonicalDraftInput,
  toDraftInputIfReady,
  type DraftRecord,
} from "./state";

interface DraftState {
  text: string;
}

function createDraftPersistence() {
  let nowMs = 0;
  let saved: StorageValue<DraftState> | null = null;
  let scheduled: { callback: () => void; dueAt: number } | null = null;
  const storage: PersistStorage<DraftState> = {
    getItem: () => saved,
    setItem: (_name, value) => {
      saved = value;
    },
    removeItem: () => {
      saved = null;
    },
  };
  const scheduler: PersistenceScheduler = {
    now: () => nowMs,
    schedule: (callback, delayMs) => (scheduled = { callback, dueAt: nowMs + delayMs }),
    cancel: () => {
      scheduled = null;
    },
  };
  const drafts = createDraftPersistStorage(storage, scheduler);

  return {
    save(text: string) {
      drafts.setItem("drafts", { state: { text } });
    },
    remove() {
      drafts.removeItem("drafts");
    },
    flush() {
      return drafts.flush();
    },
    advance(ms: number) {
      nowMs += ms;
      if (scheduled && scheduled.dueAt <= nowMs) {
        const { callback } = scheduled;
        scheduled = null;
        callback();
      }
    },
    text() {
      return saved?.state.text ?? null;
    },
  };
}

describe("draft persistence", () => {
  it("checkpoints the first change and the latest change in each interval", () => {
    const drafts = createDraftPersistence();

    drafts.save("a");
    drafts.save("ab");
    drafts.save("abc");
    expect(drafts.text()).toBe("a");

    drafts.advance(DRAFT_PERSIST_INTERVAL_MS - 1);
    expect(drafts.text()).toBe("a");

    drafts.advance(1);
    expect(drafts.text()).toBe("abc");
  });

  it("does not restore a pending draft after storage is cleared", () => {
    const drafts = createDraftPersistence();

    drafts.save("first checkpoint");
    drafts.save("pending checkpoint");
    drafts.remove();
    drafts.advance(DRAFT_PERSIST_INTERVAL_MS);

    expect(drafts.text()).toBeNull();
  });

  it("continues checkpointing the latest change across consecutive intervals", () => {
    const drafts = createDraftPersistence();

    drafts.save("first");
    drafts.save("first interval");
    drafts.advance(DRAFT_PERSIST_INTERVAL_MS);
    expect(drafts.text()).toBe("first interval");

    drafts.save("second");
    drafts.save("second interval");
    drafts.advance(DRAFT_PERSIST_INTERVAL_MS);
    expect(drafts.text()).toBe("second interval");
  });

  it("flushes the latest pending change before the interval ends", async () => {
    const drafts = createDraftPersistence();

    drafts.save("first checkpoint");
    drafts.save("pending checkpoint");
    await drafts.flush();

    expect(drafts.text()).toBe("pending checkpoint");
  });
});

describe("draft persistence of legacy skill chips", () => {
  function createPersistedDrafts() {
    const values = new Map<string, string>();
    const backing: StateStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
      removeItem: (key) => {
        values.delete(key);
      },
    };
    return {
      values,
      storage: createDraftPersistStorage(
        createValidatedPersistStorage(backing, PersistedDraftStoreSchema),
      ),
    };
  }

  async function readBackLegacyInput(input: Record<string, unknown>) {
    const { storage, values } = createPersistedDrafts();
    values.set(
      "paseo-drafts",
      JSON.stringify({
        state: {
          drafts: { "agent:a": { input, lifecycle: "active", updatedAt: 1, version: 1 } },
          createModalDraft: null,
        },
        version: 5,
      }),
    );
    const record = (await storage.getItem("paseo-drafts"))?.state.drafts?.["agent:a"];
    if (!record || !("input" in record)) throw new Error("the legacy draft did not read back");
    // 带 skills 的草稿不是当前形状，启动时走 hydrateDraftInput 的迁移。
    expect(isCanonicalDraftInput(record.input)).toBe(false);
    return migrateDraftInput({ rawInput: record.input }, { migrateLegacyImages: async () => [] });
  }

  it("reads the skills of a draft saved with skill chips as leading Skill blocks", async () => {
    const draft = await readBackLegacyInput({
      text: "fix the flaky test",
      attachments: [],
      skills: [{ name: "atw-askme", description: "Ask me first" }, { name: "atw-tdd" }],
    });

    expect(draft).toEqual({
      text: "/atw-askme /atw-tdd fix the flaky test",
      attachments: [],
      segments: [
        { type: "block", block: { kind: "skill", name: "atw-askme", description: "Ask me first" } },
        { type: "text", text: " " },
        { type: "block", block: { kind: "skill", name: "atw-tdd" } },
        { type: "text", text: " fix the flaky test" },
      ],
    });
    expect(
      toDraftInputIfReady({ input: draft, lifecycle: "active", updatedAt: 2, version: 2 }),
    ).toEqual(draft);
  });

  it("keeps the blocks already in a skill-chip draft's segments", async () => {
    const file = { kind: "file", path: "src/x.ts", entryKind: "file" } as const;
    const draft = await readBackLegacyInput({
      text: "see [x.ts](src/x.ts)",
      attachments: [],
      skills: [{ name: "atw-tdd" }],
      segments: [
        { type: "text", text: "see " },
        { type: "block", block: file },
      ],
    });

    expect(draft.text).toBe("/atw-tdd see [x.ts](src/x.ts)");
    expect(draft.segments).toEqual([
      { type: "block", block: { kind: "skill", name: "atw-tdd" } },
      { type: "text", text: " see " },
      { type: "block", block: file },
    ]);
  });

  it("keeps a chip-only draft active", async () => {
    const draft = await readBackLegacyInput({
      text: "",
      attachments: [],
      skills: [{ name: "atw-askme" }],
    });

    expect(draft.text).toBe("/atw-askme ");
    expect(hasDraftContent(draft)).toBe(true);
  });

  it("reads a draft saved before skill chips existed as it was", async () => {
    const { storage, values } = createPersistedDrafts();
    values.set(
      "paseo-drafts",
      JSON.stringify({
        state: {
          drafts: {
            "agent:a": {
              input: { text: "hello", attachments: [] },
              lifecycle: "active",
              updatedAt: 1,
              version: 1,
            },
          },
          createModalDraft: null,
        },
        version: 5,
      }),
    );

    const restored = DraftStoreStateSchema.parse((await storage.getItem("paseo-drafts"))?.state);

    expect(toDraftInputIfReady(restored.drafts["agent:a"])).toEqual({
      text: "hello",
      attachments: [],
    });
  });
});

describe("draft persistence of inline segments", () => {
  function createPersistedDrafts() {
    const values = new Map<string, string>();
    const backing: StateStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
      removeItem: (key) => {
        values.delete(key);
      },
    };
    return {
      values,
      storage: createDraftPersistStorage(
        createValidatedPersistStorage(backing, PersistedDraftStoreSchema),
      ),
    };
  }

  async function writeAndReadBack(record: DraftRecord): Promise<DraftRecord | undefined> {
    const { storage } = createPersistedDrafts();
    await storage.setItem("paseo-drafts", {
      state: { drafts: { "agent:a": record }, createModalDraft: null },
      version: 5,
    });
    await storage.flush();
    const restored = DraftStoreStateSchema.parse((await storage.getItem("paseo-drafts"))?.state);
    return restored.drafts["agent:a"];
  }

  it("reads back the segments it wrote with the draft", async () => {
    const input = {
      text: "see [x.ts](src/x.ts) and [@Claude](paseo://agent/claude) typed [y](y)",
      attachments: [],
      segments: [
        { type: "text" as const, text: "see " },
        {
          type: "block" as const,
          block: { kind: "file" as const, path: "src/x.ts", entryKind: "file" as const },
        },
        { type: "text" as const, text: " and " },
        {
          type: "block" as const,
          block: { kind: "agent" as const, target: "claude", name: "Claude" },
        },
        { type: "text" as const, text: " typed [y](y)" },
      ],
    };

    const record = await writeAndReadBack({
      input,
      lifecycle: "active",
      updatedAt: 1,
      version: 1,
    });

    expect(toDraftInputIfReady(record)).toEqual(input);
  });

  it("makes a block-only draft active and keeps it active after reading it back", async () => {
    const segments = [
      {
        type: "block" as const,
        block: { kind: "file" as const, path: "docs", entryKind: "directory" as const },
      },
    ];
    const written = editDraftRecordText({
      record: undefined,
      text: "[docs](docs/)",
      segments,
      now: 1,
    });
    expect(written.lifecycle).toBe("active");

    const record = await writeAndReadBack(written);
    const draft = toDraftInputIfReady(record);

    expect(draft).toEqual({ text: "[docs](docs/)", attachments: [], segments });
    expect(draft && hasDraftContent(draft)).toBe(true);
    expect(editDraftRecordText({ record, text: "[docs](docs/)", segments, now: 2 })).toBe(record);
  });

  it("drops the segments when the text is edited without them", () => {
    const record: DraftRecord = {
      input: {
        text: "[x.ts](x.ts)",
        attachments: [],
        segments: [{ type: "block", block: { kind: "file", path: "x.ts", entryKind: "file" } }],
      },
      lifecycle: "active",
      updatedAt: 1,
      version: 1,
    };

    const edited = editDraftRecordText({
      record,
      text: "[x.ts](x.ts)",
      segments: undefined,
      now: 2,
    });

    expect(edited.input).toEqual({ text: "[x.ts](x.ts)", attachments: [] });
  });

  it("does not store segments that hold no block", () => {
    const edited = editDraftRecordText({
      record: undefined,
      text: "typed [x.ts](x.ts)",
      segments: [{ type: "text", text: "typed [x.ts](x.ts)" }],
      now: 1,
    });

    expect(edited.input).toEqual({ text: "typed [x.ts](x.ts)", attachments: [] });
  });

  it("reads a draft saved before segments existed as plain text", async () => {
    const { storage, values } = createPersistedDrafts();
    values.set(
      "paseo-drafts",
      JSON.stringify({
        state: {
          drafts: {
            "agent:a": {
              input: { text: "[x.ts](x.ts)", attachments: [] },
              lifecycle: "active",
              updatedAt: 1,
              version: 1,
            },
          },
          createModalDraft: null,
        },
        version: 5,
      }),
    );

    const restored = DraftStoreStateSchema.parse((await storage.getItem("paseo-drafts"))?.state);

    expect(toDraftInputIfReady(restored.drafts["agent:a"])).toEqual({
      text: "[x.ts](x.ts)",
      attachments: [],
    });
  });
});
