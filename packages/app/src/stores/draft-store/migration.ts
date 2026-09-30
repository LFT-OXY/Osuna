import type { AttachmentMetadata, UserComposerAttachment } from "@/attachments/types";
import { isLegacyNewWorkspaceDraftKey, NEW_WORKSPACE_DRAFT_KEY } from "@/stores/draft-keys";
import { z } from "zod";
import {
  inlineSegmentsText,
  leadingSkillSegments,
  type InlineSegment,
  type SkillBlock,
} from "@/inline-blocks";
import {
  AttachmentMetadataSchema,
  InlineSegmentSchema,
  LegacyDraftImageSchema,
  normalizeAttachmentMetadata,
  normalizeComposerAttachment,
  UserComposerAttachmentSchema,
  type CanonicalDraftInput,
  type DraftLifecycleState,
  type DraftRecord,
  type DraftStoreState,
  type PersistedDraftImage,
} from "./state";

const LegacyPullRequestItemSchema = z.strictObject({
  kind: z.literal("pr"),
  forge: z.string().optional(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  body: z.string().nullable(),
  labels: z.array(z.string()),
  projectPath: z.string().optional(),
  baseRefName: z.string().nullable().optional(),
  headRefName: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
});
const LegacyGithubPrAttachmentSchema = z.strictObject({
  kind: z.literal("github_pr"),
  item: LegacyPullRequestItemSchema,
  owner: z.literal("new-workspace-picker").optional(),
});
const LegacyReviewAttachmentContextLineSchema = z.strictObject({
  oldLineNumber: z.number().int().positive().nullable(),
  newLineNumber: z.number().int().positive().nullable(),
  type: z.enum(["add", "remove", "context"]),
  content: z.string(),
});
const LegacyReviewAttachmentSchema = z.strictObject({
  kind: z.literal("review"),
  reviewDraftKey: z.string(),
  commentCount: z.number().int().nonnegative(),
  attachment: z.strictObject({
    type: z.literal("review"),
    mimeType: z.literal("application/paseo-review"),
    cwd: z.string(),
    mode: z.enum(["uncommitted", "base"]),
    baseRef: z.string().nullable().optional(),
    comments: z.array(
      z.strictObject({
        filePath: z.string(),
        side: z.enum(["old", "new"]),
        lineNumber: z.number().int().positive(),
        body: z.string(),
        context: z.strictObject({
          hunkHeader: z.string(),
          targetLine: LegacyReviewAttachmentContextLineSchema,
          lines: z.array(LegacyReviewAttachmentContextLineSchema),
        }),
      }),
    ),
  }),
});
const PersistedComposerAttachmentSchema = z.union([
  UserComposerAttachmentSchema,
  LegacyGithubPrAttachmentSchema,
  LegacyReviewAttachmentSchema,
]);
type PersistedComposerAttachment = z.infer<typeof PersistedComposerAttachmentSchema>;
const LegacyAttachmentMetadataSchema = AttachmentMetadataSchema.extend({
  previewUri: z.string(),
});
type PersistedImage = PersistedDraftImage | z.infer<typeof LegacyAttachmentMetadataSchema>;

// COMPAT(skill-chip-draft): added after v0.12.0, remove after 2027-03-29.
// 升级前的草稿把 Command menu 选中的 skill 存成 Attachment tray 里的 chip，正文不含 `/name`。
const LegacySkillChipSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().optional(),
});

const RawDraftInputSchema = z.strictObject({
  text: z.string().optional(),
  attachments: z.array(PersistedComposerAttachmentSchema).optional(),
  images: z
    .array(
      z.union([AttachmentMetadataSchema, LegacyAttachmentMetadataSchema, LegacyDraftImageSchema]),
    )
    .optional(),
  // COMPAT(skill-chip-draft): added after v0.12.0, remove after 2027-03-29.
  skills: z.array(LegacySkillChipSchema).optional(),
  segments: z.array(InlineSegmentSchema).optional(),
  cwd: z.string().optional(),
});
const DraftLifecycleSchema = z.enum(["active", "abandoned", "sent"]);
const NestedDraftRecordSchema = z.strictObject({
  input: RawDraftInputSchema,
  lifecycle: DraftLifecycleSchema.optional(),
  updatedAt: z.number().optional(),
  version: z.number().int().positive().optional(),
});
const FlatDraftRecordSchema = RawDraftInputSchema.extend({
  lifecycle: DraftLifecycleSchema.optional(),
  updatedAt: z.number().optional(),
  version: z.number().int().positive().optional(),
});
const PersistedDraftRecordSchema = z.union([NestedDraftRecordSchema, FlatDraftRecordSchema]);
export const PersistedDraftStoreSchema = z.strictObject({
  drafts: z.record(z.string(), PersistedDraftRecordSchema).optional(),
  createModalDraft: PersistedDraftRecordSchema.nullable().optional(),
});
type PersistedDraftRecord = z.infer<typeof PersistedDraftRecordSchema>;

export type MigrateLegacyImages = (
  images: readonly PersistedDraftImage[],
) => Promise<AttachmentMetadata[]>;

function normalizePersistedImage(value: PersistedImage): PersistedDraftImage {
  if ("id" in value) {
    return normalizeAttachmentMetadata(value);
  }
  return {
    uri: value.uri,
    ...(value.mimeType ? { mimeType: value.mimeType } : {}),
  };
}

function legacyImagesToAttachments(
  images: readonly AttachmentMetadata[],
): UserComposerAttachment[] {
  return images.map((metadata) => ({
    kind: "image",
    metadata,
  }));
}

