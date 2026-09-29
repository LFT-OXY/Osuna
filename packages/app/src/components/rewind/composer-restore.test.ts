import { describe, expect, test } from "vitest";
import { resolveRewoundComposerContent, restoreComposerTextIfEmpty } from "./composer-restore";
import { shouldRestoreComposerForRewindMode } from "./rewind-mode";

describe("restoreComposerTextIfEmpty", () => {
  test("restores the rewound message when the composer is empty", () => {
    expect(
      restoreComposerTextIfEmpty({
        currentText: "",
        rewoundText: "message before rewind",
      }),
    ).toBe("message before rewind");
  });

  test("preserves an existing composer draft", () => {
    expect(
      restoreComposerTextIfEmpty({
        currentText: "keep this draft",
        rewoundText: "message before rewind",
      }),
    ).toBe("keep this draft");
  });
});

describe("shouldRestoreComposerForRewindMode", () => {
  test("restores only conversation-mutating rewind modes", () => {
    expect(shouldRestoreComposerForRewindMode("conversation")).toBe(true);
    expect(shouldRestoreComposerForRewindMode("files")).toBe(false);
    expect(shouldRestoreComposerForRewindMode("both")).toBe(true);
  });
});

describe("resolveRewoundComposerContent", () => {
  test("brings file and agent mentions back as blocks and leading skills back as chips", () => {
    expect(
      resolveRewoundComposerContent(
        "/atw-tdd ask [@Claude](paseo://agent/claude) about [x.ts](src/x.ts)",
        new Set(["atw-tdd"]),
      ),
    ).toEqual({
      chips: [{ name: "atw-tdd" }],
      text: "ask [@Claude](paseo://agent/claude) about [x.ts](src/x.ts)",
      body: [
        { type: "text", text: "ask " },
        { type: "block", block: { kind: "agent", target: "claude", name: "Claude" } },
        { type: "text", text: " about " },
        { type: "block", block: { kind: "file", path: "src/x.ts", entryKind: "file" } },
      ],
    });
  });

  test("keeps a leading /name as text while the skill list is unknown", () => {
    expect(resolveRewoundComposerContent("/atw-tdd go", null)).toEqual({
      chips: [],
      text: "/atw-tdd go",
      body: [{ type: "text", text: "/atw-tdd go" }],
    });
  });
});
