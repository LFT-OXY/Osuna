export const LOGIC_MAP_NODE_ENTER_ANIMATION = "paseo-logic-map-node-enter";

const KEYFRAME_ELEMENT_ID = "paseo-logic-map-keyframes";
const KEYFRAME_CSS = `
  @keyframes ${LOGIC_MAP_NODE_ENTER_ANIMATION} {
    from { opacity: 0; }
    to { opacity: 1; }
  }
`;

/** 新节点淡入用的 keyframes，挂一次到 document.head。 */
export function ensureLogicMapKeyframes(): void {
  if (document.getElementById(KEYFRAME_ELEMENT_ID)) return;
  const styleElement = document.createElement("style");
  styleElement.id = KEYFRAME_ELEMENT_ID;
  styleElement.textContent = KEYFRAME_CSS;
  document.head.appendChild(styleElement);
}
