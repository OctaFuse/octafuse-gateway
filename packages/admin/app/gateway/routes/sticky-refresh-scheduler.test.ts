import assert from 'node:assert/strict';
import test from 'node:test';
import { createStickyRefreshScheduler, formatStickyRefreshCountdown, stickyRefreshSeconds } from './sticky-refresh-scheduler';

function clock() {
  let time = 0;
  let serial = 0;
  const jobs = new Map<number, { at: number; callback: () => void }>();
  return {
    now: () => time,
    setTimer: (callback: () => void, delay: number) => {
      const id = ++serial;
      jobs.set(id, { at: time + delay, callback });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (id: ReturnType<typeof setTimeout>) => { jobs.delete(id as unknown as number); },
    advance: (delay: number) => {
      time += delay;
      for (const [id, job] of [...jobs]) {
        if (job.at <= time) { jobs.delete(id); job.callback(); }
      }
    },
    jobs: () => jobs.size,
  };
}

test('published deadlines match all supported automatic refresh intervals', async () => {
  for (const intervalMs of [60_000, 300_000, 600_000] as const) {
    const c = clock();
    let deadline: number | null = null;
    let calls = 0;
    const scheduler = createStickyRefreshScheduler({ ...c, intervalMs, active: () => true,
      onDeadline: value => { deadline = value; }, refresh: async () => { calls++; } });
    scheduler.start();
    assert.equal(deadline, intervalMs);
    c.advance(intervalMs - 1);
    assert.equal(calls, 0);
    assert.equal(stickyRefreshSeconds(deadline, c.now()), 1);
    c.advance(1);
    assert.equal(deadline, null);
    await scheduler.refreshNow(); // Join the timer's existing request.
    assert.equal(calls, 1);
    assert.equal(deadline, intervalMs * 2);
    assert.equal(c.jobs(), 1);
    scheduler.dispose();
  }
});

test('manual refresh coalesces requests and starts a full interval after completion', async () => {
  const c = clock();
  let deadline: number | null = null;
  let release!: () => void;
  let calls = 0;
  const scheduler = createStickyRefreshScheduler({ ...c, intervalMs: 60_000, active: () => true,
    onDeadline: value => { deadline = value; }, refresh: () => {
      calls++; return new Promise<void>(resolve => { release = resolve; });
    } });
  scheduler.start();
  c.advance(10_000);
  const first = scheduler.refreshNow();
  const second = scheduler.refreshNow();
  assert.equal(first, second);
  assert.equal(deadline, null);
  await Promise.resolve();
  c.advance(70_000); // An in-flight request must not start overlapping timers.
  assert.equal(c.jobs(), 0);
  assert.equal(calls, 1);
  release();
  await first;
  assert.equal(deadline, 140_000);
  scheduler.dispose();
});

test('background pause removes the deadline and resume refreshes before rearming', async () => {
  const c = clock();
  let visible = true;
  let deadline: number | null = null;
  let calls = 0;
  const scheduler = createStickyRefreshScheduler({ ...c, intervalMs: 60_000, active: () => visible,
    onDeadline: value => { deadline = value; }, refresh: async () => { calls++; } });
  scheduler.start();
  visible = false;
  scheduler.pause();
  c.advance(120_000);
  assert.equal(calls, 0);
  assert.equal(deadline, null);
  visible = true;
  await scheduler.refreshNow();
  assert.equal(calls, 1);
  assert.equal(deadline, 180_000);
  scheduler.dispose();
});

test('manual-only and empty states never publish an automatic countdown', async () => {
  const c = clock();
  let active = true;
  let deadline: number | null = null;
  let calls = 0;
  const scheduler = createStickyRefreshScheduler({ ...c, intervalMs: 'off', active: () => active,
    onDeadline: value => { deadline = value; }, refresh: async () => { calls++; } });
  scheduler.start();
  assert.equal(deadline, null);
  assert.equal(c.jobs(), 0);
  await scheduler.refreshNow();
  assert.equal(calls, 1);
  assert.equal(deadline, null);
  active = false;
  await scheduler.refreshNow();
  assert.equal(calls, 1);
  scheduler.dispose();
});

test('failure still schedules the next attempt and does not produce unhandled timer rejections', async () => {
  const c = clock();
  let deadline: number | null = null;
  const scheduler = createStickyRefreshScheduler({ ...c, intervalMs: 60_000, active: () => true,
    onDeadline: value => { deadline = value; }, refresh: async () => { throw new Error('offline'); } });
  scheduler.start();
  c.advance(60_000);
  await assert.rejects(scheduler.refreshNow(), /offline/);
  assert.equal(deadline, 120_000);
  assert.equal(c.jobs(), 1);
  scheduler.dispose();
});

test('disposing during a request prevents stale timers from being rearmed', async () => {
  const c = clock();
  let release!: () => void;
  let deadline: number | null = null;
  const scheduler = createStickyRefreshScheduler({ ...c, intervalMs: 60_000, active: () => true,
    onDeadline: value => { deadline = value; }, refresh: () => new Promise<void>(resolve => { release = resolve; }) });
  scheduler.start();
  const pending = scheduler.refreshNow();
  await Promise.resolve();
  scheduler.dispose();
  release();
  await pending;
  assert.equal(deadline, null);
  assert.equal(c.jobs(), 0);
});

test('countdown rounds up remaining seconds, clamps expired deadlines, and keeps fixed-width digits', () => {
  assert.equal(stickyRefreshSeconds(null, 0), null);
  assert.equal(stickyRefreshSeconds(60_000, 1), 60);
  assert.equal(stickyRefreshSeconds(60_000, 60_001), 0);
  assert.equal(formatStickyRefreshCountdown(0), '00:00');
  assert.equal(formatStickyRefreshCountdown(59), '00:59');
  assert.equal(formatStickyRefreshCountdown(600), '10:00');
});


test('automatic refresh without eligible pools has neither a timer nor a stale deadline', () => {
  const c = clock();
  let active = false;
  let deadline: number | null = null;
  let calls = 0;
  const scheduler = createStickyRefreshScheduler({ ...c, intervalMs: 60_000, active: () => active,
    onDeadline: value => { deadline = value; }, refresh: async () => { calls++; } });
  scheduler.start();
  assert.equal(deadline, null);
  assert.equal(c.jobs(), 0);
  c.advance(120_000);
  active = true;
  scheduler.start();
  assert.equal(deadline, 180_000);
  active = false;
  c.advance(60_000);
  assert.equal(deadline, null);
  assert.equal(c.jobs(), 0);
  assert.equal(calls, 0);
  scheduler.dispose();
});


test('manual clicks and timer ticks carry different refresh sources', async () => {
  const c = clock();
  const sources: string[] = [];
  const scheduler = createStickyRefreshScheduler({ ...c, intervalMs: 10_000, active: () => true,
    onDeadline: () => {}, refresh: async source => { sources.push(source); } });
  scheduler.start();
  await scheduler.refreshNow();
  c.advance(10_000);
  await scheduler.refreshNow();
  assert.deepEqual(sources, ['manual', 'automatic']);
  scheduler.dispose();
});
