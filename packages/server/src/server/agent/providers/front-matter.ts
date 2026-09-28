export interface ParsedFrontMatter {
  frontMatter: Record<string, string>;
  body: string;
}

export function parseFrontMatter(markdown: string): ParsedFrontMatter {
  const lines = markdown.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { frontMatter: {}, body: markdown };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return { frontMatter: {}, body: markdown };
  }
  const metaLines = lines.slice(1, end);
  const body = lines.slice(end + 1).join("\n");
  const frontMatter: Record<string, string> = {};
  for (const line of metaLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const idx = trimmed.indexOf(":");
    if (idx <= 0) {
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    value = value.replace(/^['"]/, "").replace(/['"]$/, "");
    if (key && value) {
      frontMatter[key] = value;
    }
  }
  return { frontMatter, body };
}
