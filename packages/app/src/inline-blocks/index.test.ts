import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { findActiveSlashCommand } from "@/utils/agent-command-autocomplete";
import {
  addLeadingSkillBlocks,
  extractSkillBlocks,
  hasSkillBlock,
  inlineBlockName,
  inlineSegmentsText,
  insertInlineBlockText,
  leadingSkillSegments,
  pickSkillBlock,
  pickSkillText,
  splitLeadingSkillBlocks,
  parseInlineSegments,
  resolveInlineBlockVariant,
  serializeInlineSegments,
  trimInlineSegments,
  type InlineBlock,
  type InlineBlockVariant,
  type InlineSegment,
} from "./index";

const SKILLS = new Set(["atw-tdd", "atw-askme", "plugin:review"]);
const CLAUDE = { kind: "provider", id: "claude" } as const;

function text(value: string): InlineSegment {
  return { type: "text", text: value };
}

function block(value: InlineBlock): InlineSegment {
  return { type: "block", block: value };
}

const tdd = block({ kind: "skill", name: "atw-tdd" });
const askme = block({ kind: "skill", name: "atw-askme" });

describe("parseInlineSegments", () => {
  it("reads a link whose label is the path's base name as a file mention", () => {
    expect(parseInlineSegments("look at [x.ts](src/x.ts) please", { skillNames: SKILLS })).toEqual([
      text("look at "),
      block({ kind: "file", path: "src/x.ts", entryKind: "file" }),
      text(" please"),
    ]);
  });

  it("reads a target ending in / as a directory", () => {
    expect(parseInlineSegments("[components](src/components/)", { skillNames: SKILLS })).toEqual([
      block({ kind: "file", path: "src/components", entryKind: "directory" }),
    ]);
  });

  it("reads an angle-bracket target with spaces and parentheses", () => {
    expect(
      parseInlineSegments("[my file (1).md](<docs/my file (1).md>) and [a b](<a b/>)", {
        skillNames: SKILLS,
      }),
    ).toEqual([
      block({ kind: "file", path: "docs/my file (1).md", entryKind: "file" }),
      text(" and "),
      block({ kind: "file", path: "a b", entryKind: "directory" }),
    ]);
  });

  it("reads a bare target with balanced parentheses", () => {
    expect(
      parseInlineSegments("[index.tsx](app/(tabs)/index.tsx)", { skillNames: SKILLS }),
    ).toEqual([block({ kind: "file", path: "app/(tabs)/index.tsx", entryKind: "file" })]);
  });

  it("keeps a link whose label is not the base name as text", () => {
    const message = "see [the helper](src/x.ts) and [src/x.ts](src/x.ts)";
    expect(parseInlineSegments(message, { skillNames: SKILLS })).toEqual([text(message)]);
  });

  it("keeps a Markdown image and an escaped bracket as text", () => {
    const message = "![a.png](a.png) and \\[x.ts](x.ts)";
    expect(parseInlineSegments(message, { skillNames: SKILLS })).toEqual([text(message)]);
  });

  it("keeps a link with a URL target as text", () => {
    const message = "[example.com](https://example.com)";
    expect(parseInlineSegments(message, { skillNames: SKILLS })).toEqual([text(message)]);
  });

  it("reads provider and profile agent mention links", () => {
    expect(
      parseInlineSegments(
        "[@Claude](paseo://agent/provider/claude) and [@Reviewer](paseo://agent/profile/p%201)",
        { skillNames: SKILLS },
      ),
    ).toEqual([
      block({ kind: "agent", target: CLAUDE, name: "Claude" }),
      text(" and "),
      block({ kind: "agent", target: { kind: "profile", id: "p 1" }, name: "Reviewer" }),
    ]);
  });

  it("keeps an agent link without the @, the kind, or the id as text", () => {
    const message =
      "[Claude](paseo://agent/provider/claude) [@Claude](paseo://agent/provider/) [@Claude](paseo://agent/claude) [@](paseo://agent/provider/claude)";
    expect(parseInlineSegments(message, { skillNames: SKILLS })).toEqual([text(message)]);
  });

  it("reads leading /names of known skills as skill blocks", () => {
    expect(parseInlineSegments("/atw-askme /atw-tdd write tests", { skillNames: SKILLS })).toEqual([
      askme,
      tdd,
      text("write tests"),
    ]);
  });

  it("reads a message that is only skills", () => {
    expect(parseInlineSegments("/atw-tdd /plugin:review", { skillNames: SKILLS })).toEqual([
      tdd,
      block({ kind: "skill", name: "plugin:review" }),
    ]);
  });

  it("stops at the first leading /name that is not a known skill", () => {
    expect(parseInlineSegments("/atw-tdd /help /atw-askme", { skillNames: SKILLS })).toEqual([
      tdd,
      text("/help /atw-askme"),
    ]);
  });

  it("keeps a skill /name that is not at the start as text", () => {
    const message = "please run /atw-tdd";
    expect(parseInlineSegments(message, { skillNames: SKILLS })).toEqual([text(message)]);
  });

  it("keeps leading /names as text when the skill list is missing", () => {
    const message = "/atw-tdd [x.ts](src/x.ts)";
    expect(parseInlineSegments(message, { skillNames: null })).toEqual([
      text("/atw-tdd "),
      block({ kind: "file", path: "src/x.ts", entryKind: "file" }),
    ]);
  });

  it("reads a Claude-imported /cmd args by whether cmd is a skill", () => {
    expect(parseInlineSegments("/atw-tdd fix the parser", { skillNames: SKILLS })).toEqual([
      tdd,
      text("fix the parser"),
    ]);
    expect(parseInlineSegments("/compact keep the plan", { skillNames: SKILLS })).toEqual([
      text("/compact keep the plan"),
    ]);
  });

  it("reads a Codex-imported leading $name the same way as /name", () => {
    expect(parseInlineSegments("$atw-tdd /atw-askme fix it", { skillNames: SKILLS })).toEqual([
      tdd,
      askme,
      text("fix it"),
    ]);
    expect(parseInlineSegments("$HOME is unset", { skillNames: SKILLS })).toEqual([
      text("$HOME is unset"),
    ]);
  });

  it("does not read the legacy quoted path", () => {
    const message = 'check "src/x.ts" first';
    expect(parseInlineSegments(message, { skillNames: SKILLS })).toEqual([text(message)]);
  });

  it("returns no segments for empty text", () => {
    expect(parseInlineSegments("", { skillNames: SKILLS })).toEqual([]);
  });
});

