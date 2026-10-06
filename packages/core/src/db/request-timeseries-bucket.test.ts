import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	businessTimezoneOffsetSeconds,
	mysqlTimeseriesBucketExpr,
	postgresTimeseriesBucketExpr,
	sqliteBusinessTimezoneModifier,
	sqliteTimeseriesBucketExpr,
} from './request-timeseries-bucket';

describe('request timeseries business timezone buckets', () => {
	const shanghaiEvening = new Date('2026-10-05T16:30:00.000Z');

	it('shifts Shanghai UTC instants by +8 hours', () => {
		assert.equal(sqliteBusinessTimezoneModifier('Asia/Shanghai', shanghaiEvening), '+480 minutes');
		assert.equal(businessTimezoneOffsetSeconds('Asia/Shanghai', shanghaiEvening), 8 * 60 * 60);
	});

	it('uses the offset at the given instant across DST', () => {
		assert.equal(sqliteBusinessTimezoneModifier('America/New_York', new Date('2026-01-15T12:00:00.000Z')), '-300 minutes');
		assert.equal(sqliteBusinessTimezoneModifier('America/New_York', new Date('2026-07-15T12:00:00.000Z')), '-240 minutes');
	});

	it('truncates Postgres timestamps in the bound IANA zone', () => {
		assert.match(
			postgresTimeseriesBucketExpr('hour', '$3'),
			/date_trunc\('hour', created_at AT TIME ZONE \$3\)/
		);
		assert.match(postgresTimeseriesBucketExpr('day', '$3'), /date_trunc\('day', created_at AT TIME ZONE \$3\)/);
		assert.doesNotMatch(postgresTimeseriesBucketExpr('hour', '$3'), /::timestamp/);
	});

	it('shifts SQLite and MySQL UTC timestamps before truncating', () => {
		assert.match(sqliteTimeseriesBucketExpr('hour'), /datetime\(created_at, \?\)/);
		assert.match(sqliteTimeseriesBucketExpr('day'), /%Y-%m-%d'/);
		assert.match(mysqlTimeseriesBucketExpr('hour'), /UNIX_TIMESTAMP\(created_at\) \+ \?/);
		assert.match(mysqlTimeseriesBucketExpr('day'), /%Y-%m-%d'/);
	});
});
