import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isRetryableD1Failure, rawToObjects } from './d1-rest';

describe('rawToObjects', () => {
	it('把列名数组 + 行数组还原成对象，保留 null 与数字', () => {
		assert.deepEqual(
			rawToObjects(['id', 'cost', 'note'], [
				['a', 1.5, null],
				['b', 0, 'x'],
			]),
			[
				{ id: 'a', cost: 1.5, note: null },
				{ id: 'b', cost: 0, note: 'x' },
			]
		);
	});

	it('没有行时返回空数组', () => {
		assert.deepEqual(rawToObjects(['id'], []), []);
	});
});

describe('isRetryableD1Failure', () => {
	it('限流、5xx、排队过载、超时可重试', () => {
		assert.equal(isRetryableD1Failure(429, ''), true);
		assert.equal(isRetryableD1Failure(502, 'bad gateway'), true);
		assert.equal(isRetryableD1Failure(200, 'D1 DB is overloaded. Requests queued for too long.'), true);
		assert.equal(isRetryableD1Failure(200, 'Query timed out'), true);
	});

	it('SQL 错误、鉴权错误、请求错误不重试', () => {
		assert.equal(isRetryableD1Failure(400, 'no such column: foo'), false);
		assert.equal(isRetryableD1Failure(403, 'Authentication error'), false);
	});
});
