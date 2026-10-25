import type { DaemonConfigStore } from "./daemon-config-store.js";

/**
 * The one answer to "may Osuna read the logins the CLIs keep for themselves" (Read CLI sign-ins).
 * Every gate asks this instead of reading the daemon config itself.
 */
export class CliSignInAccess {
  constructor(private readonly configStore: Pick<DaemonConfigStore, "get" | "onFieldChange">) {}

  allowed(): boolean {
    const config = this.configStore.get();
    return config.readCliSignInsForcedOff !== true && config.readCliSignIns !== false;
  }

  /** Called with the new answer each time it changes; returns the unsubscribe. */
  onChange(listener: (allowed: boolean) => void): () => void {
    return this.configStore.onFieldChange("readCliSignIns", () => listener(this.allowed()));
  }
}

/** An operation that needs a CLI's own login was refused because Read CLI sign-ins is off. */
export class CliSignInsOffError extends Error {
  /** What the client shows; the message is for the log. */
  readonly userMessage: string;

  constructor(
    readonly operation: "usage_reset" | "usage_fetch",
    readonly reportId: string,
  ) {
    super(`Refused ${operation} for ${reportId}: Read CLI sign-ins is off`);
    this.name = "CliSignInsOffError";
    this.userMessage =
      operation === "usage_reset"
        ? "Read CLI sign-ins is off, so a reset can't be used"
        : "Read CLI sign-ins is off, so usage isn't read";
  }
}

/** A change to Read CLI sign-ins was refused because PASEO_NO_CLI_SIGN_INS holds it off for this run. */
export class CliSignInsForcedOffError extends Error {
  /** What the client shows; the message is for the log. */
  readonly userMessage: string;

  constructor(readonly requested: boolean) {
    super(`Refused to set readCliSignIns=${requested}: PASEO_NO_CLI_SIGN_INS is set`);
    this.name = "CliSignInsForcedOffError";
    this.userMessage =
      "Read CLI sign-ins is held off by PASEO_NO_CLI_SIGN_INS, so it can't be changed here";
  }
}
