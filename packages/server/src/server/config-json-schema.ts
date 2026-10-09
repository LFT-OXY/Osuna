import { z } from "zod";

import { PersistedConfigSchema } from "./persisted-config.js";

// 官网在 https://osuna.chinhae.cc/schemas/osuna.config.v1.json 托管的就是这个文件，
// 配置文件的 `$schema` 指向它。路径相对仓库根。
export const HOSTED_CONFIG_JSON_SCHEMA_PATH =
  "packages/website/public/schemas/osuna.config.v1.json";

export function buildConfigJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(PersistedConfigSchema, {
    target: "draft-07",
    unrepresentable: "any",
    io: "input",
  });
  return { ...schema, title: "OsunaConfigV1" };
}
