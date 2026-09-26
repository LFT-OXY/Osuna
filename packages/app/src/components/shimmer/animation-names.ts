// 工具行的扫光：文字上叠一层白色渐变峰，位置由组件量出的 --paseo-shimmer-start/end 给出。
export const TOOL_CALL_SHIMMER_ANIMATION_NAME = "paseo-toolcall-shimmer";
// 状态行的扫光：一层前景色文字，用渐变遮罩只露出峰的位置，遮罩从左扫到右。
export const TEXT_SHIMMER_ANIMATION_NAME = "paseo-text-shimmer";
// 可见性闸门写在扫光容器上，子元素的 animation-play-state 读它；未写入前按暂停处理。
export const SHIMMER_PLAY_STATE_VAR = "--paseo-shimmer-play-state";
export const SHIMMER_PLAY_STATE = `var(${SHIMMER_PLAY_STATE_VAR}, paused)`;
