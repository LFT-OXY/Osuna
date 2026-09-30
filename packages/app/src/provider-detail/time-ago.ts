import { useEffect, useMemo, useState } from "react";
import { formatTimeAgo } from "@/utils/time";

const TICK_MS = 10_000;

// 每 10 秒重算一次的 time-ago；Models 节的「已更新」和诊断节的运行时间共用。
export function useTimeAgoLabel(at: string | undefined): string | null {
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    if (!at) return;
    const id = setInterval(() => setClockTick((tick) => tick + 1), TICK_MS);
    return () => clearInterval(id);
  }, [at]);
  return useMemo(() => {
    if (!at) return null;
    void clockTick;
    return formatTimeAgo(new Date(at));
  }, [clockTick, at]);
}
