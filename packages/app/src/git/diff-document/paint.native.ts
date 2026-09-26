import {
  ClipOp,
  Skia,
  type SkCanvas,
  type SkPaint,
  type SkPicture,
} from "@shopify/react-native-skia";
import {
  DIFF_FILE_HEADER_CONTENT_HEIGHT,
  DIFF_FILE_HEADER_HEIGHT,
  DIFF_FILE_CHANGE_SLOT_SIZE,
  DIFF_FILE_HEADER_LEFT,
  DIFF_FILE_HEADER_RIGHT,
  DIFF_FILE_HEADER_TEXT_GAP,
  allocateDiffHeaderTextWidths,
  diffFileChangeKind,
  diffFileChangePresentation,
  directorySuffix,
  fileNameForPath,
  formatDiffCount,
} from "@/git/file-header-presentation";
import { DIFF_BODY_BORDER_HEIGHT, expandedBodyBorderTop, visibleRowRange } from "./model";
import { nativeTextRuns } from "./native-text-runs";
import { horizontalOffsetForPath, type DiffHorizontalOffsets } from "./horizontal-offsets";
import {
  DIFF_CHANGE_BAR_WIDTH,
  changeBarTone,
  codeLineNumberTone,
  diffSeparatorLayout,
} from "./palette";
import { reviewBackgroundPaint, reviewDividerHeight, reviewGapTop } from "./review-paint";
import {
  shapeNativeHeaderText,
  type NativeHeaderTextLayout,
  type NativeShapedHeaderText,
  type NativeTextLayout,
} from "./text.native";
import type {
  DiffCell,
  DiffDocumentModel,
  DiffFileSection,
  DiffLineRow,
  DiffPalette,
  DiffSeparatorRow,
} from "./types";

const CODE_LEFT_PADDING = 8;

export interface NativePaints {
  surface: SkPaint;
  border: SkPaint;
  foreground: SkPaint;
  foregroundMuted: SkPaint;
  addition: SkPaint;
  deletion: SkPaint;
  additionBackground: SkPaint;
  deletionBackground: SkPaint;
  headerBorder: SkPaint;
  emptyBackground: SkPaint;
  text: Record<string, SkPaint>;
}

export function createNativePaints(palette: DiffPalette): NativePaints {
  return {
    surface: paint(palette.surface),
    border: paint(palette.border),
    foreground: paint(palette.foreground),
    foregroundMuted: paint(palette.foregroundMuted),
    addition: paint(palette.addition),
    deletion: paint(palette.deletion),
    additionBackground: paint(palette.additionBackground),
    deletionBackground: paint(palette.deletionBackground),
    headerBorder: paint(palette.headerBorder),
    emptyBackground: paint(palette.emptyBackground),
    text: Object.fromEntries(
      [
        ...new Set([palette.foreground, palette.foregroundMuted, ...Object.values(palette.syntax)]),
      ].map((color) => [color, paint(color)]),
    ),
  };
}

