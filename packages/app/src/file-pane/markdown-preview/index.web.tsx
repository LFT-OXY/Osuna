import { useInsertionEffect, useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import type { Theme } from "@/styles/theme";
import { DomMarkdown } from "./dom-markdown.web";
import { parseMarkdownPreviewDocument, type MarkdownFrontMatterRow } from "./document";
import type { MarkdownPreviewResources } from "./resource";
import {
  installMarkdownPreviewStyles,
  MARKDOWN_PREVIEW_CLASS_NAME,
  markdownPreviewThemeVariables,
  type MarkdownPreviewThemeVariables,
} from "./styles.web";

interface MarkdownPreviewSurfaceProps {
  themeVariables: MarkdownPreviewThemeVariables;
  children: ReactNode;
}

function MarkdownPreviewSurface({ themeVariables, children }: MarkdownPreviewSurfaceProps) {
  return (
    <div
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
}

export function FileMarkdownPreview({ source, resources }: FileMarkdownPreviewProps) {
  const document = useMemo(() => parseMarkdownPreviewDocument(source), [source]);
  useInsertionEffect(installMarkdownPreviewStyles, []);

  return (
    <View style={styles.outerGutter}>
      <View style={styles.readingFrame}>
        <ThemedMarkdownPreviewSurface uniProps={mapThemeVariables}>
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
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    paddingHorizontal: theme.spacing[2],
  },
}));
