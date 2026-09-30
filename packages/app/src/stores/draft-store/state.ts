import {
  NEW_WORKSPACE_PICKER_ATTACHMENT_OWNER,
  type AttachmentMetadata,
  type UserComposerAttachment,
} from "@/attachments/types";
import { hasInlineBlock, isInlineSegment, type InlineSegment } from "@/inline-blocks";
import { PluginResourceComposerAttachmentSchema } from "@/plugins/attachments";
import { z } from "zod";

export const DRAFT_STORE_VERSION = 5;
export const FINALIZED_DRAFT_TTL_MS = 5 * 60 * 1000;

export interface LegacyDraftImage {
  uri: string;
  mimeType?: string;
}

export type PersistedDraftImage = AttachmentMetadata | LegacyDraftImage;

export interface DraftInput {
  text: string;
  attachments: UserComposerAttachment[];
  /**
   * 输入框里的分段结构，只在含块时保存；有它时以它恢复输入框，text 仍是序列化文字。
   * 旧草稿没有这个字段，按 text 恢复成纯文字。
   */
  segments?: readonly InlineSegment[];
}

export type DraftLifecycleState = "active" | "abandoned" | "sent";

export type CanonicalDraftInput = DraftInput;

export interface DraftRecord {
  input: CanonicalDraftInput;
  lifecycle: DraftLifecycleState;
  updatedAt: number;
  version: number;
}

/** 不含块的分段结构与纯文字无异，不保存。 */
export function segmentsWithBlocks(
  segments: readonly InlineSegment[] | undefined,
): readonly InlineSegment[] | undefined {
  return segments && hasInlineBlock(segments) ? segments : undefined;
}

function sameSegments(
  a: readonly InlineSegment[] | undefined,
  b: readonly InlineSegment[] | undefined,
): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface DraftTextEdit {
  record: DraftRecord | undefined;
  text: string;
  /** undefined 表示这次改动只有文字（原生端或程序替换），旧的分段结构随之作废。 */
  segments: readonly InlineSegment[] | undefined;
  now: number;
}

export function editDraftRecordText({ record, text, segments, now }: DraftTextEdit): DraftRecord {
  const nextSegments = segmentsWithBlocks(segments);
  if (
    record?.lifecycle === "active" &&
    record.input.text === text &&
    sameSegments(record.input.segments, nextSegments)
  ) {
    return record;
  }
  const attachments = record?.lifecycle === "active" ? record.input.attachments : [];
  const input = {
    text,
    attachments,
    ...(nextSegments ? { segments: nextSegments } : {}),
  };
  return {
    input,
    lifecycle: hasDraftContent(input) ? "active" : "abandoned",
    updatedAt: now,
    version: (record?.version ?? 0) + 1,
  };
}

/**
 * 空白正文也算有内容，用户可能还在输入。块按链接写法计入 text，只有块的草稿 text 也不为空。
 */
export function hasDraftContent(input: DraftInput): boolean {
  return input.text.length > 0 || input.attachments.length > 0;
}

export interface DraftStoreState {
  drafts: Record<string, DraftRecord>;
  createModalDraft: DraftRecord | null;
}

export const AttachmentMetadataSchema = z.strictObject({
  id: z.string(),
  mimeType: z.string(),
  storageType: z.enum(["web-indexeddb", "desktop-file", "native-file"]),
  storageKey: z.string(),
  fileName: z.string().nullable().optional(),
  byteSize: z.number().nullable().optional(),
  createdAt: z.number(),
}) satisfies z.ZodType<AttachmentMetadata>;
export const LegacyDraftImageSchema: z.ZodType<LegacyDraftImage> = z.strictObject({
  uri: z.string(),
  mimeType: z.string().optional(),
});
const UploadedFileSchema = z.strictObject({
  type: z.literal("uploaded_file"),
  id: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  path: z.string(),
});
const ForgeItemFields = {
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
};
const IssueItemSchema = z.strictObject({ kind: z.literal("issue"), ...ForgeItemFields });
const ChangeRequestItemSchema = z.strictObject({
  kind: z.literal("change_request"),
  ...ForgeItemFields,
});
export const UserComposerAttachmentSchema: z.ZodType<UserComposerAttachment> = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("image"), metadata: AttachmentMetadataSchema }),
    z.strictObject({ kind: z.literal("file"), attachment: UploadedFileSchema }),
    z.strictObject({
      kind: z.literal("workspace_file"),
      path: z.string(),
      selection: z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("whole_file") }),
        z.strictObject({
          kind: z.literal("line_range"),
          startLine: z.number().int().positive(),
          endLine: z.number().int().positive(),
        }),
      ]),
    }),
    z.strictObject({ kind: z.literal("forge_issue"), item: IssueItemSchema }),
    z.strictObject({ kind: z.literal("forge_change_request"), item: ChangeRequestItemSchema }),
    z.strictObject({ kind: z.literal("github_issue"), item: IssueItemSchema }),
    PluginResourceComposerAttachmentSchema,
    z.strictObject({
      kind: z.literal("github_pr"),
      item: ChangeRequestItemSchema,
      owner: z.literal(NEW_WORKSPACE_PICKER_ATTACHMENT_OWNER).optional(),
    }),
  ],
);
// 块的形状由 inline-blocks 的守卫确认，与编辑器属性、剪贴板用同一套判断。
export const InlineSegmentSchema = z.custom<InlineSegment>(isInlineSegment);
export const CanonicalDraftInputSchema = z.strictObject({
  text: z.string(),
  attachments: z.array(UserComposerAttachmentSchema),
  segments: z.array(InlineSegmentSchema).optional(),
  // COMPAT(draft-cwd): accept legacy persisted drafts that include cwd. Stop accepting after 2026-11-09.
  cwd: z.string().optional(),
});
const DraftRecordSchema: z.ZodType<DraftRecord> = z.strictObject({
  input: CanonicalDraftInputSchema,
  lifecycle: z.enum(["active", "abandoned", "sent"]),
  updatedAt: z.number(),
  version: z.number().int().positive(),
});
export const DraftStoreStateSchema: z.ZodType<DraftStoreState> = z.strictObject({
  drafts: z.record(z.string(), DraftRecordSchema),
  createModalDraft: DraftRecordSchema.nullable(),
});