export function recordNativeHeaderPicture(input: {
  file: DiffFileSection;
  viewportWidth: number;
  textLayout: NativeHeaderTextLayout;
  paints: NativePaints;
}): SkPicture {
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(
    Skia.XYWHRect(0, 0, input.viewportWidth, DIFF_FILE_HEADER_HEIGHT),
  );
  canvas.drawRect(
    Skia.XYWHRect(0, DIFF_FILE_HEADER_HEIGHT - 1, input.viewportWidth, 1),
    input.paints.headerBorder,
  );
  const changeSlotX = input.viewportWidth - DIFF_FILE_HEADER_RIGHT - DIFF_FILE_CHANGE_SLOT_SIZE;
  const additions = `+${formatDiffCount(input.file.file.additions)}`;
  const deletions = `-${formatDiffCount(input.file.file.deletions)}`;
  const additionsText = shapeNativeHeaderText({
    layout: input.textLayout,
    text: additions,
    size: "stat",
    tone: "statusSuccess",
  });
  const deletionsText = shapeNativeHeaderText({
    layout: input.textLayout,
    text: deletions,
    size: "stat",
    tone: "statusDanger",
  });
  const statX = changeSlotX - 8 - additionsText.width - 4 - deletionsText.width;
  paintNativeHeaderText(canvas, additionsText, statX);
  paintNativeHeaderText(canvas, deletionsText, statX + additionsText.width + 4);
  const change = diffFileChangePresentation(diffFileChangeKind(input.file.file));
  const changeText = shapeNativeHeaderText({
    layout: input.textLayout,
    text: change.letter,
    size: "micro",
    weight: "semibold",
    tone: change.tone,
  });
  paintNativeHeaderText(
    canvas,
    changeText,
    changeSlotX + (DIFF_FILE_CHANGE_SLOT_SIZE - changeText.width) / 2,
  );

  const available = Math.max(0, statX - DIFF_FILE_HEADER_LEFT);
  const name = fileNameForPath(input.file.path);
  const directory = directorySuffix(input.file.path).trimStart();
  const fitted = fitNativeHeaderText(input.textLayout, name, directory, available);
  canvas.save();
  canvas.clipRect(
    Skia.XYWHRect(DIFF_FILE_HEADER_LEFT, 0, available, DIFF_FILE_HEADER_CONTENT_HEIGHT),
    ClipOp.Intersect,
    false,
  );
  paintNativeHeaderText(canvas, fitted.name, DIFF_FILE_HEADER_LEFT);
  if (fitted.directory.width > 0) {
    paintNativeHeaderText(
      canvas,
      fitted.directory,
      DIFF_FILE_HEADER_LEFT + fitted.name.width + DIFF_FILE_HEADER_TEXT_GAP,
    );
  }
  canvas.restore();
  const picture = recorder.finishRecordingAsPicture();
  additionsText.paragraph.dispose();
  deletionsText.paragraph.dispose();
  changeText.paragraph.dispose();
  fitted.name.paragraph.dispose();
  fitted.directory.paragraph.dispose();
  return picture;
}

function paintNativeHeaderText(canvas: SkCanvas, text: NativeShapedHeaderText, x: number): void {
  text.paragraph.paint(canvas, x, (DIFF_FILE_HEADER_CONTENT_HEIGHT - text.height) / 2);
}

function fitNativeHeaderText(
  layout: NativeHeaderTextLayout,
  name: string,
  directory: string,
  available: number,
): { name: NativeShapedHeaderText; directory: NativeShapedHeaderText } {
  let nameText = shapeNativeHeaderText({ layout, text: name, size: "body", tone: "foreground" });
  let directoryText = shapeNativeHeaderText({
    layout,
    text: directory,
    size: "body",
    tone: "foregroundMuted",
  });
  if (nameText.width + (directory ? 4 + directoryText.width : 0) <= available) {
    return { name: nameText, directory: directoryText };
  }

  const widths = allocateDiffHeaderTextWidths({
    available,
    nameWidth: nameText.width,
    directoryWidth: directoryText.width,
  });
  if (widths.name < nameText.width) {
    nameText.paragraph.dispose();
    nameText = shapeNativeHeaderText({
      layout,
      text: name,
      size: "body",
      tone: "foreground",
      maximumWidth: widths.name,
    });
  }
  directoryText.paragraph.dispose();
  directoryText = shapeNativeHeaderText({
    layout,
    text: widths.directory > 0 ? directory : "",
    size: "body",
    tone: "foregroundMuted",
    maximumWidth: widths.directory,
  });
  return { name: nameText, directory: directoryText };
}

function paint(color: string): SkPaint {
  const result = Skia.Paint();
  result.setColor(Skia.Color(color));
  return result;
}

export function paintNativeViewport(input: {
  canvas: SkCanvas;
  model: DiffDocumentModel;
  viewportWidth: number;
  viewportHeight: number;
  scrollTop: number;
  horizontalOffsets: Readonly<DiffHorizontalOffsets>;
  textLayout: NativeTextLayout;
  headerTextLayout: NativeHeaderTextLayout;
  paints: NativePaints;
}): void {
  paintNativeRange({ ...input, layer: "all" });
}

