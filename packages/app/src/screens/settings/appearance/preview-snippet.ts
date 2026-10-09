// A small, syntax-rich TypeScript change rendered side-by-side in the appearance
// preview. BEFORE and AFTER are aligned 1:1 (5 lines each); only the indices in
// CHANGED_LINE_INDICES differ, so the diff tints land on matching rows.

export const PREVIEW_BEFORE: string[] = [
  "// Format a price for display",
  "export function formatPrice(cents: number) {",
  "  const amount = cents / 100;",
  '  return "$" + amount;',
  "}",
];

export const PREVIEW_AFTER: string[] = [
  "// Format a price for display",
  "export function formatPrice(cents: number): string {",
  "  const amount = cents / 100;",
  "  return `$${amount.toFixed(2)}`;",
  "}",
];

export const CHANGED_LINE_INDICES: ReadonlySet<number> = new Set([1, 3]);

// 终端样例的提示符。U+E0A0 是 Powerline 的分支图标，所有 Nerd Font 都带这个字形。
export const PREVIEW_TERMINAL_DIRECTORY = "~/code/osuna";
export const PREVIEW_TERMINAL_BRANCH = "\uE0A0 main";
export const PREVIEW_TERMINAL_COMMAND = "npm run dev";
