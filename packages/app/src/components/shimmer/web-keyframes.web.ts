import { TEXT_SHIMMER_ANIMATION_NAME, TOOL_CALL_SHIMMER_ANIMATION_NAME } from "./animation-names";

const KEYFRAME_ELEMENT_ID = "paseo-shimmer-keyframes";

// 文字扫光的遮罩宽 40%，按百分比定位时 -67% 让峰完全在左侧之外，167% 完全在右侧之外。
const KEYFRAME_CSS = `
  @keyframes ${TOOL_CALL_SHIMMER_ANIMATION_NAME} {
    0% {
      background-position: var(--paseo-shimmer-start, -200px) 0;
    }
    100% {
      background-position: var(--paseo-shimmer-end, 200px) 0;
    }
  }
  @keyframes ${TEXT_SHIMMER_ANIMATION_NAME} {
    0% {
      -webkit-mask-position: -67% 0;
      mask-position: -67% 0;
    }
    100% {
      -webkit-mask-position: 167% 0;
      mask-position: 167% 0;
    }
  }
`;

export function ensureShimmerKeyframes(): void {
  const existing = document.getElementById(KEYFRAME_ELEMENT_ID);
  if (existing) {
    if (existing.textContent !== KEYFRAME_CSS) {
      existing.textContent = KEYFRAME_CSS;
    }
    return;
  }
  const styleElement = document.createElement("style");
  styleElement.id = KEYFRAME_ELEMENT_ID;
  styleElement.textContent = KEYFRAME_CSS;
  document.head.appendChild(styleElement);
}
