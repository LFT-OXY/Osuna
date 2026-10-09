import { describe, expect, test } from "vitest";
import {
  findMarkdownLinks,
  formatAgentMentionHref,
  formatAgentMentionLink,
  formatMarkdownLink,
  isAgentMentionTarget,
  parseAgentMentionHref,
  parseAgentMentionLink,
  type AgentMention,
} from "./message-links.js";

function mentionsIn(text: string): (AgentMention | null)[] {
  return findMarkdownLinks(text).map(parseAgentMentionLink);
}

describe("agent mention href", () => {
  test("writes both kinds under the osuna agent prefix", () => {
    expect(formatAgentMentionHref({ kind: "provider", id: "claude" })).toBe(
      "osuna://agent/provider/claude",
    );
    expect(formatAgentMentionHref({ kind: "profile", id: "agent_profile_1" })).toBe(
      "osuna://agent/profile/agent_profile_1",
    );
  });

  test("reads both kinds back", () => {
    expect(parseAgentMentionHref("osuna://agent/provider/codex")).toEqual({
      kind: "provider",
      id: "codex",
    });
    expect(parseAgentMentionHref("osuna://agent/profile/agent_profile_1")).toEqual({
      kind: "profile",
      id: "agent_profile_1",
    });
  });

  test("encodes and decodes ids with special characters", () => {
    const target = { kind: "profile", id: "Reviewer (fast) #1 ?ü%" } as const;
    const href = formatAgentMentionHref(target);
    expect(href).toBe("osuna://agent/profile/Reviewer%20(fast)%20%231%20%3F%C3%BC%25");
    expect(parseAgentMentionHref(href)).toEqual(target);
  });

  test("rejects an id that decodes to a slash", () => {
    expect(parseAgentMentionHref("osuna://agent/profile/a%2Fb")).toBeNull();
    expect(parseAgentMentionHref("osuna://agent/profile/a/b")).toBeNull();
  });

  test("rejects other shapes", () => {
    expect(parseAgentMentionHref("osuna://agent/claude")).toBeNull();
    expect(parseAgentMentionHref("osuna://agent/provider/")).toBeNull();
    expect(parseAgentMentionHref("osuna://agent/team/claude")).toBeNull();
    expect(parseAgentMentionHref("osuna://agent/provider/My%20Agent")).toBeNull();
    expect(parseAgentMentionHref("osuna://agent/")).toBeNull();
    expect(parseAgentMentionHref("osuna://agent/profile/%E0%A4%A")).toBeNull();
    expect(parseAgentMentionHref("https://agent/provider/claude")).toBeNull();
  });
});

describe("agent mention link", () => {
  test("round-trips through the text form", () => {
    const mentions: AgentMention[] = [
      { target: { kind: "provider", id: "claude" }, name: "Claude" },
      { target: { kind: "profile", id: "Reviewer (fast)" }, name: "Reviewer [fast] \\ one" },
    ];
    const text = mentions.map(formatAgentMentionLink).join(" and ");
    expect(mentionsIn(text)).toEqual(mentions);
  });

  test("writes the @ label and the href", () => {
    expect(
      formatAgentMentionLink({ target: { kind: "provider", id: "claude" }, name: "Claude" }),
    ).toBe("[@Claude](osuna://agent/provider/claude)");
  });

  test("needs an @ label with a name", () => {
    expect(
      mentionsIn("[Claude](osuna://agent/provider/claude) [@](osuna://agent/provider/claude)"),
    ).toEqual([null, null]);
  });

  test("keeps a non-agent link out", () => {
    expect(mentionsIn("[x.ts](src/x.ts)")).toEqual([null]);
  });
});

describe("markdown links", () => {
  test("finds each link with its position and unescaped parts", () => {
    const text = "see [a\\]b](<c d.ts>) then [x.ts](app/(tabs)/x.ts)";
    expect(findMarkdownLinks(text)).toEqual([
      { index: 4, raw: "[a\\]b](<c d.ts>)", label: "a]b", target: "c d.ts" },
      {
        index: 26,
        raw: "[x.ts](app/(tabs)/x.ts)",
        label: "x.ts",
        target: "app/(tabs)/x.ts",
      },
    ]);
  });

  test("skips images and escaped brackets", () => {
    expect(
      findMarkdownLinks(
        "![@Claude](osuna://agent/provider/claude) \\[@Claude](osuna://agent/provider/claude)",
      ),
    ).toEqual([]);
  });

  test("writes a target with spaces or parentheses in angle brackets", () => {
    expect(formatMarkdownLink("a]b", "c d.ts")).toBe("[a\\]b](<c d.ts>)");
    expect(formatMarkdownLink("x.ts", "src/x.ts")).toBe("[x.ts](src/x.ts)");
    const text = formatMarkdownLink("<odd>", "a <b>.ts");
    expect(findMarkdownLinks(text)).toEqual([
      { index: 0, raw: text, label: "<odd>", target: "a <b>.ts" },
    ]);
  });
});

describe("isAgentMentionTarget", () => {
  test("accepts only the two kinds with a valid id", () => {
    expect(isAgentMentionTarget({ kind: "provider", id: "claude" })).toBe(true);
    expect(isAgentMentionTarget({ kind: "provider", id: "my-acp2" })).toBe(true);
    expect(isAgentMentionTarget({ kind: "provider", id: "Claude" })).toBe(false);
    expect(isAgentMentionTarget({ kind: "provider", id: "2x" })).toBe(false);
    expect(isAgentMentionTarget({ kind: "profile", id: "p 1" })).toBe(true);
    expect(isAgentMentionTarget({ kind: "profile", id: "a/b" })).toBe(false);
    expect(isAgentMentionTarget({ kind: "provider", id: "" })).toBe(false);
    expect(isAgentMentionTarget({ kind: "team", id: "x" })).toBe(false);
    expect(isAgentMentionTarget("claude")).toBe(false);
  });
});

// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
const LEGACY_MENTION_HREF = "paseo://agent/provider/claude";

describe("Agent mentions written by 0.14.x", () => {
  test("still resolve to their agent when an old message is read back", () => {
    expect(parseAgentMentionHref(LEGACY_MENTION_HREF)).toEqual({ kind: "provider", id: "claude" });
    expect(parseAgentMentionLink({ label: "@Claude", target: LEGACY_MENTION_HREF })).toEqual({
      target: { kind: "provider", id: "claude" },
      name: "Claude",
    });
  });

  test("are never written again", () => {
    expect(formatAgentMentionHref({ kind: "provider", id: "claude" })).toBe(
      "osuna://agent/provider/claude",
    );
  });
});