export function recordNativeSlabPictures(input: {
  model: DiffDocumentModel;
  fileIndex: number;
  top: number;
  height: number;
  viewportWidth: number;
  textLayout: NativeTextLayout;
  headerTextLayout: NativeHeaderTextLayout;
  paints: NativePaints;
}): {
  fixed: SkPicture;
  gutter: SkPicture;
  content: { unified: SkPicture; left: SkPicture; right: SkPicture };
} {
  const file = input.model.files[input.fileIndex];
  const fixedRecorder = Skia.PictureRecorder();
  const fixedCanvas = fixedRecorder.beginRecording(
    Skia.XYWHRect(0, 0, input.viewportWidth, input.height),
  );
  paintNativeRange({
    canvas: fixedCanvas,
    model: input.model,
    viewportWidth: input.viewportWidth,
    viewportHeight: input.height,
    scrollTop: input.top,
    horizontalOffsets: {},
    textLayout: input.textLayout,
    headerTextLayout: input.headerTextLayout,
    paints: input.paints,
    layer: "fixed",
    fileIndex: input.fileIndex,
  });

  const recordContent = (contentCell: "unified" | "left" | "right") => {
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(
      Skia.XYWHRect(0, 0, Math.max(input.viewportWidth, file?.contentWidth ?? 0), input.height),
    );
    paintNativeRange({
      canvas,
      model: input.model,
      viewportWidth: input.viewportWidth,
      viewportHeight: input.height,
      scrollTop: input.top,
      horizontalOffsets: {},
      textLayout: input.textLayout,
      headerTextLayout: input.headerTextLayout,
      paints: input.paints,
      layer: "content",
      contentCell,
    });
    return recorder.finishRecordingAsPicture();
  };
  const gutterRecorder = Skia.PictureRecorder();
  const gutterCanvas = gutterRecorder.beginRecording(
    Skia.XYWHRect(0, 0, input.viewportWidth, input.height),
  );
  paintNativeGutter({
    canvas: gutterCanvas,
    model: input.model,
    top: input.top,
    height: input.height,
    textLayout: input.textLayout,
    paints: input.paints,
  });
  return {
    fixed: fixedRecorder.finishRecordingAsPicture(),
    gutter: gutterRecorder.finishRecordingAsPicture(),
    content: {
      unified: recordContent("unified"),
      left: recordContent("left"),
      right: recordContent("right"),
    },
  };
}

function paintNativeGutter(input: {
  canvas: SkCanvas;
  model: DiffDocumentModel;
  top: number;
  height: number;
  textLayout: NativeTextLayout;
  paints: NativePaints;
}): void {
  const range = visibleRowRange(input.model.rows, input.top, input.height);
  for (let index = range.start; index < range.end; index += 1) {
    const row = input.model.rows[index];
    if (!row || row.kind !== "line") continue;
    const file = input.model.files[row.fileIndex];
    if (!file) continue;
    const y = row.top - input.top;
    const columnWidth = input.model.viewportWidth / row.cells.length;
    row.cells.forEach((cell, cellIndex) => {
      if (!cell) return;
      const columnX = cellIndex * columnWidth;
      input.canvas.drawRect(
        Skia.XYWHRect(columnX + file.gutterWidth, y, 1, reviewDividerHeight(row.height)),
        input.paints.border,
      );
      const label = String(cell.lineNumber ?? "");
      const font = input.textLayout.font;
      input.canvas.drawText(
        label,
        columnX + file.gutterWidth - 7 - font.getTextWidth(label),
        y + input.model.lineHeight * 0.78,
        input.paints[codeLineNumberTone(cell)],
        font,
      );
    });
  }
}

interface PaintNativeRangeInput {
  canvas: SkCanvas;
  model: DiffDocumentModel;
  viewportWidth: number;
  viewportHeight: number;
  scrollTop: number;
  horizontalOffsets: Readonly<DiffHorizontalOffsets>;
  textLayout: NativeTextLayout;
  headerTextLayout: NativeHeaderTextLayout;
  paints: NativePaints;
  layer: "all" | "fixed" | "content";
  contentCell?: "unified" | "left" | "right";
  fileIndex?: number;
}