describe("serializeInlineSegments", () => {
  it("puts skills first as /names, one space before the body", () => {
    expect(serializeInlineSegments([askme, tdd, text("write tests")])).toBe(
      "/atw-askme /atw-tdd write tests",
    );
  });

  it("keeps a line break that starts the body after the skills", () => {
    expect(serializeInlineSegments([tdd, text("\n\ncode")])).toBe("/atw-tdd \n\ncode");
  });

  it("writes only the skill run when there is no body", () => {
    expect(serializeInlineSegments([askme, tdd, text("  ")])).toBe("/atw-askme /atw-tdd");
  });

  it("writes files, directories, and paths that need angle brackets", () => {
    expect(
      serializeInlineSegments([
        block({ kind: "file", path: "src/x.ts", entryKind: "file" }),
        text(" "),
        block({ kind: "file", path: "src/components/", entryKind: "directory" }),
        text(" "),
        block({ kind: "file", path: "docs/my file (1).md", entryKind: "file" }),
      ]),
    ).toBe(
      "[x.ts](src/x.ts) [components](src/components/) [my file (1).md](<docs/my file (1).md>)",
    );
  });

  it("writes an agent mention as a paseo agent link", () => {
    expect(
      serializeInlineSegments([
        block({ kind: "agent", target: CLAUDE, name: "Claude" }),
        text(" write the tests"),
      ]),
    ).toBe("[@Claude](paseo://agent/provider/claude) write the tests");
  });
});

