import type { AutoRefreshIntervalMs } from './auto-refresh-preference';

/** A single deadline drives both the next request and its UI countdown. */
export function createAutoRefreshScheduler({
  intervalMs, refresh, active, onDeadline, now = Date.now,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timer) => clearTimeout(timer),
}: {
  intervalMs: AutoRefreshIntervalMs;
  refresh: () => Promise<void>;
  active: () => boolean;
  onDeadline: (deadline: number | null) => void;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | null = null;
  let disposed = false;

  const pause = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    onDeadline(null);
  };
  const schedule = () => {
    if (disposed) return;
    pause();
    if (intervalMs === 'off' || !active() || pending) return;
    onDeadline(now() + intervalMs);
    timer = setTimer(() => { void refreshNow().catch(() => {}); }, intervalMs);
  };
  const refreshNow = () => {
    if (disposed) return Promise.resolve();
    if (pending) return pending;
    if (!active()) { pause(); return Promise.resolve(); }
    pause();
    // Assign before refresh starts so overlapping manual/timer requests coalesce.
    pending = Promise.resolve().then(refresh).finally(() => {
      pending = null;
      schedule();
    });
    return pending;
  };
  return {
    start: schedule,
    pause,
    refreshNow,
    dispose: () => { disposed = true; pause(); },
  };
}

export function autoRefreshSeconds(deadline: number | null, now: number) {
  return deadline == null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}
export function formatAutoRefreshCountdown(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
