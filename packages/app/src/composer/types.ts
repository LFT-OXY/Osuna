import type { AttachmentMetadata, ComposerAttachment } from "@/attachments/types";
import type { InlineSegment } from "@/inline-blocks";

export type ImageAttachment = AttachmentMetadata;

export interface MessagePayload {
  text: string;
  /** 发出的消息的分段结构，交给别处提交时用来在失败后恢复块。 */
  segments?: readonly InlineSegment[];
  attachments: ComposerAttachment[];
  cwd: string;
  forceSend?: boolean;
}

export interface TextReplacement {
  key: string;
  text: string;
  /** 有时以它整体替换输入框内容，块仍是块；原生端只写 text。 */
  segments?: readonly InlineSegment[];
}
