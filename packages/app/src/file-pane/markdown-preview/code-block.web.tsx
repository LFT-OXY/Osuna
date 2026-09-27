/*
 * 代码块头部（语言图标、换行开关、复制）的结构与交互移植自 t3code
 * `apps/web/src/components/ChatMarkdown.tsx` 的 `MarkdownCodeBlock`；着色改用 @getpaseo/highlight，
 * 去掉了 Shiki、fence 标题与「Run in terminal」。
 *
 * MIT License
 *
 * Copyright (c) 2026 T3 Tools Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import * as Clipboard from "expo-clipboard";
import { Check, Copy, WrapText } from "lucide-react-native";
import { TRAILING_CODE_LINE_BREAKS } from "@/assistant-selection-copy/markup";
import { fenceLanguageToExtension } from "@/components/markdown/fence/language";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { useToast } from "@/contexts/toast-context";
import { ICON_SIZE } from "@/styles/theme";
import { highlightToKeyedLines, type KeyedLine } from "@/utils/highlight-cache";

const COPIED_RESET_MS = 1500;

// 图标按「语言的代表性文件名」取：多数高亮键本身就是图标表里的扩展名，
// 这里只列不是（或图标表没收录）的写法，借同类扩展名。
const REPRESENTATIVE_EXTENSIONS: Record<string, string> = {
  zsh: "sh",
  shell: "sh",
  console: "sh",
  mjs: "js",
  cjs: "js",
  htm: "html",
  mdx: "md",
  properties: "ini",
};

function languageIconFileName(extension: string): string {
  return `x.${REPRESENTATIVE_EXTENSIONS[extension] ?? extension}`;
}

function stripTerminalFenceNewline(code: string): string {
  return code.endsWith("\n") ? code.slice(0, -1) : code;
}

function renderHighlightedLines(lines: KeyedLine[]): ReactNode[] {
  const nodes: ReactNode[] = [];
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) nodes.push("\n");
    for (const { key, token } of line.tokens) {
      nodes.push(
        token.style ? (
          <span key={key} data-syntax={token.style}>
            {token.text}
          </span>
        ) : (
          token.text
        ),
      );
    }
  });
  return nodes;
}

function useCopiedFlag(): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    [],
  );
  const markCopied = useCallback(() => {
    setCopied(true);
    if (resetRef.current) clearTimeout(resetRef.current);
    resetRef.current = setTimeout(() => {
      setCopied(false);
      resetRef.current = null;
    }, COPIED_RESET_MS);
  }, []);
  return [copied, markCopied];
}

interface MarkdownCodeBlockProps {
  language: string | null;
  code: string;
}

export const MarkdownCodeBlock = memo(function MarkdownCodeBlock({
  language,
  code,
}: MarkdownCodeBlockProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [wrapped, setWrapped] = useState(false);
  const [copied, markCopied] = useCopiedFlag();
  const extension = fenceLanguageToExtension(language);
  const displayedCode = stripTerminalFenceNewline(code);
  // 无语言、未知语言或超过尺寸上限时为 null，按纯文本显示。
  const lines = useMemo(
    () => highlightToKeyedLines(displayedCode, extension),
    [displayedCode, extension],
  );

  const toggleWrap = useCallback(() => setWrapped((value) => !value), []);
  const copyCode = useCallback(async () => {
    // 去掉结尾空行：贴进终端时，末尾换行会直接执行最后一行。
    const content = code.replace(TRAILING_CODE_LINE_BREAKS, "");
    if (!content) return;
    // Web 端写剪贴板失败时 expo-clipboard 可能返回 false 而不抛错，两种都算失败。
    const written = await Clipboard.setStringAsync(content).catch(() => false);
    if (written) {
      markCopied();
    } else {
      toast.error(t("workspace.tabs.toasts.copyFailed"));
    }
  }, [code, markCopied, t, toast]);

  const wrapLabel = t("panels.file.markdownCodeBlock.wrapLines");
  const copyLabel = copied ? t("message.actions.copied") : t("message.actions.copyCode");

  return (
    <div
      className="md-code-block"
      data-testid="markdown-code-block"
      data-wrap={wrapped ? "true" : "false"}
    >
      <div className="md-code-block-header">
        {language && extension ? (
          <span className="md-code-block-language" data-testid="markdown-code-block-language">
            <MaterialFileIcon fileName={languageIconFileName(extension)} size={ICON_SIZE.sm} />
            <span className="md-code-block-language-name">{language}</span>
          </span>
        ) : null}
        <span className="md-code-block-actions" role="toolbar">
          <button
            type="button"
            className="md-code-block-button"
            aria-pressed={wrapped}
            aria-label={wrapLabel}
            title={wrapLabel}
            onClick={toggleWrap}
          >
            <WrapText aria-hidden size={ICON_SIZE.xs} color="currentColor" />
          </button>
          <button
            type="button"
            className="md-code-block-button"
            aria-label={copyLabel}
            title={copyLabel}
            onClick={copyCode}
          >
            {copied ? (
              <Check aria-hidden size={ICON_SIZE.xs} color="currentColor" />
            ) : (
              <Copy aria-hidden size={ICON_SIZE.xs} color="currentColor" />
            )}
          </button>
        </span>
      </div>
      {/* data-pmono 让全局界面字体规则跳过代码（见 styles/code-surface.ts）。 */}
      <pre data-pmono="">
        <code data-pmono="">{lines ? renderHighlightedLines(lines) : displayedCode}</code>
      </pre>
    </div>
  );
});