export function isAttachmentMetadata(value: unknown): value is AttachmentMetadata {
  return AttachmentMetadataSchema.safeParse(value).success;
}

export function isLegacyDraftImage(value: unknown): value is LegacyDraftImage {
  return LegacyDraftImageSchema.safeParse(value).success;
}

export function normalizeAttachmentMetadata(image: AttachmentMetadata): AttachmentMetadata {
  return {
    id: image.id,
    mimeType: image.mimeType,
    storageType: image.storageType,
    storageKey: image.storageKey,
    createdAt: image.createdAt,
    ...(typeof image.fileName === "string" || image.fileName === null
      ? { fileName: image.fileName }
      : {}),
    ...(typeof image.byteSize === "number" || image.byteSize === null
      ? { byteSize: image.byteSize }
      : {}),
  };
}

export function isUserComposerAttachment(value: unknown): value is UserComposerAttachment {
  return UserComposerAttachmentSchema.safeParse(value).success;
}

export function normalizeComposerAttachment(
  attachment: UserComposerAttachment,
): UserComposerAttachment {
  if (attachment.kind === "image") {
    return {
      kind: "image",
      metadata: normalizeAttachmentMetadata(attachment.metadata),
    };
  }
  if (attachment.kind === "workspace_file") {
    return {
      kind: "workspace_file",
      path: attachment.path.trim().replace(/^\.\//, ""),
      selection: attachment.selection,
    };
  }
  return attachment;
}

export function isCanonicalDraftInput(value: unknown): value is CanonicalDraftInput {
  return CanonicalDraftInputSchema.safeParse(value).success;
}

export function toDraftInputIfReady(
  record: DraftRecord | null | undefined,
): DraftInput | undefined {
  if (!record) {
    return undefined;
  }
  if (record.lifecycle !== "active") {
    return undefined;
  }
  if (!isCanonicalDraftInput(record.input)) {
    return undefined;
  }
  return {
    text: record.input.text,
    attachments: record.input.attachments.map(normalizeComposerAttachment),
    ...(record.input.segments ? { segments: record.input.segments } : {}),
  };
}

export function collectReferencedAttachmentIdsFromState(state: DraftStoreState): Set<string> {
  const referencedIds = new Set<string>();

  for (const draftRecord of Object.values(state.drafts)) {
    if (draftRecord.lifecycle !== "active") {
      continue;
    }
    if (!isCanonicalDraftInput(draftRecord.input)) {
      continue;
    }
    for (const attachment of draftRecord.input.attachments) {
      if (attachment.kind === "image") {
        referencedIds.add(attachment.metadata.id);
      }
    }
  }

  const modalRecord = state.createModalDraft;
  if (modalRecord?.lifecycle === "active" && isCanonicalDraftInput(modalRecord.input)) {
    for (const attachment of modalRecord.input.attachments) {
      if (attachment.kind === "image") {
        referencedIds.add(attachment.metadata.id);
      }
    }
  }

  return referencedIds;
}

export function pruneFinalizedDraftRecords(input: {
  drafts: Record<string, DraftRecord>;
  nowMs: number;
}): Record<string, DraftRecord> {
  let changed = false;
  const next: Record<string, DraftRecord> = {};
  for (const [draftKey, record] of Object.entries(input.drafts)) {
    if (record.lifecycle !== "active" && input.nowMs - record.updatedAt >= FINALIZED_DRAFT_TTL_MS) {
      changed = true;
      continue;
    }
    next[draftKey] = record;
  }
  return changed ? next : input.drafts;
}

export function applyClearDraftRecord(input: {
  record: DraftRecord;
  lifecycle?: Exclude<DraftLifecycleState, "active">;
  nowMs: number;
}): DraftRecord | null {
  if (!input.lifecycle) {
    return null;
  }

  return {
    ...input.record,
    input: { text: "", attachments: [] },
    lifecycle: input.lifecycle,
    updatedAt: input.nowMs,
    version: input.record.version + 1,
  };
}
