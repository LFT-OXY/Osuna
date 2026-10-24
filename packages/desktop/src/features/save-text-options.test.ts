import { describe, expect, it } from "vitest";
import { SaveTextOptionsSchema } from "./save-text-options.js";

describe("SaveTextOptionsSchema", () => {
  it("takes a file name, CSV filters and string contents", () => {
    expect(
      SaveTextOptionsSchema.parse({
        defaultPath: "osuna-requests-day-2026-10-23.csv",
        filters: [{ name: "CSV", extensions: ["csv"] }],
        contents: "time\n",
      }),
    ).toEqual({
      defaultPath: "osuna-requests-day-2026-10-23.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
      contents: "time\n",
    });
  });

  it("rejects contents that are not text, a path for a name, and malformed filters", () => {
    const base = { defaultPath: "a.csv", filters: [{ name: "CSV", extensions: ["csv"] }] };
    expect(SaveTextOptionsSchema.safeParse({ ...base, contents: 42 }).success).toBe(false);
    expect(SaveTextOptionsSchema.safeParse({ ...base }).success).toBe(false);
    expect(
      SaveTextOptionsSchema.safeParse({ ...base, defaultPath: "../../etc/a.csv", contents: "" })
        .success,
    ).toBe(false);
    expect(
      SaveTextOptionsSchema.safeParse({ ...base, defaultPath: "", contents: "" }).success,
    ).toBe(false);
    expect(
      SaveTextOptionsSchema.safeParse({
        ...base,
        filters: [{ name: "CSV", extensions: [".csv/x"] }],
        contents: "",
      }).success,
    ).toBe(false);
  });
});
