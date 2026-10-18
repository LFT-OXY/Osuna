// 每个文件先列几行、其余折叠照 magpie（https://github.com/yetone/magpie）internal/gui/assets/app.js 的 changesList。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type {
  ApiEndpointSwitchOffFile,
  ApiEndpointSwitchOffLine,
  ApiEndpointSwitchOffPreview,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";

/*
 * 关「使用第三方接口」确认框里的预览：主机算好的逐文件改动，照 magpie 的 changesList 摆——每个文件先列 8 行，
 * 多出 2 行以上时其余折叠成「还有 N 行」。主机给了认不出的改动种类（更新的主机）就整份改用文字说明。
 */

// 每个文件先列几行；只多一两行时不折叠（magpie 的 FEW 与 FEW + 2）。
const FIRST_LINES = 8;
const MOST_UNFOLDED = FIRST_LINES + 2;

export type SwitchOffLineKind = "removed" | "added" | "restored";
export type SwitchOffFileKind = "edited" | "created" | "removed";

export interface SwitchOffLineView {
  // 在这个文件的改动里排第几，列表里认行用（同一个文件可能有两行一模一样）。
  position: number;
  kind: SwitchOffLineKind;
  text: string;
  // 改回的一行现在是什么样；别的为 null。
  was: string | null;
}

export interface SwitchOffFileView {
  path: string;
  kind: SwitchOffFileKind;
  firstLines: SwitchOffLineView[];
  // 折叠在「还有 N 行」后面的。
  foldedLines: SwitchOffLineView[];
}

export type SwitchOffPreviewInput =
  | { status: "loading" }
  | { status: "answered"; preview: ApiEndpointSwitchOffPreview }
  // 主机算不出（如文件读不懂）或请求失败，`reason` 已是给用户看的话。
  | { status: "failed"; reason: string };

export type SwitchOffPreviewView =
  | { status: "loading" }
  | { status: "listed"; files: SwitchOffFileView[] }
  // 没有逐条可列的：没有要改的、主机算不出（带原因）或给了认不出的改动种类。
  | { status: "described"; reason: string | null };

export function selectSwitchOffPreview(input: SwitchOffPreviewInput): SwitchOffPreviewView {
  if (input.status === "loading") return { status: "loading" };
  if (input.status === "failed") return { status: "described", reason: input.reason };
  const { files } = input.preview;
  if (files.length === 0) return { status: "described", reason: null };
  const views: SwitchOffFileView[] = [];
  for (const file of files) {
    const view = toFileView(file);
    // 认不出的改动种类（更新的主机）：整份改用文字说明。
    if (view === null) return { status: "described", reason: null };
    views.push(view);
  }
  return { status: "listed", files: views };
}

function toFileView(file: ApiEndpointSwitchOffFile): SwitchOffFileView | null {
  const kind = fileKind(file.change);
  if (kind === null) return null;
  const lines: SwitchOffLineView[] = [];
  for (const [position, line] of file.lines.entries()) {
    const view = toLineView(line, position);
    if (view === null) return null;
    lines.push(view);
  }
  if (lines.length <= MOST_UNFOLDED) {
    return { path: file.path, kind, firstLines: lines, foldedLines: [] };
  }
  const firstLines = lines.slice(0, FIRST_LINES);
  const foldedLines = lines.slice(FIRST_LINES);
  return { path: file.path, kind, firstLines, foldedLines };
}

function toLineView(line: ApiEndpointSwitchOffLine, position: number): SwitchOffLineView | null {
  const kind = lineKind(line.op);
  if (kind === null) return null;
  return { position, kind, text: line.text, was: line.was ?? null };
}

function fileKind(change: string): SwitchOffFileKind | null {
  switch (change) {
    case "edited":
    case "created":
    case "removed":
      return change;
    default:
      return null;
  }
}

function lineKind(op: string): SwitchOffLineKind | null {
  switch (op) {
    case "removed":
    case "added":
    case "restored":
      return op;
    default:
      return null;
  }
}
