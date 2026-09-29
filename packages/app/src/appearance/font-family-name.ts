// CSS 字体名的解析与格式化。不区分平台，Web 端字体栈解析和本机字体探测共用。

const GENERIC_FONT_FAMILIES: ReadonlySet<string> = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
]);

const CSS_IDENTIFIER = /^-?[A-Za-z_][A-Za-z0-9_-]*$/;

export function isGenericFontFamily(family: string): boolean {
  return GENERIC_FONT_FAMILIES.has(family.toLowerCase());
}

function isQuoted(family: string): boolean {
  return (
    family.length >= 2 &&
    ((family.startsWith('"') && family.endsWith('"')) ||
      (family.startsWith("'") && family.endsWith("'")))
  );
}

// 含空格或特殊字符的字体名补引号；generic 关键字本身是标识符，不会被加引号。
export function formatFontFamily(family: string): string {
  if (isQuoted(family) || CSS_IDENTIFIER.test(family)) return family;
  return `"${family.replace(/"/g, '\\"')}"`;
}

export function splitFontStack(stack: string): string[] {
  return stack
    .split(",")
    .map((family) => family.trim())
    .filter((family) => family.length > 0);
}

// 字体栈里的第一个字体名，去掉引号；空值返回 null。
export function firstFontFamily(stack: string): string | null {
  const [first] = splitFontStack(stack);
  if (first === undefined) return null;
  return isQuoted(first) ? first.slice(1, -1).replace(/\\"/g, '"') : first;
}
