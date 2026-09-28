import type { KeyboardEvent } from "react";
import type { ThinkingSliderKeyboardProps } from "./thinking-slider-keyboard";

const STEP_BY_KEY: Record<string, 1 | -1> = {
  ArrowLeft: -1,
  ArrowRight: 1,
};

export function thinkingSliderKeyboardProps(
  onStep: (delta: 1 | -1) => void,
): ThinkingSliderKeyboardProps {
  return {
    onKeyDown: (event: KeyboardEvent) => {
      const delta = STEP_BY_KEY[event.key];
      if (delta === undefined) return;
      event.preventDefault();
      onStep(delta);
    },
  };
}