describe("insertInlineBlockText", () => {
  it("reuses the space that already follows the range, caret after it", () => {
    const result = insertInlineBlockText({
      text: "open @src/co next",
      range: { start: 5, end: 12 },
      block: { kind: "file", path: "src/components", entryKind: "directory" },
    });
    expect(result).toEqual({
      text: "open [components](src/components/) next",
      cursor: "open [components](src/components/) ".length,
    });
  });

  it("adds a space when the text after the range does not start with one", () => {
    const result = insertInlineBlockText({
      text: "@x,",
      range: { start: 0, end: 2 },
      block: { kind: "file", path: "src/x.ts", entryKind: "file" },
    });
    expect(result).toEqual({ text: "[x.ts](src/x.ts) ,", cursor: 17 });
  });

  it("writes a file at the end of the text", () => {
    expect(
      insertInlineBlockText({
        text: "@x",
        range: { start: 0, end: 2 },
        block: { kind: "file", path: "src/x.ts", entryKind: "file" },
      }),
    ).toEqual({ text: "[x.ts](src/x.ts) ", cursor: 17 });
  });
});

interface RoundTripCase {
  name: string;
  segments: InlineSegment[];
}

describe("serialize then parse", () => {
  const cases: RoundTripCase[] = [
    { name: "skills and body", segments: [askme, tdd, text("write tests")] },
    { name: "only skills", segments: [tdd] },
    { name: "skills and a body that starts on a new line", segments: [tdd, text("\ncode")] },
    {
      name: "files and directories",
      segments: [
        text("compare "),
        block({ kind: "file", path: "src/a.ts", entryKind: "file" }),
        text(" with "),
        block({ kind: "file", path: "src/lib", entryKind: "directory" }),
      ],
    },
    {
      name: "paths with spaces, parentheses, and brackets",
      segments: [
        block({ kind: "file", path: "docs/my file (1).md", entryKind: "file" }),
        text(" "),
        block({ kind: "file", path: "a/[draft] <v2>.md", entryKind: "file" }),
      ],
    },
    {
      name: "agent mentions next to a skill and a file",
      segments: [
        tdd,
        block({
          kind: "agent",
          target: { kind: "profile", id: "my (profile)" },
          name: "Reviewer [fast]",
        }),
        text(" and "),
        block({ kind: "agent", target: CLAUDE, name: "Claude" }),
        text(" read "),
        block({ kind: "file", path: "photo.png", entryKind: "file" }),
      ],
    },
  ];

  for (const { name, segments } of cases) {
    it(`round-trips ${name}`, () => {
      expect(
        parseInlineSegments(serializeInlineSegments(segments), { skillNames: SKILLS }),
      ).toEqual(segments);
    });
  }
});

describe("inline block presentation", () => {
  it("names each block by what the user picked", () => {
    expect(inlineBlockName({ kind: "skill", name: "atw-tdd" })).toBe("atw-tdd");
    expect(inlineBlockName({ kind: "file", path: "src/x.ts", entryKind: "file" })).toBe("x.ts");
    expect(inlineBlockName({ kind: "file", path: "src/lib", entryKind: "directory" })).toBe("lib");
    expect(inlineBlockName({ kind: "agent", target: CLAUDE, name: "Claude" })).toBe("Claude");
  });

  it("shows raster images with the image variant", () => {
    expect(resolveInlineBlockVariant({ kind: "file", path: "a/b.PNG", entryKind: "file" })).toBe(
      "image",
    );
    expect(resolveInlineBlockVariant({ kind: "file", path: "a/b.ts", entryKind: "file" })).toBe(
      "file",
    );
    expect(
      resolveInlineBlockVariant({ kind: "file", path: "assets.png", entryKind: "directory" }),
    ).toBe("directory");
    expect(resolveInlineBlockVariant({ kind: "skill", name: "atw-tdd" })).toBe("skill");
    expect(resolveInlineBlockVariant({ kind: "agent", target: CLAUDE, name: "Claude" })).toBe(
      "agent",
    );
  });

  it("has an accessible name for every variant", () => {
    const variants: InlineBlockVariant[] = ["skill", "file", "directory", "image", "agent"];
    for (const variant of variants) {
      expect(i18n.exists(`composer.inlineBlocks.${variant}`), variant).toBe(true);
    }
  });
});

describe("trimInlineSegments", () => {
  const file = block({ kind: "file", path: "src/x.ts", entryKind: "file" });

  it("trims the whitespace around the content like trimming its text", () => {
    expect(trimInlineSegments([text("\n  see "), file, text(" now \n")])).toEqual([
      text("see "),
      file,
      text(" now"),
    ]);
  });

  it("drops text that is only whitespace at either end", () => {
    expect(trimInlineSegments([text("  "), file, text(" \n")])).toEqual([file]);
    expect(trimInlineSegments([text("   ")])).toEqual([]);
  });

  it("keeps whitespace between blocks", () => {
    const dir = block({ kind: "file", path: "docs", entryKind: "directory" });
    expect(trimInlineSegments([file, text(" "), dir])).toEqual([file, text(" "), dir]);
  });
});