function paintNativeRange(input: PaintNativeRangeInput): void {
  "worklet";
  const paintsFixedContent = input.layer !== "content";
  const paintsCodeContent = input.layer !== "fixed";
  if (paintsFixedContent) {
    input.canvas.drawRect(
      Skia.XYWHRect(0, 0, input.viewportWidth, input.viewportHeight),
      input.paints.surface,
    );
  }
  const backgroundPaints: Record<DiffCell["type"], SkPaint> = {
    add: input.paints.additionBackground,
    context: input.paints.surface,
    empty: input.paints.emptyBackground,
    remove: input.paints.deletionBackground,
  };
  const range = visibleRowRange(input.model.rows, input.scrollTop, input.viewportHeight);
  for (let index = range.start; index < range.end; index += 1) {
    const row = input.model.rows[index];
    if (!row) continue;
    const y = row.top - input.scrollTop;
    if (row.kind === "status") {
      if (paintsFixedContent) {
        input.canvas.drawText(
          row.label,
          12,
          y + input.model.lineHeight,
          input.paints.foregroundMuted,
          input.textLayout.font,
        );
      }
      continue;
    }
    if (row.kind === "separator") {
      if (paintsFixedContent) paintNativeSeparator({ input, row, y });
      continue;
    }
    const file = input.model.files[row.fileIndex];
    if (!file) continue;
    const horizontalOffset = horizontalOffsetForPath(input.horizontalOffsets, row.path);
    const columnWidth = input.viewportWidth / row.cells.length;
    row.cells.forEach((cell, cellIndex) => {
      const columnX = cellIndex * columnWidth;
      if (paintsFixedContent) {
        paintNativeFixedCell({ input, row, file, cell, columnX, columnWidth, y, backgroundPaints });
      }
      if (
        paintsCodeContent &&
        cell &&
        paintsNativeContentCell(input, row.cells.length, cellIndex)
      ) {
        paintNativeCodeCell({
          input,
          row,
          file,
          cell,
          cellIndex,
          columnX,
          columnWidth,
          horizontalOffset,
          y,
        });
      }
    });
  }
  let borderFiles = input.model.files;
  if (input.fileIndex !== undefined) {
    const file = input.model.files[input.fileIndex];
    borderFiles = file ? [file] : [];
  }
  for (const file of paintsFixedContent ? borderFiles : []) {
    const borderTop = expandedBodyBorderTop(file);
    const isVisible =
      borderTop !== null &&
      borderTop < input.scrollTop + input.viewportHeight &&
      borderTop + DIFF_BODY_BORDER_HEIGHT > input.scrollTop;
    if (!isVisible) continue;
    input.canvas.drawRect(
      Skia.XYWHRect(0, borderTop - input.scrollTop, input.viewportWidth, DIFF_BODY_BORDER_HEIGHT),
      input.paints.border,
    );
  }
}

function paintsNativeContentCell(
  input: PaintNativeRangeInput,
  columnCount: number,
  cellIndex: number,
): boolean {
  if (input.layer !== "content") return true;
  if (columnCount === 1) return input.contentCell === "unified";
  return input.contentCell === (cellIndex === 0 ? "left" : "right");
}

