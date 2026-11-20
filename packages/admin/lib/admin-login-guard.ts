/** Process-local login throttling. No database or runtime configuration. */
export const IP_MAX_FAILURES = 5;
export const GLOBAL_MAX_FAILURES = 5;
export const FAILURE_WINDOW_SECONDS = 1800;
export const LOCKOUT_SECONDS = 1800;
export const CLEANUP_TRIGGER_KEYS = 512;
export const CLEANUP_BATCH_SIZE = 16;
export const MAX_GUARD_KEYS = 5000;
const RESERVATION_SECONDS = 30;
const GLOBAL_KEY = 'global:admin';
const OVERFLOW_KEY = 'ip:overflow';
const WINDOW_MS = FAILURE_WINDOW_SECONDS * 1000;
const LOCKOUT_MS = LOCKOUT_SECONDS * 1000;

export interface FailureEntry {
  failures: number;
  windowStartedAt: number | null;
  reservations: Map<string, number>;
  updatedAt: number;
}

export interface LoginGuardState {
  failures: Map<string, FailureEntry>;
  lockouts: Map<string, number>;
  cursor: Iterator<string> | null;
}

export interface Reservation {
  id: string;
  keys: readonly [string, string];
  deadline: number;
  /** Lockouts present when the request entered, for result ordering. */
  admittedAt: number;
}

export type GuardDecision =
  | { kind: 'reserved'; reservation: Reservation }
  | { kind: 'locked'; retryAfterSeconds: number; key: string }
  | { kind: 'busy' };

export class LoginGuardError extends Error {
  constructor() { super('Login guard unavailable'); }
}

export function createLoginGuardState(): LoginGuardState {
  const failures = new Map<string, FailureEntry>();
  for (const key of [GLOBAL_KEY, OVERFLOW_KEY]) {
    failures.set(key, { failures: 0, windowStartedAt: null, reservations: new Map(), updatedAt: 0 });
  }
  return { failures, lockouts: new Map(), cursor: null };
}

const stateSymbol = Symbol.for('octafuse.admin.loginGuard');
export function getLoginGuardState(): LoginGuardState {
  const shared = globalThis as typeof globalThis & { [stateSymbol]?: LoginGuardState };
  return shared[stateSymbol] ??= createLoginGuardState();
}

export function guardNow(): number { return performance.now(); }

function validEntry(entry: FailureEntry | undefined): entry is FailureEntry {
  return !!entry && Number.isInteger(entry.failures) && entry.failures >= 0 &&
    (entry.windowStartedAt === null || Number.isFinite(entry.windowStartedAt)) &&
    entry.reservations instanceof Map && Number.isFinite(entry.updatedAt);
}

function secondsUntil(deadline: number, now: number): number {
  return Math.max(1, Math.ceil((deadline - now) / 1000));
}

