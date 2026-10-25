import type { DaemonConfigStore } from "./daemon-config-store.js";

/**
 * The one answer to "may Osuna read the logins the CLIs keep for themselves" (Read CLI sign-ins).
 * Every gate asks this instead of reading the daemon config itself.
 */
export class CliSignInAccess {
  constructor(private readonly configStore: Pick<DaemonConfigStore, "get" | "onFieldChange">) {}

  allowed(): boolean {
    return this.configStore.get().readCliSignIns !== false;
  }

  /** Called with the new answer each time it changes; returns the unsubscribe. */
  onChange(listener: (allowed: boolean) => void): () => void {
    return this.configStore.onFieldChange("readCliSignIns", () => listener(this.allowed()));
  }
}
