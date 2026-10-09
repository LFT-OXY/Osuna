import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 配置文件的 `$schema` 指向 https://osuna.chinhae.cc/schemas/osuna.config.v1.json，
// 官网靠 public/ 下的这个静态文件把它托管出来。
const schemaPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/schemas/osuna.config.v1.json",
);

describe("hosted config schema", () => {
  it("serves the daemon config schema as a JSON Schema document", () => {
    expect(existsSync(schemaPath)).toBe(true);

    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

    expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(schema.title).toBe("OsunaConfigV1");
    expect(schema.type).toBe("object");
    expect(schema.properties.version).toMatchObject({ const: 1 });
    expect(schema.properties.daemon.properties.listen).toMatchObject({ type: "string" });
  });
});
