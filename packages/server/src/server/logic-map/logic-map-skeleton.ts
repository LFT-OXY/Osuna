import { z } from "zod";

/** 节点文档的来源：图文件夹里的自有文档，或项目里某个文件中的某个标题（存标题文字，不存行号）。 */
const LogicMapNodeDocSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("own"),
      file: z.string().min(1),
      /** 装了 spec 框架时的临时要点，还没指向正式文档。 */
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

const LogicMapNodeSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    kind: z.enum(["start", "end", "step", "decision", "subgraph"]),
    /** 所在子图节点的 id；顶层为 null。 */
    parentId: z.string().min(1).nullable(),
    doc: LogicMapNodeDocSchema.nullable(),
  })
  .strict();

const LogicMapEdgeSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    condition: z.string().min(1).nullable(),
  })
  .strict();

const LogicMapSpecFrameworkSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("present"), docsPath: z.string().min(1) }).strict(),
]);

/** 一张逻辑图的骨架（map.json）。title 在 Agent 第一次写入前为 null，specFramework 在它判断前为 null。 */
const LogicMapSkeletonSchema = z
  .object({
    title: z.string().min(1).nullable(),
    specFramework: LogicMapSpecFrameworkSchema.nullable(),
    nodes: z.array(LogicMapNodeSchema),
    edges: z.array(LogicMapEdgeSchema),
  })
  .strict();

export type LogicMapSkeleton = z.infer<typeof LogicMapSkeletonSchema>;

export function parseLogicMapSkeleton(value: unknown): LogicMapSkeleton {
  return LogicMapSkeletonSchema.parse(value);
}

export const EMPTY_LOGIC_MAP_SKELETON: LogicMapSkeleton = {
  title: null,
  specFramework: null,
  nodes: [],
  edges: [],
};
