import { promises as fs } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import { z } from "zod";

import { writeJsonFileAtomic } from "../atomic-file.js";
import type { AgentProvider, AgentSlashCommand } from "./agent-sdk-types.js";

const MAX_CATALOG_ENTRIES = 200;

const CachedCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  argumentHint: z.string(),
  kind: z.enum(["command", "skill"]).optional(),
});

const CatalogEntrySchema = z.object({
  provider: z.string(),
  cwd: z.string(),
  updatedAt: z.string(),
  commands: z.array(CachedCommandSchema),
});

const CatalogFileSchema = z.object({
  entries: z.array(CatalogEntrySchema),
});

type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

export interface CommandCatalogLookupInput {
  provider: AgentProvider;
  cwd: string;
  /** The running process's own list; null when no process is running. */
  live: AgentSlashCommand[] | null;
  /** Directory scan plus built-ins from the provider client. */
  discovered: AgentSlashCommand[];
}

export interface CommandCatalogResult {
  commands: AgentSlashCommand[];
  /** True when neither a live nor a cached process report exists for this provider + cwd. */
  partial: boolean;
}

export interface CommandCatalogRecordInput {
  provider: AgentProvider;
  cwd: string;
  commands: AgentSlashCommand[];
}

export interface CommandCatalogOptions {
  /** JSON file under $OSUNA_HOME; omit to keep the cache in memory only. */
  filePath?: string;
  logger: Logger;
}

/**
 * Per provider + cwd command list, merged from the last process report (kept on disk),
 * a no-process directory scan, and built-ins. See docs/adr/0003-command-list-never-spawns.md.
 */
export class CommandCatalog {
  private readonly filePath: string | undefined;
  private readonly logger: Logger;
  private entries: Map<string, CatalogEntry> | null = null;
  private loading: Promise<Map<string, CatalogEntry>> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: CommandCatalogOptions) {
    this.filePath = options.filePath;
    this.logger = options.logger.child({ component: "command-catalog" });
  }

  async lookup(input: CommandCatalogLookupInput): Promise<CommandCatalogResult> {
    if (input.live) {
      await this.record({ provider: input.provider, cwd: input.cwd, commands: input.live });
    }
    const entries = await this.load();
    const reported = entries.get(catalogKey(input.provider, input.cwd))?.commands ?? null;
    return {
      commands: mergeCommands(reported ?? [], input.discovered),
      partial: reported === null,
    };
  }

  /** Replace the stored process report for this provider + cwd. */
  async record(input: CommandCatalogRecordInput): Promise<void> {
    const entries = await this.load();
    const key = catalogKey(input.provider, input.cwd);
    const commands = input.commands.map(toCachedCommand);
    const previous = entries.get(key);
    if (previous && JSON.stringify(previous.commands) === JSON.stringify(commands)) {
      return;
    }
    entries.delete(key);
    entries.set(key, {
      provider: input.provider,
      cwd: normalizeCatalogCwd(input.cwd),
      updatedAt: new Date().toISOString(),
      commands,
    });
    // Map keeps insertion order, so the first keys are the least recently reported.
    for (const staleKey of entries.keys()) {
      if (entries.size <= MAX_CATALOG_ENTRIES) break;
      entries.delete(staleKey);
    }
    await this.persist(entries);
  }

  private load(): Promise<Map<string, CatalogEntry>> {
    if (this.entries) {
      return Promise.resolve(this.entries);
    }
    this.loading ??= this.readFile().then((entries) => {
      this.entries = entries;
      return entries;
    });
    return this.loading;
  }

  private async readFile(): Promise<Map<string, CatalogEntry>> {
    const entries = new Map<string, CatalogEntry>();
    if (!this.filePath) {
      return entries;
    }
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        this.logger.warn({ err: error, filePath: this.filePath }, "Failed to read command catalog");
      }
      return entries;
    }
    let parsed: z.infer<typeof CatalogFileSchema>;
    try {
      parsed = CatalogFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      this.logger.warn(
        { err: error, filePath: this.filePath },
        "Ignoring unreadable command catalog",
      );
      return entries;
    }
    const byUpdatedAt = [...parsed.entries].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    for (const entry of byUpdatedAt) {
      entries.set(catalogKey(entry.provider, entry.cwd), entry);
    }
    return entries;
  }

  private persist(entries: Map<string, CatalogEntry>): Promise<void> {
    const filePath = this.filePath;
    if (!filePath) {
      return Promise.resolve();
    }
    const snapshot = CatalogFileSchema.parse({ entries: Array.from(entries.values()) });
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => writeJsonFileAtomic(filePath, snapshot));
    return this.writeChain.catch((error: unknown) => {
      this.logger.warn({ err: error, filePath }, "Failed to write command catalog");
    });
  }
}

function normalizeCatalogCwd(cwd: string): string {
  return path.resolve(cwd);
}

function catalogKey(provider: string, cwd: string): string {
  return `${provider}\u0000${normalizeCatalogCwd(cwd)}`;
}

function toCachedCommand(command: AgentSlashCommand): AgentSlashCommand {
  return {
    name: command.name,
    description: command.description,
    argumentHint: command.argumentHint,
    ...(command.kind ? { kind: command.kind } : {}),
  };
}

/** The process report wins on name clashes; discovery only fills names it lacks. */
function mergeCommands(
  reported: AgentSlashCommand[],
  discovered: AgentSlashCommand[],
): AgentSlashCommand[] {
  const byName = new Map<string, AgentSlashCommand>();
  for (const command of [...reported, ...discovered]) {
    if (!byName.has(command.name)) {
      byName.set(command.name, command);
    }
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}
