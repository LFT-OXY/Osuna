import { z } from "zod";
import { LogicMapNodeKindSchema, type LogicMapSkeleton } from "@getpaseo/protocol/messages";

// 磁盘上的 map.json 比线上的 LogicMapSkeletonSchema 更严：不认识的字段、空 id、空标题都算文件被改坏。
// 线上 schema 保持宽松，旧客户端才能读新 daemon 加了字段的图。
const NodeDocFileSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("own"),
      file: z.string().min(1),
      pendingLink: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("external"),
      path: z.string().min(1),
      heading: z.string().min(1),
    })
    .strict(),
]);

const NodeFileSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    kind: LogicMapNodeKindSchema,
    parentId: z.string().min(1).nullable(),
    failure: z.boolean().default(false),
    doc: NodeDocFileSchema.nullable(),
  })
  .strict();

const EdgeFileSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    condition: z.string().min(1).nullable(),
  })
  .strict();

const SpecFrameworkFileSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("present"), docsPath: z.string().min(1) }).strict(),
]);

const SkeletonFileSchema = z
  .object({
    title: z.string().min(1).nullable(),
    specFramework: SpecFrameworkFileSchema.nullable(),
    nodes: z.array(NodeFileSchema),
    edges: z.array(EdgeFileSchema),
  })
  .strict();

/** 读磁盘上的骨架；不合格时抛 ZodError。 */
export function parseLogicMapSkeleton(value: unknown): LogicMapSkeleton {
  return SkeletonFileSchema.parse(value);
}

export const EMPTY_LOGIC_MAP_SKELETON: LogicMapSkeleton = {
  title: null,
  specFramework: null,
  nodes: [],
  edges: [],
};
