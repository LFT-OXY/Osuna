import { useInsertionEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { DomMarkdown } from "./dom-markdown.web";
import { parseMarkdownPreviewDocument, type MarkdownFrontMatterRow } from "./document";
import type { MarkdownPreviewResources } from "./resource";
import { useScrollToSourceLine } from "./source-line.web";
import {
  installMarkdownPreviewStyles,
  MARKDOWN_PREVIEW_CLASS_NAME,
  markdownPreviewThemeVariables,
  type MarkdownPreviewThemeVariables,
} from "./styles.web";

/** Web 版的渲染预览能滚到指定行（useScrollToSourceLine）；带行号打开 Markdown 时不必退回源码视图。 */
export const MARKDOWN_PREVIEW_SCROLLS_TO_LINE = true;

interface MarkdownPreviewSurfaceProps {
  themeVariables: MarkdownPreviewThemeVariables;
  surfaceRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}

function MarkdownPreviewSurface({
  themeVariables,
  surfaceRef,
  children,
}: MarkdownPreviewSurfaceProps) {
  return (
    <div
      ref={surfaceRef}
      className={MARKDOWN_PREVIEW_CLASS_NAME}
      data-testid="file-markdown-preview"
      style={themeVariables}
    >
      {children}
    </div>
  );
}

const ThemedMarkdownPreviewSurface = withUnistyles(MarkdownPreviewSurface);
function mapThemeVariables(theme: Theme) {
  return { themeVariables: markdownPreviewThemeVariables(theme) };
}

interface FrontMatterTableProps {
  rows: MarkdownFrontMatterRow[];
}

function FrontMatterTable({ rows }: FrontMatterTableProps) {
  return (
    <div className="md-front-matter" data-testid="markdown-front-matter">
      {rows.map((row) => (
        <div key={row.key} className="md-front-matter-row">
          <div className="md-front-matter-key">{row.key}</div>
          <div className="md-front-matter-value">{row.value}</div>
        </div>
      ))}
    </div>
  );
}

interface FileMarkdownPreviewProps {
  source: string;
  resources: MarkdownPreviewResources;
  /** 打开时滚到原文件的这一行（从 1 起）所在的块。 */
  lineStart?: number;
  /** 同一行再打开一次时加一，让预览重新滚过去。 */
  navigationRevision: number;
}

export function FileMarkdownPreview({
  source,
  resources,
  lineStart,
  navigationRevision,
}: FileMarkdownPreviewProps) {
  const document = useMemo(() => parseMarkdownPreviewDocument(source), [source]);
  useInsertionEffect(installMarkdownPreviewStyles, []);
  const surfaceRef = useRef<HTMLDivElement>(null);
  useScrollToSourceLine({
    surfaceRef,
    lineStart,
    bodyStartLine: document.bodyStartLine,
    navigationRevision,
  });

  return (
    <View style={styles.outerGutter}>
      <View style={styles.readingFrame} testID="markdown-preview-frame">
        <ThemedMarkdownPreviewSurface surfaceRef={surfaceRef} uniProps={mapThemeVariables}>
          {document.frontMatter.length > 0 ? (
            <FrontMatterTable rows={document.frontMatter} />
          ) : null}
          <DomMarkdown source={document.body} resources={resources} />
        </ThemedMarkdownPreviewSurface>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  outerGutter: {
    width: "100%",
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[4],
    },
    paddingVertical: theme.spacing[4],
  },
  readingFrame: {
    width: "100%",
    maxWidth: theme.contentMaxWidth,
    alignSelf: "center",
    paddingHorizontal: theme.spacing[2],
  },
}));
