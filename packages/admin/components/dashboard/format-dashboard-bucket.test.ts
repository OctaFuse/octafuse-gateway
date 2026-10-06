import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatDashboardBucketLabel } from './format-dashboard-bucket';

describe('formatDashboardBucketLabel', () => {
	it('keeps a Shanghai wall-clock hour instead of shifting it as UTC', () => {
		assert.equal(formatDashboardBucketLabel('2026-10-06 00:00:00', 'hour', 'Asia/Shanghai'), '10-06 00:00');
		assert.equal(formatDashboardBucketLabel('2026-10-05 16:00:00', 'hour', 'Asia/Shanghai'), '10-05 16:00');
	});

	it('formats a business-timezone day bucket as month-day', () => {
		assert.equal(formatDashboardBucketLabel('2026-10-06', 'day', 'Asia/Shanghai'), '10-06');
	});

	it('returns an empty label for an empty bucket', () => {
		assert.equal(formatDashboardBucketLabel('', 'hour', 'UTC'), '');
	});
});
