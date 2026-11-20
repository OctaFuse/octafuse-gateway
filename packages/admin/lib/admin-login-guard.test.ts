import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLoginGuardState, reserveLogin, commitLoginFailure, commitLoginSuccess,
  rollbackLogin, checkLoginLockout, guardStats, normalizeGuardIp,
  CLEANUP_BATCH_SIZE, CLEANUP_TRIGGER_KEYS, MAX_GUARD_KEYS,
  type Reservation, type LoginGuardState,
} from './admin-login-guard';

function admitted(state: LoginGuardState, ip: string, now: number): Reservation {
  const decision = reserveLogin(state, ip, now);
  assert.equal(decision.kind, 'reserved');
  if (decision.kind !== 'reserved') throw new Error('not admitted');
  return decision.reservation;
}

test('five confirmed failures lock both keys; expiry lazily restores full quota', () => {
  const state = createLoginGuardState();
  for (let i = 0; i < 4; i++) {
    assert.equal(commitLoginFailure(state, admitted(state, '203.0.113.7', 1000 + i), 1000 + i)?.kind, undefined);
  }
  assert.equal(state.failures.get('global:admin')?.windowStartedAt, 1000);
  const result = commitLoginFailure(state, admitted(state, '203.0.113.7', 1004), 1004);
  assert.equal(result?.kind, 'locked');
  assert.equal(state.lockouts.size, 2);
  assert.equal(checkLoginLockout(state, '203.0.113.7', 1004 + 1_800_000 - 1)?.kind, 'locked');
  assert.equal(checkLoginLockout(state, '203.0.113.7', 1004 + 1_800_000), null);
  assert.equal(state.lockouts.size, 0);
  assert.equal(admitted(state, '203.0.113.7', 1004 + 1_800_000).keys[0], 'ip:203.0.113.7');
});

test('unconfirmed reservations only return BUSY and rollback frees capacity', () => {
  const state = createLoginGuardState();
  const reservations = Array.from({ length: 5 }, () => admitted(state, '203.0.113.8', 1000));
  assert.equal(reserveLogin(state, '203.0.113.8', 1000).kind, 'busy');
  assert.equal(state.lockouts.size, 0);
  rollbackLogin(state, reservations[0]);
  rollbackLogin(state, reservations[0]);
  assert.equal(reserveLogin(state, '203.0.113.8', 1001).kind, 'reserved');
});

test('one hundred concurrent admissions never exceed five in-flight checks', async () => {
  const state = createLoginGuardState();
  const decisions = await Promise.all(Array.from({ length: 100 }, async (_, index) =>
    reserveLogin(state, `203.0.113.${index + 1}`, 1000),
  ));
  assert.equal(decisions.filter(decision => decision.kind === 'reserved').length, 5);
  assert.equal(decisions.filter(decision => decision.kind === 'busy').length, 95);
  assert.equal(state.failures.get('global:admin')?.reservations.size, 5);
  assert.equal(state.lockouts.size, 0);
});

test('late failure after successful login starts a new window', () => {
  const state = createLoginGuardState();
  const success = admitted(state, '203.0.113.9', 1000);
  const failure = admitted(state, '203.0.113.9', 1001);
  commitLoginSuccess(state, success);
  assert.equal(state.failures.get('global:admin')?.failures, 0);
  commitLoginFailure(state, failure, 1002);
  assert.equal(state.failures.get('global:admin')?.failures, 1);
  assert.equal(state.failures.get('global:admin')?.windowStartedAt, 1002);
});

test('a prior successful request does not clear a lock created by another request', () => {
  const state = createLoginGuardState();
  const success = admitted(state, '203.0.113.10', 1000);
  state.lockouts.set('global:admin', 1002 + 1_800_000);
  commitLoginSuccess(state, success);
  assert.equal(state.lockouts.get('global:admin'), 1002 + 1_800_000);
});

test('capacity cleanup scans at most 16 candidates and keeps key count bounded', () => {
  const state = createLoginGuardState();
  for (let i = 0; i < CLEANUP_TRIGGER_KEYS - 2; i++) {
    const key = `ip:10.${Math.floor(i / 256)}.${i % 256}.1`;
    state.failures.set(key, { failures: 1, windowStartedAt: 1000, reservations: new Map(), updatedAt: 1000 });
  }
  let inspected = 0;
  const originalKeys = state.failures.keys.bind(state.failures);
  state.failures.keys = () => {
    const iterator = originalKeys();
    return {
      next: () => { inspected++; return iterator.next(); },
      [Symbol.iterator]() { return this; },
    } as unknown as MapIterator<string>;
  };
  rollbackLogin(state, admitted(state, '203.0.113.20', 1000));
  assert.ok(inspected <= CLEANUP_BATCH_SIZE + 1, `scanned ${inspected}`);

  for (let i = state.failures.size; i < MAX_GUARD_KEYS; i++) {
    state.failures.set(`ip:198.51.${Math.floor(i / 256)}.${i % 256}`, {
      failures: 1, windowStartedAt: 1000, reservations: new Map(), updatedAt: 1000,
    });
  }
  const result = reserveLogin(state, '192.0.2.99', 1001);
  assert.equal(result.kind, 'reserved');
  if (result.kind === 'reserved') assert.equal(result.reservation.keys[0], 'ip:overflow');
  assert.ok(guardStats(state).keys <= MAX_GUARD_KEYS);
  assert.ok(guardStats(state).entries <= MAX_GUARD_KEYS * 2);
  state.lockouts.set('ip:overflow', 1001 + 1_800_000);
  assert.equal(reserveLogin(state, '192.0.2.98', 1002).kind, 'locked');
});

test('IP normalization rejects arbitrary header strings and groups IPv6 /64', () => {
  assert.equal(normalizeGuardIp('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(normalizeGuardIp('2001:db8:1:2::1'), normalizeGuardIp('2001:db8:1:2::abcd'));
  assert.notEqual(normalizeGuardIp('2001:db8:1:2::1'), normalizeGuardIp('2001:db8:1:3::1'));
  assert.equal(normalizeGuardIp('203.0.113.7, 10.0.0.1'), 'unknown');
});
