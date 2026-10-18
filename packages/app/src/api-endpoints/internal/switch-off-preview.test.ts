import { describe, expect, it } from "vitest";
import { selectSwitchOffPreview } from "./switch-off-preview";

function removedLines(count: number) {
  return Array.from({ length: count }, (_, i) => ({ op: "removed", text: `line ${i}` }));
}

function removedViews(from: number, to: number) {
  return Array.from({ length: to - from }, (_, i) => ({
    position: from + i,
    kind: "removed",
    text: `line ${from + i}`,
    was: null,
  }));
}

describe("selectSwitchOffPreview", () => {
  it("is loading until the host answers", () => {
    expect(selectSwitchOffPreview({ status: "loading" })).toEqual({ status: "loading" });
  });

  it("lists each file with its lines, a restored line carrying what it is now", () => {
    expect(
      selectSwitchOffPreview({
        status: "answered",
        preview: {
          files: [
            {
              path: "~/.codex/config.toml",
              change: "edited",
              lines: [
                { op: "restored", text: 'model = "gpt-5"', was: 'model = "glm"' },
                { op: "added", text: 'model_reasoning_effort = "high"' },
                { op: "removed", text: 'model_catalog_json = "/x"' },
              ],
            },
            { path: "~/.codex/other.toml", change: "removed", lines: [] },
          ],
        },
      }),
    ).toEqual({
      status: "listed",
      files: [
        {
          path: "~/.codex/config.toml",
          kind: "edited",
          firstLines: [
            { position: 0, kind: "restored", text: 'model = "gpt-5"', was: 'model = "glm"' },
            { position: 1, kind: "added", text: 'model_reasoning_effort = "high"', was: null },
            { position: 2, kind: "removed", text: 'model_catalog_json = "/x"', was: null },
          ],
          foldedLines: [],
        },
        { path: "~/.codex/other.toml", kind: "removed", firstLines: [], foldedLines: [] },
      ],
    });
  });

  it("folds all but the first eight lines of a file, but not when only one or two more", () => {
    const view = selectSwitchOffPreview({
      status: "answered",
      preview: {
        files: [
          { path: "~/a.json", change: "edited", lines: removedLines(11) },
          { path: "~/b.json", change: "created", lines: removedLines(10) },
        ],
      },
    });

    expect(view).toEqual({
      status: "listed",
      files: [
        {
          path: "~/a.json",
          kind: "edited",
          firstLines: removedViews(0, 8),
          foldedLines: removedViews(8, 11),
        },
        { path: "~/b.json", kind: "created", firstLines: removedViews(0, 10), foldedLines: [] },
      ],
    });
  });

  it("nothing to restore is described in words", () => {
    expect(
      selectSwitchOffPreview({
        status: "answered",
        preview: { files: [] },
      }),
    ).toEqual({ status: "described", reason: null });
  });

  it("a change it doesn't know, from a newer host, is described in words", () => {
    expect(
      selectSwitchOffPreview({
        status: "answered",
        preview: {
          files: [{ path: "~/a.json", change: "renamed", lines: [] }],
        },
      }),
    ).toEqual({ status: "described", reason: null });
    expect(
      selectSwitchOffPreview({
        status: "answered",
        preview: {
          files: [{ path: "~/a.json", change: "edited", lines: [{ op: "moved", text: "x" }] }],
        },
      }),
    ).toEqual({ status: "described", reason: null });
  });

  it("a preview the host couldn't make is described with the reason", () => {
    expect(
      selectSwitchOffPreview({ status: "failed", reason: "settings.json has a syntax error" }),
    ).toEqual({
      status: "described",
      reason: "settings.json has a syntax error",
    });
  });
});
