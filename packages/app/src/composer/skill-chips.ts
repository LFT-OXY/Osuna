import { z } from "zod";
import type { SlashCommandRange } from "@/utils/agent-command-autocomplete";

/** Command menu 里选中的一个 skill；description 只用于悬停提示。随草稿持久化。 */
export const SkillChipSchema = z.strictObject({
  name: z.string(),
  description: z.string().optional(),
});
export type SkillChip = z.infer<typeof SkillChipSchema>;

export type SkillChipUpdater = (current: readonly SkillChip[]) => readonly SkillChip[];

export interface PickSkillChipResult {
  text: string;
  cursor: number;
  chips: readonly SkillChip[];
}

/** 把正文里的 `/query`（连同紧随的一个空格）换成一个 chip，光标留在原来 `/` 的位置。 */
export function pickSkillChip(input: {
  text: string;
  command: SlashCommandRange;
  chips: readonly SkillChip[];
  chip: SkillChip;
}): PickSkillChipResult {
  const { text, command } = input;
  const end = text[command.end] === " " ? command.end + 1 : command.end;
  return {
    text: text.slice(0, command.start) + text.slice(end),
    cursor: command.start,
    chips: appendSkillChip(input.chips, input.chip),
  };
}

/** 按选中顺序追加，同名不重复。 */
export function appendSkillChip(
  chips: readonly SkillChip[],
  chip: SkillChip,
): readonly SkillChip[] {
  if (chips.some((picked) => picked.name === chip.name)) return chips;
  return [...chips, chip];
}

export function removeSkillChip(chips: readonly SkillChip[], name: string): readonly SkillChip[] {
  if (!chips.some((chip) => chip.name === name)) return chips;
  return chips.filter((chip) => chip.name !== name);
}

export function removeLastSkillChip(chips: readonly SkillChip[]): readonly SkillChip[] {
  if (chips.length === 0) return chips;
  return chips.slice(0, -1);
}

/** 发送时 chip 按选中顺序拼回正文开头，与手打 `/a /b 正文` 等价。 */
export function serializeSkillChips(input: { chips: readonly SkillChip[]; text: string }): string {
  if (input.chips.length === 0) return input.text;
  const prefix = input.chips.map((chip) => `/${chip.name}`).join(" ");
  const body = input.text.trim();
  return body ? `${prefix} ${body}` : prefix;
}

/** 有 chip 时整条是普通消息，正文里的 `/clear` 之类不能被当作客户端命令立即执行。 */
export function resolveSkillChipSubmission(input: { chips: readonly SkillChip[]; text: string }): {
  message: string;
  recognizesClientCommands: boolean;
} {
  return {
    message: serializeSkillChips(input),
    recognizesClientCommands: input.chips.length === 0,
  };
}