function paintNativeFixedCell(input: {
  input: PaintNativeRangeInput;
  row: DiffLineRow;
  file: DiffFileSection;
  cell: DiffCell | null;
  columnX: number;
  columnWidth: number;
  y: number;
  backgroundPaints: Record<DiffCell["type"], SkPaint>;
}): void {
  const backgroundPaint = input.cell
    ? input.backgroundPaints[input.cell.type]
    : input.input.paints.emptyBackground;
  input.input.canvas.drawRect(
    Skia.XYWHRect(input.columnX, input.y, input.columnWidth, input.row.height),
    backgroundPaint,
  );
  input.input.canvas.drawRect(
    Skia.XYWHRect(
      input.columnX,
      reviewGapTop(input.y, input.row.height, input.row.reviewHeight),
      input.columnWidth,
      input.row.reviewHeight,
    ),
    reviewBackgroundPaint(input.input.paints.surface),
  );
  if (!input.cell) return;
  const barTone = changeBarTone(input.cell);
  if (barTone) {
    input.input.canvas.drawRect(
      Skia.XYWHRect(
        input.columnX,
        input.y,
        DIFF_CHANGE_BAR_WIDTH,
        input.row.height - input.row.reviewHeight,
      ),
      input.input.paints[barTone],
    );
  }
  input.input.canvas.drawRect(
    Skia.XYWHRect(
      input.columnX + input.file.gutterWidth,
      input.y,
      1,
      reviewDividerHeight(input.row.height),
    ),
    input.input.paints.border,
  );
  const label = String(input.cell.lineNumber ?? "");
  const font = input.input.textLayout.font;
  input.input.canvas.drawText(
    label,
    input.columnX + input.file.gutterWidth - 7 - font.getTextWidth(label),
    input.y + input.input.model.lineHeight * 0.78,
    input.input.paints[codeLineNumberTone(input.cell)],
    font,
  );
}

function paintNativeCodeCell(input: {
  input: PaintNativeRangeInput;
  row: DiffLineRow;
  file: DiffFileSection;
  cell: DiffCell;
  cellIndex: number;
  columnX: number;
  columnWidth: number;
  horizontalOffset: number;
  y: number;
}): void {
  const textX = input.columnX + input.file.gutterWidth + CODE_LEFT_PADDING;
  const clipsContent = input.input.layer === "all";
  if (clipsContent) {
    input.input.canvas.save();
    input.input.canvas.clipRect(
      Skia.XYWHRect(
        textX,
        input.y,
        input.columnWidth - input.file.gutterWidth - CODE_LEFT_PADDING,
        input.row.height,
      ),
      ClipOp.Intersect,
      false,
    );
  }
  const offset = input.input.model.wrapLines ? 0 : input.horizontalOffset;
  for (const [fragmentIndex, fragment] of input.cell.fragments.entries()) {
    const paragraph =
      input.input.textLayout.paragraphs[input.row.index]?.[input.cellIndex]?.[fragmentIndex];
    if (paragraph) {
      paragraph.paint(input.input.canvas, textX - offset, input.y + fragment.top);
      continue;
    }
    const fragmentX = textX - offset;
    const baseline = input.y + fragment.baseline;
    if (input.cell.tokens.length === 0) {
      input.input.canvas.drawText(
        fragment.text,
        fragmentX,
        baseline,
        input.input.paints.foreground,
        input.input.textLayout.font,
      );
      continue;
    }
    for (const run of nativeTextRuns(input.cell, fragment)) {
      input.input.canvas.drawText(
        run.text,
        fragmentX + run.left,
        baseline,
        input.input.paints.text[run.color] ?? input.input.paints.foreground,
        input.input.textLayout.font,
      );
    }
  }
  if (clipsContent) input.input.canvas.restore();
}

// 分隔行是装饰：UI 字体的 micro 档标签居中，两侧横线，画在不随横向滚动的固定层。
function paintNativeSeparator(input: {
  input: PaintNativeRangeInput;
  row: DiffSeparatorRow;
  y: number;
}): void {
  const label = shapeNativeHeaderText({
    layout: input.input.headerTextLayout,
    text: input.row.label,
    size: "micro",
    tone: "foregroundExtraMuted",
  });
  const layout = diffSeparatorLayout({
    rowTop: input.y,
    rowHeight: input.row.height,
    width: input.input.viewportWidth,
    labelWidth: label.width,
  });
  for (const rule of layout.rules) {
    input.input.canvas.drawRect(
      Skia.XYWHRect(rule.x, layout.ruleY, rule.width, 1),
      input.input.paints.border,
    );
  }
  label.paragraph.paint(
    input.input.canvas,
    layout.labelX,
    input.y + (input.row.height - label.height) / 2,
  );
  label.paragraph.dispose();
}
