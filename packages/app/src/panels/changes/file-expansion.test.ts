import { describe, expect, it } from "vitest";
import {
  applyCollapsedFilePaths,
  collapseAllFiles,
  expandAllFiles,
  recordDefaultFileExpansion,
} from "./file-expansion";

function changedFile(path: string, lines = 10, generated?: boolean) {
  return { path, additions: lines, deletions: 0, ...(generated ? { generated } : {}) };
}

function changedFiles(count: number, prefix = "src/file") {
  return Array.from({ length: count }, (_, index) => changedFile(`${prefix}-${index + 1}.ts`));
}

const emptyRecord = { collapsedFilePaths: [], expandedFilePaths: [] };

describe("Changes default file expansion", () => {
  it("expands every file when ten or fewer files change", () => {
    const files = changedFiles(10);
    const record = recordDefaultFileExpansion(emptyRecord, files);
    expect(record.collapsedFilePaths).toEqual([]);
    expect(record.expandedFilePaths).toEqual(files.map((file) => file.path));
  });

  it("expands only the first three files in panel order when eleven files change", () => {
    const record = recordDefaultFileExpansion(emptyRecord, changedFiles(11));
    expect(record.expandedFilePaths).toEqual(["src/file-1.ts", "src/file-2.ts", "src/file-3.ts"]);
    expect(record.collapsedFilePaths).toHaveLength(8);
    expect(record.collapsedFilePaths).toContain("src/file-4.ts");
    expect(record.collapsedFilePaths).toContain("src/file-11.ts");
  });

  it("collapses a file with more than 1000 changed lines even among few files", () => {
    const record = recordDefaultFileExpansion(emptyRecord, [
      changedFile("small.ts", 1000),
      { path: "big.ts", additions: 600, deletions: 401 },
    ]);
    expect(record.expandedFilePaths).toEqual(["small.ts"]);
    expect(record.collapsedFilePaths).toEqual(["big.ts"]);
  });

  it("collapses a generated file even when only three files change", () => {
    const record = recordDefaultFileExpansion(emptyRecord, [
      changedFile("a.ts"),
      changedFile("package-lock.json", 5, true),
      changedFile("b.ts"),
    ]);
    expect(record.collapsedFilePaths).toEqual(["package-lock.json"]);
    expect(record.expandedFilePaths).toEqual(["a.ts", "b.ts"]);
  });

  it("keeps a generated file the user expanded expanded", () => {
    const files = [changedFile("a.ts"), changedFile("package-lock.json", 5, true)];
    const expanded = applyCollapsedFilePaths(recordDefaultFileExpansion(emptyRecord, files), []);
    const record = recordDefaultFileExpansion(expanded, [
      ...files,
      changedFile("yarn.lock", 5, true),
    ]);
    expect(record.collapsedFilePaths).toEqual(["yarn.lock"]);
    expect(record.expandedFilePaths).toContain("package-lock.json");
  });

  it("keeps a large file the user expanded expanded", () => {
    const big = changedFile("big.ts", 5000);
    const expanded = applyCollapsedFilePaths(recordDefaultFileExpansion(emptyRecord, [big]), []);
    const record = recordDefaultFileExpansion(expanded, [big, changedFile("next.ts")]);
    expect(record.collapsedFilePaths).toEqual([]);
    expect(record.expandedFilePaths).toContain("big.ts");
  });

  it("keeps a file the user collapsed collapsed", () => {
    const files = changedFiles(2);
    const collapsed = applyCollapsedFilePaths(recordDefaultFileExpansion(emptyRecord, files), [
      "src/file-1.ts",
    ]);
    const record = recordDefaultFileExpansion(collapsed, [...files, changedFile("src/new.ts")]);
    expect(record.collapsedFilePaths).toEqual(["src/file-1.ts"]);
    expect(record.expandedFilePaths).toEqual(["src/file-2.ts", "src/new.ts"]);
  });

  it("keeps the first eight files expanded when the change grows to eleven files", () => {
    const first = changedFiles(8);
    const seen = recordDefaultFileExpansion(emptyRecord, first);
    const grown = [...first, ...changedFiles(3, "src/later")];
    const record = recordDefaultFileExpansion(seen, grown);
    expect(record.expandedFilePaths).toEqual(first.map((file) => file.path));
    expect(record.collapsedFilePaths).toEqual([
      "src/later-1.ts",
      "src/later-2.ts",
      "src/later-3.ts",
    ]);
  });

  it("returns the same record when every file was already decided", () => {
    const files = changedFiles(4);
    const seen = recordDefaultFileExpansion(emptyRecord, files);
    expect(recordDefaultFileExpansion(seen, files)).toBe(seen);
  });

  it("expands every file, generated and large ones included, after Expand all", () => {
    const files = [
      ...changedFiles(12),
      changedFile("big.ts", 1500),
      changedFile("yarn.lock", 20, true),
    ];
    const seen = recordDefaultFileExpansion(emptyRecord, files);
    const record = recordDefaultFileExpansion(expandAllFiles(seen, files), files);
    expect(record.collapsedFilePaths).toEqual([]);
    expect(new Set(record.expandedFilePaths)).toEqual(new Set(files.map((file) => file.path)));
  });

  it("collapses every file after Collapse all", () => {
    const files = changedFiles(3);
    const seen = recordDefaultFileExpansion(emptyRecord, files);
    const record = collapseAllFiles(seen, files);
    expect(record.collapsedFilePaths).toEqual(files.map((file) => file.path));
    expect(record.expandedFilePaths).toEqual([]);
  });
});
