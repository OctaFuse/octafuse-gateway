import assert from 'node:assert/strict';
import test from 'node:test';
import { POST } from './route';
import { createLoginGuardState, getLoginGuardState } from '@/lib/admin-login-guard';

function resetGuard(): void {
  const shared = getLoginGuardState();
  const fresh = createLoginGuardState();
  shared.failures = fresh.failures;
  shared.lockouts = fresh.lockouts;
  shared.cursor = null;
}

function request(body: string, ip = '203.0.113.50'): Request {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-octafuse-peer-ip': ip },
    body,
  });
}

test('login route locks on fifth confirmed failure before parsing later bodies', async () => {
  resetGuard();
  const env: Record<string, string | undefined> = process.env;
  const oldUser = env.ADMIN_USERNAME;
  const oldPassword = env.ADMIN_PASSWORD;
  env.ADMIN_USERNAME = 'admin';
  env.ADMIN_PASSWORD = 'correct-password';
  try {
    for (let i = 0; i < 4; i++) {
      const response = await POST(request('{"username":"admin","password":"wrong"}'));
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
    const fifth = await POST(request('{"username":"admin","password":"wrong"}'));
    assert.equal(fifth.status, 429);
    assert.equal((await fifth.json() as { code: string }).code, 'ADMIN_LOGIN_LOCKED');
    assert.ok(Number(fifth.headers.get('Retry-After')) > 0);
    const locked = await POST(request('{', '203.0.113.51'));
    assert.equal(locked.status, 429); // Global lock precedes invalid JSON parsing.
    assert.equal((await locked.json() as { code: string }).code, 'ADMIN_LOGIN_LOCKED');
  } finally {
    if (oldUser === undefined) delete env.ADMIN_USERNAME;
    else env.ADMIN_USERNAME = oldUser;
    if (oldPassword === undefined) delete env.ADMIN_PASSWORD;
    else env.ADMIN_PASSWORD = oldPassword;
    resetGuard();
  }
});

test('malformed and oversized bodies do not consume login quota', async () => {
  resetGuard();
  assert.equal((await POST(request('{'))).status, 400);
  assert.equal((await POST(request('x'.repeat(4097)))).status, 413);
  assert.equal(getLoginGuardState().lockouts.size, 0);
  assert.equal(getLoginGuardState().failures.get('global:admin')?.failures, 0);
});

test('corrupt guard state fails closed with 503 before credential parsing', async () => {
  resetGuard();
  const state = getLoginGuardState();
  state.failures.set('global:admin', {
    failures: Number.NaN, windowStartedAt: null, reservations: new Map(), updatedAt: 0,
  });
  try {
    const response = await POST(request('{'));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(state.lockouts.size, 0);
  } finally { resetGuard(); }
});
