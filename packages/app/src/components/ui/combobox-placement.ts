export interface DesktopFlipInput {
  /** 弹层量出来的高度；下方放不下时被可用高度压扁，所以等于或超过下方可用高度。 */
  contentHeight: number;
  /** 往下开时到窗口底边（减去边距）还剩的高度；锚点贴底时为负。 */
  availableBelow: number;
  referenceTop: number;
  collisionPadding: number;
}

/** 往下开放不下、而上方比下方宽时，改往上开。 */
export function shouldFlipDesktopUp(input: DesktopFlipInput): boolean {
  const { contentHeight, availableBelow, referenceTop, collisionPadding } = input;
  const squeezedBelow = contentHeight >= availableBelow - 1;
  const availableAbove = referenceTop - collisionPadding;
  return squeezedBelow && availableAbove > availableBelow;
}