function normalizePersistedComposerAttachment(
  attachment: PersistedComposerAttachment,
): UserComposerAttachment | null {
  if (attachment.kind === "review") {
    return null;
  }
  if (attachment.kind === "github_pr" && attachment.item.kind === "pr") {
    return {
      kind: "github_pr",
      item: { ...attachment.item, kind: "change_request" },
      ...(attachment.owner ? { owner: attachment.owner } : {}),
    };
  }
  const result = UserComposerAttachmentSchema.safeParse(attachment);
  if (!result.success) {
    throw new Error("Persisted composer attachment failed validation after migration");
  }
  return normalizeComposerAttachment(result.data);
}

interface MigratedDraftText {
  text: string;
  segments?: InlineSegment[];
}

// COMPAT(skill-chip-draft): added after v0.12.0, remove after 2027-03-29.
// chip 变成正文开头的 Skill block，与现在从 Command menu 选中的一样。
function foldLegacySkillChips(rawInput: z.infer<typeof RawDraftInputSchema>): MigratedDraftText {
  const text = rawInput.text ?? "";
  const segments = rawInput.segments ?? (text ? [{ type: "text" as const, text }] : []);
  if (!rawInput.skills?.length) {
    return { text, ...(rawInput.segments ? { segments: rawInput.segments } : {}) };
  }
  const blocks = rawInput.skills.map(
    (chip): SkillBlock =>
      chip.description === undefined
        ? { kind: "skill", name: chip.name }
        : { kind: "skill", name: chip.name, description: chip.description },
  );
  const folded = leadingSkillSegments(blocks, segments);
  return { text: inlineSegmentsText(folded), segments: folded };
}

export async function migrateDraftInput(
  input: { rawInput: unknown },
  ports: { migrateLegacyImages: MigrateLegacyImages },
): Promise<CanonicalDraftInput> {
  const result = RawDraftInputSchema.safeParse(input.rawInput);
  const rawInput = result.success ? result.data : {};
  const attachments = (rawInput.attachments ?? [])
    .map(normalizePersistedComposerAttachment)
    .filter((attachment): attachment is UserComposerAttachment => attachment !== null);
  const legacyImages = (rawInput.images ?? []).map(normalizePersistedImage);
  const migratedImages = await ports.migrateLegacyImages(legacyImages);

  return {
    ...foldLegacySkillChips(rawInput),
    attachments: [...attachments, ...legacyImagesToAttachments(migratedImages)],
  };
}

function resolvePersistedLifecycle(
  lifecycle: DraftLifecycleState | undefined,
): DraftLifecycleState {
  return lifecycle ?? "active";
}

function extractRawInput(record: PersistedDraftRecord): z.infer<typeof RawDraftInputSchema> {
  if ("input" in record) {
    return record.input;
  }
  return record;
}

async function buildMigratedDraftRecord(
  parsed: PersistedDraftRecord,
  ports: { migrateLegacyImages: MigrateLegacyImages },
  nowMs: number,
): Promise<DraftRecord> {
  return {
    input: await migrateDraftInput({ rawInput: extractRawInput(parsed) }, ports),
    lifecycle: resolvePersistedLifecycle(parsed.lifecycle),
    updatedAt: parsed.updatedAt ?? nowMs,
    version: parsed.version ?? 1,
  };
}

function migrateNewWorkspaceDraftKeys(
  drafts: Record<string, DraftRecord>,
): Record<string, DraftRecord> {
  const legacyEntries = Object.entries(drafts).filter(([draftKey]) =>
    isLegacyNewWorkspaceDraftKey(draftKey),
  );
  if (legacyEntries.length === 0) {
    return drafts;
  }

  const nextDrafts = { ...drafts };
  for (const [draftKey] of legacyEntries) {
    delete nextDrafts[draftKey];
  }

  if (nextDrafts[NEW_WORKSPACE_DRAFT_KEY]) {
    return nextDrafts;
  }

  const newestActiveDraft = legacyEntries
    .map(([, draft]) => draft)
    .filter((draft) => draft.lifecycle === "active")
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  if (newestActiveDraft) {
    // Legacy scoped drafts did not record whether a PR came from the Base
    // picker. That checkout context is unsafe to carry onto a global surface.
    nextDrafts[NEW_WORKSPACE_DRAFT_KEY] = {
      ...newestActiveDraft,
      input: {
        ...newestActiveDraft.input,
        attachments: newestActiveDraft.input.attachments.filter(
          (attachment) => attachment.kind !== "github_pr",
        ),
      },
    };
  }

  return nextDrafts;
}

export async function migratePersistedState(
  state: unknown,
  ports: { migrateLegacyImages: MigrateLegacyImages; nowMs: number },
): Promise<DraftStoreState> {
  const result = PersistedDraftStoreSchema.safeParse(state);
  const input = result.success ? result.data : {};

  const nextDrafts: Record<string, DraftRecord> = {};
  for (const [draftKey, rawRecord] of Object.entries(input.drafts ?? {})) {
    nextDrafts[draftKey] = await buildMigratedDraftRecord(rawRecord, ports, ports.nowMs);
  }

  let createModalDraft: DraftRecord | null = null;
  if (input.createModalDraft) {
    createModalDraft = await buildMigratedDraftRecord(input.createModalDraft, ports, ports.nowMs);
  }

  return {
    // COMPAT(newWorkspaceDraftSingleton): migrated in v0.1.108; remove after 2027-01-13.
    drafts: migrateNewWorkspaceDraftKeys(nextDrafts),
    createModalDraft,
  };
}