function activeCommand(value: string, cursorIndex: number, blockBoundary = 0) {
  const command = findActiveSlashCommand({ text: value, cursorIndex, blockBoundary });
  if (!command) throw new Error(`no slash command in ${JSON.stringify(value)}`);
  return command;
}

describe("pickSkillBlock", () => {
  const tddBlock = { kind: "skill", name: "atw-tdd" } as const;
  const askmeBlock = { kind: "skill", name: "atw-askme", description: "Ask me first" } as const;
  const askmeWithDescription = block(askmeBlock);
  const file = block({ kind: "file", path: "src/x.ts", entryKind: "file" });

  it("removes a leading /query and the space after it, leaving the cursor where it was", () => {
    const value = "/atw- write tests";
    const result = pickSkillBlock({
      segments: [text(value)],
      command: activeCommand(value, "/atw-".length),
      block: askmeBlock,
    });

    expect(result.segments).toEqual([askmeWithDescription, text(" write tests")]);
    expect(inlineSegmentsText(result.segments)).toBe("/atw-askme write tests");
    expect(result.cursor).toBe("/atw-askme ".length);
  });

  it("moves a mid-text pick to the start and keeps the cursor where the /query was", () => {
    const value = "use /tdd before implementation";
    const result = pickSkillBlock({
      segments: [text(value)],
      command: activeCommand(value, "use /tdd".length),
      block: tddBlock,
    });

    expect(result.segments).toEqual([tdd, text(" use before implementation")]);
    expect(result.cursor).toBe("/atw-tdd use ".length);
  });

  it("leaves only the block and its space when the /query was all there was", () => {
    const value = "/atw";
    const result = pickSkillBlock({
      segments: [text(value)],
      command: activeCommand(value, value.length),
      block: tddBlock,
    });

    expect(result.segments).toEqual([tdd, text(" ")]);
    expect(result.cursor).toBe("/atw-tdd ".length);
  });

  it("appends after the leading skill blocks in picking order", () => {
    const value = "/atw-tdd fix /ask";
    const result = pickSkillBlock({
      segments: [tdd, text(" fix /ask")],
      command: activeCommand(value, value.length, "/atw-tdd".length),
      block: askmeBlock,
    });

    expect(result.segments).toEqual([tdd, text(" "), askmeWithDescription, text(" fix ")]);
    expect(result.cursor).toBe("/atw-tdd /atw-askme fix ".length);
  });

  it("does not add a second block with the same name", () => {
    const value = "/atw-tdd fix /atw-tdd now";
    const result = pickSkillBlock({
      segments: [tdd, text(" fix /atw-tdd now")],
      command: activeCommand(value, "/atw-tdd fix /atw-tdd".length, "/atw-tdd".length),
      block: tddBlock,
    });

    expect(result.segments).toEqual([tdd, text(" fix now")]);
    expect(result.cursor).toBe("/atw-tdd fix ".length);
  });

  it("keeps file mentions where they were", () => {
    const value = "see [x.ts](src/x.ts) /tdd";
    const result = pickSkillBlock({
      segments: [text("see "), file, text(" /tdd")],
      command: activeCommand(value, value.length, "see [x.ts](src/x.ts)".length),
      block: tddBlock,
    });

    expect(result.segments).toEqual([tdd, text(" see "), file, text(" ")]);
    expect(serializeInlineSegments(result.segments)).toBe("/atw-tdd see [x.ts](src/x.ts)");
  });

  it("puts the block at the start when no /query is being typed", () => {
    const result = pickSkillBlock({
      segments: [text(" fix it")],
      command: null,
      block: tddBlock,
    });

    expect(result.segments).toEqual([tdd, text("  fix it")]);
    expect(result.cursor).toBe("/atw-tdd ".length);
  });
});

