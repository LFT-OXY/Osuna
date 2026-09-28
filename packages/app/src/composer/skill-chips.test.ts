import { describe, expect, it } from "vitest";
import { findActiveSlashCommand } from "@/utils/agent-command-autocomplete";
import {
  appendSkillChip,
  pickSkillChip,
  removeLastSkillChip,
  removeSkillChip,
  resolveSkillChipBackspace,
  resolveSkillChipSubmission,
  serializeSkillChips,
  type SkillChip,
} from "./skill-chips";

function activeCommand(text: string, cursorIndex: number) {
  const command = findActiveSlashCommand({ text, cursorIndex });
  if (!command) throw new Error(`no slash command in ${JSON.stringify(text)}`);
  return command;
}

const askme: SkillChip = { name: "atw-askme", description: "Ask me questions" };
const tdd: SkillChip = { name: "atw-tdd" };

describe("pickSkillChip", () => {
  it("removes a leading /query and the space after it, leaving the cursor at the start", () => {
    const text = "/atw- write tests";
    const result = pickSkillChip({
      text,
      command: activeCommand(text, "/atw-".length),
      chips: [],
      chip: askme,
    });

    expect(result).toEqual({ text: "write tests", cursor: 0, chips: [askme] });
  });

  it("removes a mid-prompt /query where it was typed", () => {
    const text = "use /tdd before implementation";
    const result = pickSkillChip({
      text,
      command: activeCommand(text, "use /tdd".length),
      chips: [],
      chip: tdd,
    });

    expect(result).toEqual({
      text: "use before implementation",
      cursor: "use ".length,
      chips: [tdd],
    });
  });

  it("leaves an empty prompt when the /query was all there was", () => {
    const text = "/atw";
    const result = pickSkillChip({
      text,
      command: activeCommand(text, text.length),
      chips: [],
      chip: askme,
    });

    expect(result).toEqual({ text: "", cursor: 0, chips: [askme] });
  });

  it("appends in picking order", () => {
    const text = "/tdd";
    const result = pickSkillChip({
      text,
      command: activeCommand(text, text.length),
      chips: [askme],
      chip: tdd,
    });

    expect(result.chips.map((chip) => chip.name)).toEqual(["atw-askme", "atw-tdd"]);
  });

  it("does not add a second chip with the same name", () => {
    const text = "/atw-askme";
    const result = pickSkillChip({
      text,
      command: activeCommand(text, text.length),
      chips: [askme, tdd],
      chip: { name: "atw-askme" },
    });

    expect(result).toEqual({ text: "", cursor: 0, chips: [askme, tdd] });
  });
});

describe("appendSkillChip", () => {
  it("appends a new chip and ignores a name already picked", () => {
    expect(appendSkillChip([askme], tdd)).toEqual([askme, tdd]);
    expect(appendSkillChip([askme, tdd], { name: "atw-tdd" })).toEqual([askme, tdd]);
  });
});

describe("removeSkillChip", () => {
  it("removes the named chip and keeps the rest in order", () => {
    expect(removeSkillChip([askme, tdd], "atw-askme")).toEqual([tdd]);
  });

  it("returns the same chips when the name is absent", () => {
    const chips = [askme];
    expect(removeSkillChip(chips, "missing")).toBe(chips);
  });
});

describe("removeLastSkillChip", () => {
  it("removes the most recently picked chip", () => {
    expect(removeLastSkillChip([askme, tdd])).toEqual([askme]);
  });

  it("returns the same empty list when there is nothing to remove", () => {
    const chips: SkillChip[] = [];
    expect(removeLastSkillChip(chips)).toBe(chips);
  });
});

describe("resolveSkillChipBackspace", () => {
  const atStart = { start: 0, end: 0 };

  it("removes the last chip when the caret sits at the start with nothing selected", () => {
    expect(
      resolveSkillChipBackspace({ key: "Backspace", selection: atStart, chips: [askme, tdd] }),
    ).toEqual([askme]);
  });

  it("leaves the chips to the text when the caret is past the start", () => {
    expect(
      resolveSkillChipBackspace({
        key: "Backspace",
        selection: { start: 3, end: 3 },
        chips: [askme],
      }),
    ).toBeNull();
  });

  it("leaves the chips to the text when a selection starts at the start", () => {
    expect(
      resolveSkillChipBackspace({
        key: "Backspace",
        selection: { start: 0, end: 4 },
        chips: [askme],
      }),
    ).toBeNull();
  });

  it("ignores other keys and an empty chip list", () => {
    expect(resolveSkillChipBackspace({ key: "Delete", selection: atStart, chips: [askme] })).toBe(
      null,
    );
    expect(resolveSkillChipBackspace({ key: "Backspace", selection: atStart, chips: [] })).toBe(
      null,
    );
  });
});

describe("serializeSkillChips", () => {
  it("puts every chip in front of the prompt in picking order", () => {
    expect(serializeSkillChips({ chips: [askme, tdd], text: "fix the bug" })).toBe(
      "/atw-askme /atw-tdd fix the bug",
    );
  });

  it("sends only the chips when the prompt is empty", () => {
    expect(serializeSkillChips({ chips: [askme, tdd], text: "  " })).toBe("/atw-askme /atw-tdd");
  });

  it("sends the prompt untouched when there are no chips", () => {
    expect(serializeSkillChips({ chips: [], text: "  hello  " })).toBe("  hello  ");
  });
});

describe("resolveSkillChipSubmission", () => {
  it("recognizes client commands when there are no chips", () => {
    expect(resolveSkillChipSubmission({ chips: [], text: "/clear" })).toEqual({
      message: "/clear",
      recognizesClientCommands: true,
    });
  });

  it("sends a client command name as an ordinary message when chips are present", () => {
    expect(resolveSkillChipSubmission({ chips: [askme], text: "/clear" })).toEqual({
      message: "/atw-askme /clear",
      recognizesClientCommands: false,
    });
  });
});
