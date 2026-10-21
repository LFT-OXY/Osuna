import { useCallback, useRef, useState } from "react";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";

/** 边缘渐隐的宽度。 */
export const HORIZONTAL_SCROLL_FADE_WIDTH = 24;

/** 哪一侧还有藏着的内容：只在那一侧画渐隐。 */
export interface HorizontalOverflow {
  start: boolean;
  end: boolean;
}

const NO_OVERFLOW: HorizontalOverflow = { start: false, end: false };

/** 量横向滚动区的视口、内容宽度与滚动位置，得出两侧各有没有藏着的内容。 */
export function useHorizontalOverflow() {
  const [overflow, setOverflow] = useState<HorizontalOverflow>(NO_OVERFLOW);
  const metrics = useRef({ offset: 0, viewport: 0, content: 0 });
  const update = useCallback(() => {
    const { offset, viewport, content } = metrics.current;
    const start = offset > 1;
    const end = offset + viewport < content - 1;
    setOverflow((current) =>
      current.start === start && current.end === end ? current : { start, end },
    );
  }, []);
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      metrics.current.offset = event.nativeEvent.contentOffset.x;
      update();
    },
    [update],
  );
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      metrics.current.viewport = event.nativeEvent.layout.width;
      update();
    },
    [update],
  );
  const onContentSizeChange = useCallback(
    (width: number) => {
      metrics.current.content = width;
      update();
    },
    [update],
  );
  return { overflow, onScroll, onLayout, onContentSizeChange };
}
