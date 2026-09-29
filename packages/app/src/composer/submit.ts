import { i18n } from "@/i18n/i18next";
import { serializeSkillChips, withSkillChipBlocks, type SkillChip } from "@/composer/skill-chips";
import { trimInlineSegments, type InlineSegment } from "@/inline-blocks";

export type AgentInputSubmitResult = "noop" | "queued" | "submitted" | "failed";

export interface OutgoingSegmentsInput {
  chips: readonly SkillChip[];
  segments: readonly InlineSegment[] | null;
}

/**
 * 发出的消息的分段结构（排队项、交给草稿 tab 的提交用它恢复块）：输入框内容按发出的文字同样 trim，
 * chip 放在开头作为 Skill block。输入框没有分段结构（原生端）时为 null，只有文字。
 */
export function resolveOutgoingSegments(input: OutgoingSegmentsInput): InlineSegment[] | null {
  if (!input.segments) return null;
  return withSkillChipBlocks(input.chips, trimInlineSegments(input.segments));
}

export interface OutgoingAgentInput<TAttachment> {
  message: string;
  segments: InlineSegment[] | null;
  attachments: TAttachment[];
}

export interface AgentInputSubmitActionInput<TAttachment> {
  message: string;
  /** 输入框里 message 的分段结构，原生端为 null；排队与发送失败恢复时保住块。 */
  segments: readonly InlineSegment[] | null;
  attachments: TAttachment[];
  /** 发送时拼到 message 开头；清空时一起清，发送失败时恢复成 chip。 */
  skillChips: readonly SkillChip[];
  hasExternalContent?: boolean;
  allowEmptySubmit?: boolean;
  submitBehavior?: "clear" | "preserve-and-lock";
  forceSend?: boolean;
  isAgentRunning: boolean;
  canSubmit: boolean;
  queueMessage: (input: OutgoingAgentInput<TAttachment>) => void;
  submitMessage: (input: OutgoingAgentInput<TAttachment>) => Promise<void>;
  clearDraft: (lifecycle: "sent" | "abandoned") => void;
  setUserInput: (text: string, segments?: readonly InlineSegment[]) => void;
  setAttachments: (attachments: TAttachment[]) => void;
  setSkillChips: (chips: readonly SkillChip[]) => void;
  setSendError: (message: string | null) => void;
  setIsProcessing: (isProcessing: boolean) => void;
  onSubmitError?: (error: unknown) => void;
  failedToSendMessage?: string;
}

export async function submitAgentInput<TAttachment>(
  input: AgentInputSubmitActionInput<TAttachment>,
): Promise<AgentInputSubmitResult> {
  const trimmedBody = input.message.trim();
  const skillChips = input.skillChips;
  const outgoingMessage = serializeSkillChips({ chips: skillChips, text: trimmedBody });
  const outgoingSegments = resolveOutgoingSegments({ chips: skillChips, segments: input.segments });
  const attachments = input.attachments;
  const shouldClearOnSubmit = input.submitBehavior !== "preserve-and-lock";

  if (
    !outgoingMessage &&
    attachments.length === 0 &&
    !input.hasExternalContent &&
    !input.allowEmptySubmit
  ) {
    return "noop";
  }

  if (!input.canSubmit) {
    return "noop";
  }

  if (input.isAgentRunning && !input.forceSend) {
    input.queueMessage({ message: outgoingMessage, segments: outgoingSegments, attachments });
    if (shouldClearOnSubmit) {
      input.setUserInput("");
      input.setAttachments([]);
      input.setSkillChips([]);
    }
    return "queued";
  }

  // Clear immediately so the submitted timeline row and composer state stay in sync.
  if (shouldClearOnSubmit) {
    input.setUserInput("");
    input.setAttachments([]);
    input.setSkillChips([]);
  }
  input.setSendError(null);
  input.setIsProcessing(true);

  try {
    await input.submitMessage({
      message: outgoingMessage,
      segments: outgoingSegments,
      attachments,
    });
    input.clearDraft("sent");
    input.setIsProcessing(false);
    return "submitted";
  } catch (error) {
    input.onSubmitError?.(error);
    if (shouldClearOnSubmit) {
      if (input.segments) input.setUserInput(trimmedBody, trimInlineSegments(input.segments));
      else input.setUserInput(trimmedBody);
      input.setAttachments(attachments);
      input.setSkillChips(skillChips);
    }
    input.setSendError(
      error instanceof Error
        ? error.message
        : (input.failedToSendMessage ?? i18n.t("composer.errors.failedToSend")),
    );
    input.setIsProcessing(false);
    return "failed";
  }
}
