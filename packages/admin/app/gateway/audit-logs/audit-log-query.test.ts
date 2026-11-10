import assert from 'node:assert/strict';
import { test } from 'node:test';
import { utcApiToZonedInput } from '@/lib/business-timezone-client';
import { API_KEY_BUDGET_AUDIT_EVENT_TYPES } from '@/lib/types';
import { ACTOR_KINDS, DEFAULT_EVENTS, auditQuery, readAuditFilters } from './audit-log-query';

test('default hides per-request charges in API queries but omits defaults from URLs', () => {
  const filters = readAuditFilters('', 'Asia/Shanghai');
  assert.deepEqual(filters.events, DEFAULT_EVENTS);
  assert.match(utcApiToZonedInput(filters.range.start_date, 'Asia/Shanghai'), /T00:00$/);
  assert.equal(auditQuery(filters, 'url').has('event_type'), false);
  assert.equal(auditQuery(filters, 'api').getAll('event_type').length, 8);
  assert.equal(auditQuery(filters, 'api').getAll('event_type').includes('usage_charge'), false);
});
test('all events and usage-only scopes retain their meaning on reload', () => {
  const base = readAuditFilters('?start_date=&end_date=', 'UTC');
  for (const events of [[...API_KEY_BUDGET_AUDIT_EVENT_TYPES], ['usage_charge']]) {
    const filters = { ...base, events };
    assert.deepEqual(readAuditFilters(auditQuery(filters, 'url').toString(), 'UTC'), filters);
  }
  assert.equal(
    auditQuery({ ...base, events: [...API_KEY_BUDGET_AUDIT_EVENT_TYPES] }, 'api').has('event_type'),
    false
  );
});
test('all actor kinds omit the filter so historical master-key actors remain included', () => {
  const filters = readAuditFilters(
    '?actor_kind=console,console,unknown&actor_type=admin,invalid',
    'UTC'
  );
  assert.deepEqual(filters.kinds, ['console']);
  assert.deepEqual(filters.actors, ['admin']);
  assert.equal(auditQuery({ ...filters, kinds: [...ACTOR_KINDS] }, 'api').has('actor_kind'), false);
  assert.deepEqual(readAuditFilters('?actor_kind=admin', 'UTC').kinds, ACTOR_KINDS);
});
test('identity drill-downs search history unless an explicit date bound was provided', () => {
  for (const key of ['user_id', 'api_key_id', 'correlation_id']) {
    assert.deepEqual(readAuditFilters(`?${key}=historical`, 'Asia/Shanghai').range, {
      preset: 'custom',
      start_date: '',
      end_date: '',
    });
  }
  assert.equal(
    readAuditFilters('?user_id=old&start_date=2025-01-01+00%3A00%3A00', 'UTC').range.start_date,
    '2025-01-01 00:00:00'
  );
});
test('unbounded and one-sided ranges plus every exact/multiple filter round-trip', () => {
  const filters = readAuditFilters(
    '?page=2&event_type=key_created,wallet_credit&actor_type=service&actor_kind=service&source=admin_users,admin_wallet&actor_id=service%3Aa%2Bb&user_id=user%2F1&api_key_id=key%2B1&user_email=a%2Bb%40example.com&reason_code=not-in-catalog&correlation_id=request%2F1&start_date=&end_date=2026-11-10+00%3A00%3A00',
    'UTC'
  );
  assert.deepEqual(readAuditFilters(auditQuery(filters, 'url').toString(), 'UTC'), filters);
  assert.equal(auditQuery(filters, 'api').get('actor_id'), 'service:a+b');
  assert.deepEqual(auditQuery(filters, 'api').getAll('reason_code'), ['not-in-catalog']);
  const allTime = readAuditFilters('?start_date=&end_date=', 'Asia/Shanghai');
  assert.deepEqual(
    readAuditFilters(auditQuery(allTime, 'url').toString(), 'Asia/Shanghai').range,
    allTime.range
  );
});
test('explicit reasons are never dropped because the current catalog contains only those values', () => {
  const filters = readAuditFilters('?reason_code=only-current-reason', 'UTC');
  assert.deepEqual(auditQuery(filters, 'api').getAll('reason_code'), ['only-current-reason']);
  assert.equal(auditQuery({ ...filters, reasons: null }, 'api').has('reason_code'), false);
});
