import { z } from "zod";

const TCP_PORT_RANGE_PATTERN = /^(\d{1,5})-(\d{1,5})$/;

export const OsunaServicePortAllocationSchema = z
  .object({
    range: z.string().trim().regex(TCP_PORT_RANGE_PATTERN).optional(),
    portScript: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (value) => value.range !== undefined || value.portScript !== undefined,
    "Expected range or portScript",
  )
  .refine((value) => {
    if (!value.range) return true;
    const match = TCP_PORT_RANGE_PATTERN.exec(value.range);
    if (!match) return false;
    const start = Number(match[1]);
    const end = Number(match[2]);
    return start >= 1 && end <= 65_535 && start <= end;
  }, "Expected an inclusive TCP port range from 1-65535");

export function normalizeLifecycleCommands(commands: unknown): string[] {
  if (typeof commands === "string") {
    return commands.trim().length > 0 ? [commands] : [];
  }
  if (!Array.isArray(commands)) {
    return [];
  }
  return commands.filter((command): command is string => {
    return typeof command === "string" && command.trim().length > 0;
  });
}

export const OsunaLifecycleCommandRawSchema = z.union([z.string(), z.array(z.string())]);

export const OsunaScriptEntryRawSchema = z
  .object({
    type: z.unknown().optional(),
    command: z.unknown().optional(),
    port: z.unknown().optional(),
  })
  .passthrough();

export const OsunaWorktreeConfigRawSchema = z
  .object({
    setup: OsunaLifecycleCommandRawSchema.optional(),
    teardown: OsunaLifecycleCommandRawSchema.optional(),
    terminals: z.unknown().optional(),
    servicePorts: OsunaServicePortAllocationSchema.optional(),
  })
  .passthrough();

export const OsunaMetadataGenerationEntrySchema = z
  .object({
    instructions: z.string().optional(),
  })
  .passthrough()
  .catch({});

export const OsunaMetadataGenerationSchema = z
  .object({
    title: OsunaMetadataGenerationEntrySchema.optional(),
    branchName: OsunaMetadataGenerationEntrySchema.optional(),
    commitMessage: OsunaMetadataGenerationEntrySchema.optional(),
    pullRequest: OsunaMetadataGenerationEntrySchema.optional(),
  })
  // COMPAT(projectMetadataAgentTitle): `agentTitle` project metadata prompts were removed
  // in v0.1.96; keep config files that still carry it parseable until 2026-12-16. Those
  // files predate the Osuna rename, so on disk they are named `paseo.json`, not
  // `osuna.json` — this shim is about the unknown key, not the filename.
  .passthrough()
  .catch({});

export const OsunaConfigRawSchema = z
  .object({
    worktree: OsunaWorktreeConfigRawSchema.optional(),
    scripts: z.record(z.string(), OsunaScriptEntryRawSchema).optional(),
    metadataGeneration: OsunaMetadataGenerationSchema.optional(),
  })
  .passthrough();

export const WorktreeConfigSchema = OsunaWorktreeConfigRawSchema.extend({
  setup: z.unknown().optional().transform(normalizeLifecycleCommands),
  teardown: z.unknown().optional().transform(normalizeLifecycleCommands),
})
  .passthrough()
  .catch({ setup: [], teardown: [] });

export const ScriptEntrySchema = OsunaScriptEntryRawSchema.catch({});

export const OsunaConfigSchema = OsunaConfigRawSchema.extend({
  worktree: WorktreeConfigSchema.optional(),
  scripts: z.record(z.string(), ScriptEntrySchema).optional().catch({}),
  metadataGeneration: OsunaMetadataGenerationSchema.optional(),
})
  .passthrough()
  .catch({});

export const OsunaConfigRevisionSchema = z.object({
  mtimeMs: z.number(),
  size: z.number(),
});

export const ProjectConfigRpcErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("project_not_found") }),
  z.object({ code: z.literal("invalid_project_config") }),
  z.object({
    code: z.literal("stale_project_config"),
    currentRevision: OsunaConfigRevisionSchema.nullable(),
  }),
  z.object({ code: z.literal("write_failed") }),
]);

export type OsunaScriptEntryRaw = z.infer<typeof OsunaScriptEntryRawSchema>;
export type OsunaMetadataGenerationEntry = z.infer<typeof OsunaMetadataGenerationEntrySchema>;
export type OsunaMetadataGeneration = z.infer<typeof OsunaMetadataGenerationSchema>;
export type OsunaServicePortAllocation = z.infer<typeof OsunaServicePortAllocationSchema>;
export type OsunaConfigRaw = z.infer<typeof OsunaConfigRawSchema>;
export type OsunaConfig = z.infer<typeof OsunaConfigSchema>;
export type OsunaConfigRevision = z.infer<typeof OsunaConfigRevisionSchema>;
export type ProjectConfigRpcError = z.infer<typeof ProjectConfigRpcErrorSchema>;
