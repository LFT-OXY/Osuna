import { LogicMapSkeletonSchema, type LogicMapSkeleton } from "@getpaseo/protocol/messages";

export function parseLogicMapSkeleton(value: unknown): LogicMapSkeleton {
  return LogicMapSkeletonSchema.parse(value);
}

export const EMPTY_LOGIC_MAP_SKELETON: LogicMapSkeleton = {
  title: null,
  specFramework: null,
  nodes: [],
  edges: [],
};
