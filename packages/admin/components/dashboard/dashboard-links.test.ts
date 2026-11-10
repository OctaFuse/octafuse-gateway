import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dashboardLogsHref, dashboardLogHref } from './dashboard-links';
import { dashboardErrorSummary } from './dashboard-presentation';

describe('dashboard drill-down context', () => {
  it('keeps the chosen window and encodes the exact model/user filter', () => {
    const href = dashboardLogsHref({ start_date: '2026-11-01 00:00:00', end_date: '2026-11-08 00:00:00' }, { model_id: 'org/model:team', user_email: 'a+b@example.com' });
    const q = new URL(href, 'http://localhost').searchParams;
    assert.equal(q.get('model_id'), 'org/model:team'); assert.equal(q.get('user_email'), 'a+b@example.com');
    assert.equal(q.get('start_date'), '2026-11-01 00:00:00'); assert.equal(q.get('end_date'), '2026-11-08 00:00:00');
  });
  it('opens a historical record by exact ID without the default today filter', () => {
    const q = new URL(dashboardLogHref({ id: 'request-1', created_at: '2026-11-01 00:00:00' }), 'http://localhost').searchParams;
    assert.equal(q.get('id'), 'request-1'); assert.equal(q.get('start_date'), ''); assert.equal(q.get('end_date'), '');
  });
  it('keeps exact lookup independent of timestamp format or missing timestamps', () => {
    assert.equal(dashboardLogHref({ id: 'same', created_at: '2026-11-01T08:00:00+08:00' }), dashboardLogHref({ id: 'same', created_at: 'invalid' }));
  });
});
describe('dashboard upstream error summary', () => {
  it('replaces an HTML error page while preserving its HTTP status', () => assert.equal(dashboardErrorSummary('HTTP 502: <!DOCTYPE html><html><body>long error</body></html>', 'Upstream error'), 'HTTP 502 · Upstream error'));
  it('keeps useful plain text errors and normalizes whitespace', () => assert.equal(dashboardErrorSummary('HTTP 400:  Unsupported\n model', 'Unknown'), 'HTTP 400: Unsupported model'));
  it('uses a localized fallback for an absent message', () => assert.equal(dashboardErrorSummary(null, '上游异常'), '上游异常'));
});
