import { describe, expect, it } from "vitest";
import { mergeUsageRequestCsvs, usageRequestsCsvFileName } from "./requests-export";

const HEADER = "time,model,response_id";

describe("mergeUsageRequestCsvs", () => {
  it("passes one host's file through as it came", () => {
    const csv = `${HEADER}\n2026-10-23T10:00:00Z,m,"a,\nb"\n`;
    expect(mergeUsageRequestCsvs([csv])).toBe(csv);
  });

  it("keeps one header and puts every host's rows newest first, a quoted line break staying in its row", () => {
    const shanghai = `${HEADER}\n2026-10-23T18:00:00+08:00,m1,"x\ny"\n2026-10-23T09:00:00+08:00,m2,z\n`;
    const london = `${HEADER}\n2026-10-23T09:30:00Z,m3,"say ""hi"""\n`;
    expect(mergeUsageRequestCsvs([shanghai, london])).toBe(
      `${HEADER}\n2026-10-23T18:00:00+08:00,m1,"x\ny"\n2026-10-23T09:30:00Z,m3,"say ""hi"""\n2026-10-23T09:00:00+08:00,m2,z\n`,
    );
  });
});

describe("usageRequestsCsvFileName", () => {
  it("names a day, a span of days, or all time with the day it was saved", () => {
    expect(usageRequestsCsvFileName({ from: "2026-10-23", to: "2026-10-23" }, "2026-10-23")).toBe(
      "osuna-requests-day-2026-10-23.csv",
    );
    expect(usageRequestsCsvFileName({ from: "2026-10-01", to: "2026-10-31" }, "2026-10-23")).toBe(
      "osuna-requests-2026-10-01-to-2026-10-31.csv",
    );
    expect(usageRequestsCsvFileName({ from: null, to: null }, "2026-10-23")).toBe(
      "osuna-requests-all-2026-10-23.csv",
    );
  });
});