function normalizeIPv4(raw: string): string | null {
  const parts = raw.split('.');
  if (parts.length !== 4 || parts.some(part => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return null;
  return parts.join('.');
}

export function normalizeGuardIp(raw: string | null): string {
  if (!raw || raw.length > 128) return 'unknown';
  let ip = raw.trim();
  if (ip.includes(',') || ip.includes('%')) return 'unknown';
  if (ip.startsWith('[')) {
    const end = ip.indexOf(']');
    if (end < 0 || (ip.length > end + 1 && !/^:\d{1,5}$/.test(ip.slice(end + 1)))) return 'unknown';
    ip = ip.slice(1, end);
  } else if (/^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(ip)) {
    ip = ip.slice(0, ip.lastIndexOf(':'));
  }
  const mapped = /^::ffff:(.+)$/i.exec(ip);
  if (mapped) return normalizeIPv4(mapped[1]) ?? 'unknown';
  if (ip.includes('.')) return normalizeIPv4(ip) ?? 'unknown';
  try {
    const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    if (!canonical.includes(':')) return 'unknown';
    const [head, tail] = canonical.split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    if (canonical.includes('::')) left.push(...Array(8 - left.length - right.length).fill('0'), ...right);
    if (left.length !== 8 || left.some(part => !/^[0-9a-f]{1,4}$/i.test(part))) return 'unknown';
    return `${left.slice(0, 4).map(part => parseInt(part, 16).toString(16)).join(':')}::/64`;
  } catch { return 'unknown'; }
}

function pruneCurrent(state: LoginGuardState, key: string, now: number): void {
  const lockedUntil = state.lockouts.get(key);
  if (lockedUntil !== undefined) {
    if (!Number.isFinite(lockedUntil)) throw new LoginGuardError();
    if (lockedUntil <= now) {
      state.lockouts.delete(key);
      const entry = state.failures.get(key);
      if (entry && !validEntry(entry)) throw new LoginGuardError();
      if (entry) {
        entry.failures = 0;
        entry.windowStartedAt = null;
      }
    }
  }
  const entry = state.failures.get(key);
  if (!entry) return;
  if (!validEntry(entry)) throw new LoginGuardError();
  for (const [id, deadline] of entry.reservations) {
    if (!Number.isFinite(deadline)) throw new LoginGuardError();
    if (deadline <= now) entry.reservations.delete(id);
  }
  if (entry.windowStartedAt !== null && now >= entry.windowStartedAt + WINDOW_MS) {
    entry.failures = 0;
    entry.windowStartedAt = null;
  }
  if (entry.failures === 0 && entry.reservations.size === 0 && !state.lockouts.has(key) && key !== GLOBAL_KEY && key !== OVERFLOW_KEY) {
    state.failures.delete(key);
  }
}

function cleanupBatch(state: LoginGuardState, now: number): void {
  state.cursor ??= state.failures.keys();
  for (let checked = 0; checked < CLEANUP_BATCH_SIZE; checked++) {
    let next = state.cursor.next();
    if (next.done) {
      state.cursor = state.failures.keys();
      next = state.cursor.next();
      if (next.done) break;
    }
    pruneCurrent(state, next.value, now);
  }
}

function ensureKey(state: LoginGuardState, key: string, now: number): string {
  if (state.failures.has(key)) return key;
  if (state.failures.size >= CLEANUP_TRIGGER_KEYS) cleanupBatch(state, now);
  if (state.failures.size >= MAX_GUARD_KEYS) {
    // One batch may not find a safe candidate; the reserved overflow key stays available.
    if (key !== GLOBAL_KEY && key !== OVERFLOW_KEY) key = OVERFLOW_KEY;
  }
  if (!state.failures.has(key)) state.failures.set(key, {
    failures: 0, windowStartedAt: null, reservations: new Map(), updatedAt: now,
  });
  return key;
}

function checked<T>(run: () => T): T {
  try { return run(); } catch (error) {
    if (error instanceof LoginGuardError) throw error;
    throw new LoginGuardError();
  }
}

export function checkLoginLockout(state: LoginGuardState, ip: string, now = guardNow()): Extract<GuardDecision, { kind: 'locked' }> | null {
  return checked(() => {
    const keys = [`ip:${normalizeGuardIp(ip)}`, GLOBAL_KEY];
    for (const key of keys) pruneCurrent(state, key, now);
    let lock: { kind: 'locked'; retryAfterSeconds: number; key: string } | null = null;
    for (const key of keys) {
      const until = state.lockouts.get(key);
      if (until !== undefined) {
        const candidate = { kind: 'locked' as const, retryAfterSeconds: secondsUntil(until, now), key };
        if (!lock || candidate.retryAfterSeconds > lock.retryAfterSeconds) lock = candidate;
      }
    }
    return lock;
  });
}

export function reserveLogin(state: LoginGuardState, ip: string, now = guardNow()): GuardDecision {
  return checked(() => {
    const locked = checkLoginLockout(state, ip, now);
    if (locked) return locked;
    const ipKey = ensureKey(state, `ip:${normalizeGuardIp(ip)}`, now);
    if (ipKey === OVERFLOW_KEY) {
      pruneCurrent(state, OVERFLOW_KEY, now);
      const overflowUntil = state.lockouts.get(OVERFLOW_KEY);
      if (overflowUntil !== undefined) {
        return { kind: 'locked', retryAfterSeconds: secondsUntil(overflowUntil, now), key: OVERFLOW_KEY };
      }
    }
    ensureKey(state, GLOBAL_KEY, now);
    const keys = [ipKey, GLOBAL_KEY] as const;
    for (const key of keys) {
      const entry = state.failures.get(key)!;
      if (!validEntry(entry)) throw new LoginGuardError();
      const limit = key === GLOBAL_KEY ? GLOBAL_MAX_FAILURES : IP_MAX_FAILURES;
      if (entry.failures + entry.reservations.size >= limit) return { kind: 'busy' };
    }
    const id = crypto.randomUUID();
    const deadline = now + RESERVATION_SECONDS * 1000;
    try {
      for (const key of keys) state.failures.get(key)!.reservations.set(id, deadline);
    } catch (error) {
      for (const key of keys) {
        try { state.failures.get(key)?.reservations.delete(id); } catch { /* Fail closed below. */ }
      }
      throw error;
    }
    return { kind: 'reserved', reservation: { id, keys, deadline, admittedAt: now } };
  });
}

function release(state: LoginGuardState, reservation: Reservation): boolean {
  const entries = reservation.keys.map(key => state.failures.get(key));
  if (entries.some(entry => entry && !validEntry(entry))) throw new LoginGuardError();
  if (entries.some(entry => !entry)) throw new LoginGuardError();
  const valid = entries.every(entry => entry!.reservations.get(reservation.id) === reservation.deadline);
  for (const entry of entries) entry!.reservations.delete(reservation.id);
  return valid;
}

export function rollbackLogin(state: LoginGuardState, reservation: Reservation): void {
  checked(() => { release(state, reservation); });
}

export function commitLoginFailure(state: LoginGuardState, reservation: Reservation, now = guardNow()): GuardDecision | null {
  return checked(() => {
    if (!release(state, reservation) || now >= reservation.deadline) return null;
    let locked: { kind: 'locked'; retryAfterSeconds: number; key: string } | null = null;
    for (const key of reservation.keys) {
      const existingLock = state.lockouts.get(key);
      if (existingLock !== undefined && existingLock > now) continue;
      const entry = state.failures.get(key)!;
      if (entry.windowStartedAt === null || now >= entry.windowStartedAt + WINDOW_MS) {
        entry.failures = 0;
        entry.windowStartedAt = now;
      }
      entry.failures++;
      entry.updatedAt = now;
      const limit = key === GLOBAL_KEY ? GLOBAL_MAX_FAILURES : IP_MAX_FAILURES;
      if (entry.failures >= limit) {
        const until = now + LOCKOUT_MS;
        state.lockouts.set(key, until);
        const candidate = { kind: 'locked' as const, retryAfterSeconds: secondsUntil(until, now), key };
        if (!locked || candidate.retryAfterSeconds > locked.retryAfterSeconds) locked = candidate;
      }
    }
    return locked;
  });
}

export function commitLoginSuccess(state: LoginGuardState, reservation: Reservation): void {
  checked(() => {
    if (!release(state, reservation)) return;
    for (const key of reservation.keys) {
      if (state.lockouts.has(key)) continue; // A newer failure locked this key.
      const entry = state.failures.get(key)!;
      entry.failures = 0;
      entry.windowStartedAt = null;
    }
  });
}

export function guardStats(state: LoginGuardState): { keys: number; entries: number } {
  return { keys: state.failures.size, entries: state.failures.size + state.lockouts.size };
}
