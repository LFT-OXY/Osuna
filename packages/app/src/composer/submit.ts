import { i18n } from "@/i18n/i18next";
import { serializeSkillChips, type SkillChip } from "@/composer/skill-chips";

export type AgentInputSubmitResult = "noop" | "queued" | "submitted" | "failed";

export interface AgentInputSubmitActionInput<TAttachment> {
  message: string;
  attachments: TAttachment[];
  /** 发送时拼到 message 开头；清空时一起清，发送失败时恢复成 chip。 */
  skillChips: readonly SkillChip[];
  hasExternalContent?: boolean;
  allowEmptySubmit?: boolean;
  submitBehavior?: "clear" | "preserve-and-lock";
  forceSend?: boolean;
  isAgentRunning: boolean;
  canSubmit: boolean;
  queueMessage: (input: { message: string; attachments: TAttachment[] }) => void;
  submitMessage: (input: { message: string; attachments: TAttachment[] }) => Promise<void>;
  clearDraft: (lifecycle: "sent" | "abandoned") => void;
  setUserInput: (text: string) => void;
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
    input.queueMessage({ message: outgoingMessage, attachments });
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
    await input.submitMessage({ message: outgoingMessage, attachments });
    input.clearDraft("sent");
    input.setIsProcessing(false);
    return "submitted";
  } catch (error) {
    input.onSubmitError?.(error);
    if (shouldClearOnSubmit) {
      input.setUserInput(trimmedBody);
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
