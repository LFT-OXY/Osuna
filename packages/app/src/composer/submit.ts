import { i18n } from "@/i18n/i18next";
import { serializeInlineSegments, trimInlineSegments, type InlineSegment } from "@/inline-blocks";

export type AgentInputSubmitResult = "noop" | "queued" | "submitted" | "failed";

export interface OutgoingMessageInput {
  text: string;
  /** 输入框的分段结构，原生端为 null。 */
  segments: readonly InlineSegment[] | null;
}

export interface OutgoingMessage {
  message: string;
  /** 发出的消息的分段结构（排队项、交给草稿 tab 的提交用它恢复块），原生端为 null。 */
  segments: InlineSegment[] | null;
}

/**
 * 发出的文字：有分段结构时按它序列化，开头的 Skill block 拼成 `/a /b`，与正文之间一个空格；
 * 分段结构按文字同样 trim。
 */
export function resolveOutgoingMessage(input: OutgoingMessageInput): OutgoingMessage {
  if (!input.segments) return { message: input.text.trim(), segments: null };
  const segments = trimInlineSegments(input.segments);
  return { message: serializeInlineSegments(segments), segments };
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
  setSendError: (message: string | null) => void;
  setIsProcessing: (isProcessing: boolean) => void;
  onSubmitError?: (error: unknown) => void;
  failedToSendMessage?: string;
}

export async function submitAgentInput<TAttachment>(
  input: AgentInputSubmitActionInput<TAttachment>,
): Promise<AgentInputSubmitResult> {
  const trimmedText = input.message.trim();
  const outgoing = resolveOutgoingMessage({ text: input.message, segments: input.segments });
  const outgoingMessage = outgoing.message;
  const outgoingSegments = outgoing.segments;
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
    }
    return "queued";
  }

  // Clear immediately so the submitted timeline row and composer state stay in sync.
  if (shouldClearOnSubmit) {
    input.setUserInput("");
    input.setAttachments([]);
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
      if (outgoingSegments) input.setUserInput(trimmedText, outgoingSegments);
      else input.setUserInput(trimmedText);
      input.setAttachments(attachments);
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
