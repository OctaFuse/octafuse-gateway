import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ETL_PG_TYPES } from './pg-types';

describe('ETL_PG_TYPES.date', () => {
	const { serialize } = ETL_PG_TYPES.date;

	it('D1 的无时区 UTC 文本原样交给 Postgres，不经过本地时区解释', () => {
		assert.equal(serialize('2026-04-05 21:07:00'), '2026-04-05 21:07:00');
		assert.equal(serialize('2026-04-05T21:07:00.123Z'), '2026-04-05T21:07:00.123Z');
	});

	it('JS Date 仍按 UTC 序列化', () => {
		assert.equal(serialize(new Date('2026-04-05T21:07:00Z')), '2026-04-05T21:07:00.000Z');
	});

	it('覆盖 timestamptz 参数类型', () => {
		assert.equal(ETL_PG_TYPES.date.to, 1184);
	});
});
