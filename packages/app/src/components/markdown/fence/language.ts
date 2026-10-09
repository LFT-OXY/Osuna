export function getMarkdownFenceLanguage(info: string | null | undefined): string | null {
  return info?.trim().split(/\s+/)[0]?.toLowerCase() || null;
}

// Fence info strings ("```ts", "```typescript", "```ts {1,3}") map to the
// extension-based parser table in @osuna/highlight. Aliases here only
// cover names that don't already match an extension key in parsers.ts.
const LANGUAGE_ALIASES: Record<string, string> = {
  typescript: "ts",
  javascript: "js",
  python: "py",
  rust: "rs",
  golang: "go",
  "c++": "cpp",
  csharp: "cs",
  "c#": "cs",
  objc: "m",
  "objective-c": "m",
  markdown: "md",
  elixir: "ex",
};

export function fenceLanguageToExtension(info: string | null | undefined): string | null {
  const first = getMarkdownFenceLanguage(info);
  if (!first) return null;
  const normalized = first.replace(/^\./, "");
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}
