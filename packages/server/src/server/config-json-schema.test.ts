import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

import { buildConfigJsonSchema, HOSTED_CONFIG_JSON_SCHEMA_PATH } from "./config-json-schema.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

test("the config schema the website hosts is the one generated from the daemon's config", () => {
  const hosted = JSON.parse(
    readFileSync(path.join(REPO_ROOT, HOSTED_CONFIG_JSON_SCHEMA_PATH), "utf8"),
  );
  const generated = JSON.parse(JSON.stringify(buildConfigJsonSchema()));

  // 不一致时：npm run generate:config-schema --workspace=@osuna/server，再格式化那个文件。
  expect(hosted).toEqual(generated);
});
