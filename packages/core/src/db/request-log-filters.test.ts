import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	appendModelIdPrefixCondition,
	appendProviderIdsCondition,
	escapeSqlLike,
	isoToSqlUtcMillis,
} from './request-log-filters';

describe('request log list filters', () => {
	it('converts ISO instants to UTC SQL text with milliseconds', () => {
		assert.equal(isoToSqlUtcMillis('2026-10-22T16:36:23.123Z'), '2026-10-22 16:36:23.123');
		assert.equal(isoToSqlUtcMillis('2026-10-22T16:36:23Z'), '2026-10-22 16:36:23');
		assert.equal(isoToSqlUtcMillis('2026-10-22T16:36:23.000Z'), '2026-10-22 16:36:23');
		assert.equal(isoToSqlUtcMillis('2026-10-23T00:36:23.5+08:00'), '2026-10-22 16:36:23.500');
	});

	it('escapes like wildcards and the escape character', () => {
		assert.equal(escapeSqlLike('mcp:a_b%c\\d'), 'mcp:a\\_b\\%c\\\\d');
	});

	it('builds an IN list for provider ids and ignores blanks', () => {
		const conditions: string[] = [];
		const bindValues: unknown[] = [];
		appendProviderIdsCondition(conditions, bindValues, 'rl.provider_id', [' octafuse-tools ', '', 'octafuse-mcp']);
		assert.deepEqual(conditions, ['rl.provider_id IN (?, ?)']);
		assert.deepEqual(bindValues, ['octafuse-tools', 'octafuse-mcp']);
	});

	it('skips an empty provider id list', () => {
		const conditions: string[] = [];
		appendProviderIdsCondition(conditions, [], 'provider_id', []);
		assert.deepEqual(conditions, []);
	});

	it('builds a prefixed like with the escaped pattern', () => {
		const conditions: string[] = [];
		const bindValues: unknown[] = [];
		appendModelIdPrefixCondition(conditions, bindValues, 'rl.model_id', 'mcp:deep_wiki/');
		assert.deepEqual(conditions, ["rl.model_id LIKE ? ESCAPE '\\'"]);
		assert.deepEqual(bindValues, ['mcp:deep\\_wiki/%']);
	});

	it('writes the LIKE escape character as a doubled backslash on MySQL', () => {
		const conditions: string[] = [];
		appendModelIdPrefixCondition(conditions, [], 'rl.model_id', 'mcp:', 'mysql');
		assert.deepEqual(conditions, ["rl.model_id LIKE ? ESCAPE '\\\\'"]);
	});
});