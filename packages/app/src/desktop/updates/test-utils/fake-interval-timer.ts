import type { IntervalTimer } from "@/desktop/updates/desktop-app-updater";

export interface FakeIntervalTimer extends IntervalTimer {
  advance(ms: number): void;
}

interface Entry {
  intervalMs: number;
  run: () => void;
  elapsedMs: number;
  active: boolean;
}

export function createFakeIntervalTimer(): FakeIntervalTimer {
  const entries: Entry[] = [];

  return {
    every(intervalMs, run) {
      const entry: Entry = { intervalMs, run, elapsedMs: 0, active: true };
      entries.push(entry);
      return () => {
        entry.active = false;
      };
    },
    advance(ms) {
      for (const entry of entries) {
        if (!entry.active) {
          continue;
        }
        entry.elapsedMs += ms;
        while (entry.active && entry.elapsedMs >= entry.intervalMs) {
          entry.elapsedMs -= entry.intervalMs;
          entry.run();
        }
      }
    },
  };
}
