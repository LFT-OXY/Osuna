import { describe, expect, it } from "vitest";
import type { PersistStorage, StateStorage, StorageValue } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { PersistedDraftStoreSchema } from "./migration";
import {
  createDraftPersistStorage,
  DRAFT_PERSIST_INTERVAL_MS,
  type PersistenceScheduler,
} from "./persistence";
import {
  DraftStoreStateSchema,
  editDraftRecordText,
  hasDraftContent,
  selectDraftSkillChips,
  toDraftInputIfReady,
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

describe("draft persistence of skill chips", () => {
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

  it("reads back the skill chips it wrote with the draft", async () => {
    const { storage } = createPersistedDrafts();
    const record = {
      input: {
        text: "fix the flaky test",
        attachments: [],
        skills: [{ name: "atw-askme", description: "Ask me first" }, { name: "atw-tdd" }],
      },
      lifecycle: "active" as const,
      updatedAt: 1,
      version: 1,
    };

    await storage.setItem("paseo-drafts", {
      state: { drafts: { "agent:a": record }, createModalDraft: null },
      version: 5,
    });
    await storage.flush();
    const restored = DraftStoreStateSchema.parse((await storage.getItem("paseo-drafts"))?.state);

    expect(toDraftInputIfReady(restored.drafts["agent:a"])).toEqual(record.input);
  });

  it("keeps a chip-only draft active after reading it back", async () => {
    const { storage } = createPersistedDrafts();
    const skills = [{ name: "atw-askme" }];

    await storage.setItem("paseo-drafts", {
      state: {
        drafts: {
          "agent:a": {
            input: { text: "", attachments: [], skills },
            lifecycle: "active",
            updatedAt: 1,
            version: 1,
          },
        },
        createModalDraft: null,
      },
      version: 5,
    });
    await storage.flush();
    const restored = DraftStoreStateSchema.parse((await storage.getItem("paseo-drafts"))?.state);
    const record = restored.drafts["agent:a"];
    const draft = toDraftInputIfReady(record);

    expect(draft).toEqual({ text: "", attachments: [], skills });
    expect(draft && hasDraftContent(draft)).toBe(true);
    expect(editDraftRecordText(record, "", 2).lifecycle).toBe("active");
  });

  it("reads a draft saved before skill chips existed with no chips", async () => {
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
    const record = restored.drafts["agent:a"];

    expect(record?.input).toEqual({ text: "hello", attachments: [] });
    expect(selectDraftSkillChips(record)).toEqual([]);
  });
});
