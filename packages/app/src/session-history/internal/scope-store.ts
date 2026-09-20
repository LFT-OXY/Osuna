import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { SESSION_HISTORY_SCOPES, type SessionHistoryScope } from "./model";

const SESSION_HISTORY_SCOPE_STORAGE_KEY = "session-history-scope";
const SESSION_HISTORY_SCOPE_STORE_VERSION = 1;
const DEFAULT_SESSION_HISTORY_SCOPE: SessionHistoryScope = "project";

/**
 * Which slice of the host the Session history view lists. One choice per
 * device, not per workspace: the user picks how wide they want to look, and
 * that preference follows them across projects.
 */
interface SessionHistoryScopeStoreState {
  scope: SessionHistoryScope;
  setScope: (scope: SessionHistoryScope) => void;
}

interface SessionHistoryScopePersistedState {
  scope: SessionHistoryScope;
}

const SessionHistoryScopePersistedStateSchema = z.strictObject({
  scope: z.enum(SESSION_HISTORY_SCOPES).optional(),
});

export function migrateSessionHistoryScopeState(
  persistedState: unknown,
): SessionHistoryScopePersistedState {
  const result = SessionHistoryScopePersistedStateSchema.safeParse(persistedState);
  const storedScope = result.success ? result.data.scope : undefined;
  return { scope: storedScope ?? DEFAULT_SESSION_HISTORY_SCOPE };
}

export const useSessionHistoryScopeStore = create<SessionHistoryScopeStoreState>()(
  persist(
    (set) => ({
      scope: DEFAULT_SESSION_HISTORY_SCOPE,
      setScope: (scope) => set({ scope }),
    }),
    {
      name: SESSION_HISTORY_SCOPE_STORAGE_KEY,
      version: SESSION_HISTORY_SCOPE_STORE_VERSION,
      storage: createValidatedPersistStorage(AsyncStorage, SessionHistoryScopePersistedStateSchema),
      partialize: (state) => ({ scope: state.scope }),
      migrate: migrateSessionHistoryScopeState,
    },
  ),
);