describe("pickSkillText", () => {
  it("inserts /name at the start of the text and removes the /query", () => {
    const value = "use /tdd now";
    expect(
      pickSkillText({
        text: value,
        command: activeCommand(value, "use /tdd".length),
        name: "atw-tdd",
        skillNames: SKILLS,
      }),
    ).toEqual({ text: "/atw-tdd use now", cursor: "/atw-tdd use ".length });
  });

  it("appends after the leading known skills in picking order", () => {
    const value = "/atw-tdd fix /ask";
    expect(
      pickSkillText({
        text: value,
        command: activeCommand(value, value.length),
        name: "atw-askme",
        skillNames: SKILLS,
      }),
    ).toEqual({ text: "/atw-tdd /atw-askme fix ", cursor: "/atw-tdd /atw-askme fix ".length });
  });

  it("puts the skill in front of leading slashes that are not skills", () => {
    const value = "/usr/bin/foo fix /ask";
    expect(
      pickSkillText({
        text: value,
        command: activeCommand(value, value.length),
        name: "atw-askme",
        skillNames: SKILLS,
      }),
    ).toEqual({
      text: "/atw-askme /usr/bin/foo fix ",
      cursor: "/atw-askme /usr/bin/foo fix ".length,
    });
  });

  it("appends after a leading known skill followed by a line break", () => {
    const value = "/atw-tdd\nfix /ask";
    expect(
      pickSkillText({
        text: value,
        command: activeCommand(value, value.length),
        name: "atw-askme",
        skillNames: SKILLS,
      }),
    ).toEqual({ text: "/atw-tdd /atw-askme \nfix ", cursor: "/atw-tdd /atw-askme \nfix ".length });
  });

  it("does not insert a name that already leads the text", () => {
    const value = "/atw-askme /atw-tdd fix /atw-tdd";
    expect(
      pickSkillText({
        text: value,
        command: activeCommand(value, value.length),
        name: "atw-tdd",
        skillNames: SKILLS,
      }),
    ).toEqual({ text: "/atw-askme /atw-tdd fix ", cursor: "/atw-askme /atw-tdd fix ".length });
  });
});

describe("pasted skill blocks", () => {
  const file = block({ kind: "file", path: "src/x.ts", entryKind: "file" });

  it("takes skill blocks and their separating space out of pasted content", () => {
    expect(extractSkillBlocks([tdd, text(" see "), file, text(" "), askme, text(" now")])).toEqual({
      blocks: [
        { kind: "skill", name: "atw-tdd" },
        { kind: "skill", name: "atw-askme" },
      ],
      rest: [text("see "), file, text(" now")],
    });
  });

  it("adds skill blocks to the leading ones without duplicates and keeps the caret in the body", () => {
    const result = addLeadingSkillBlocks({
      segments: [tdd, text(" fix it")],
      blocks: [
        { kind: "skill", name: "atw-askme" },
        { kind: "skill", name: "atw-tdd" },
      ],
      cursor: "/atw-tdd fix".length,
    });

    expect(result.segments).toEqual([tdd, text(" "), askme, text(" fix it")]);
    expect(result.cursor).toBe("/atw-tdd /atw-askme fix".length);
  });
});

describe("leading skill blocks", () => {
  it("puts one space after each leading skill block in the composer", () => {
    const parsed = parseInlineSegments("/atw-tdd /atw-askme fix it", { skillNames: SKILLS });
    const { blocks, rest } = splitLeadingSkillBlocks(parsed);
    const composer = leadingSkillSegments(blocks, rest);

    expect(composer).toEqual([tdd, text(" "), askme, text(" fix it")]);
    expect(inlineSegmentsText(composer)).toBe("/atw-tdd /atw-askme fix it");
  });

  it("splits off the one separating space after each leading block", () => {
    expect(splitLeadingSkillBlocks([tdd, text(" "), askme, text("  fix")])).toEqual({
      blocks: [
        { kind: "skill", name: "atw-tdd" },
        { kind: "skill", name: "atw-askme" },
      ],
      rest: [text(" fix")],
    });
  });

  it("tells whether the content has a skill block, so client commands are not recognized", () => {
    const file = block({ kind: "file", path: "src/x.ts", entryKind: "file" });
    expect(hasSkillBlock([tdd, text(" /clear")])).toBe(true);
    expect(hasSkillBlock([text("/clear "), file])).toBe(false);
    expect(hasSkillBlock(null)).toBe(false);
  });
});
