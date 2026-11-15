import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	appendAnyOfCondition,
	appendModelIdPrefixCondition,
	appendModelScopeCondition,
	appendProviderIdsCondition,
	appendProviderScopeCondition,
	escapeSqlLike,
	requestLogModelKindCase,
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

	it('matches provider ids or provider kinds resolved against the catalog', () => {
		const conditions: string[] = [];
		const bindValues: unknown[] = [];
		appendProviderScopeCondition(conditions, bindValues, 'rl.', { providerIds: ['p1', ' p1 ', 'p2'], kinds: ['DeepSeek', ''] });
		assert.deepEqual(conditions, [
			"(rl.provider_id IN (?, ?) OR rl.provider_id IN (SELECT p.id FROM providers p WHERE COALESCE(p.kind, '') IN (?, ?)))",
		]);
		assert.deepEqual(bindValues, ['p1', 'p2', 'DeepSeek', '']);
	});

	it('keeps the plain IN list when only provider ids are given and skips an empty scope', () => {
		const conditions: string[] = [];
		const bindValues: unknown[] = [];
		appendProviderScopeCondition(conditions, bindValues, '', { providerIds: ['p1'] });
		appendProviderScopeCondition(conditions, bindValues, '', { providerIds: [], kinds: undefined });
		appendModelScopeCondition(conditions, bindValues, '', {});
		assert.deepEqual(conditions, ['provider_id IN (?)']);
		assert.deepEqual(bindValues, ['p1']);
	});

	it('matches model ids or model vendors resolved against the catalog', () => {
		const conditions: string[] = [];
		const bindValues: unknown[] = [];
		appendModelScopeCondition(conditions, bindValues, 'rl.', { modelIds: ['gpt-x'], vendors: ['openai', 'anthropic'] });
		appendModelScopeCondition(conditions, bindValues, '', { vendors: ['other'] });
		assert.deepEqual(conditions, [
			'(rl.model_id IN (?) OR rl.model_id IN (SELECT m.id FROM models m WHERE m.vendor IN (?, ?)))',
			'model_id IN (SELECT m.id FROM models m WHERE m.vendor IN (?))',
		]);
		assert.deepEqual(bindValues, ['gpt-x', 'openai', 'anthropic', 'other']);
	});

	it('ORs match groups and ANDs the conditions inside a group', () => {
		const conditions: string[] = [];
		const bindValues: unknown[] = [];
		appendAnyOfCondition(conditions, bindValues, 'rl.', [
			{ excludeProviderIds: ['octafuse-tools', ' ', 'octafuse-mcp'], excludeModelIds: ['img-1'] },
			{ providerIds: ['octafuse-tools'], modelIds: ['tool:web-search', 'tool:web-search', 'tool:web-fetch'] },
			{ providerIds: ['octafuse-mcp'], modelIdPrefix: 'mcp:docs/' },
		]);
		assert.deepEqual(conditions, [
			'(((rl.provider_id IS NULL OR rl.provider_id NOT IN (?, ?)) AND (rl.model_id IS NULL OR rl.model_id NOT IN (?)))' +
				' OR (rl.provider_id IN (?) AND rl.model_id IN (?, ?))' +
				" OR (rl.provider_id IN (?) AND rl.model_id LIKE ? ESCAPE '\\'))",
		]);
		assert.deepEqual(bindValues, [
			'octafuse-tools',
			'octafuse-mcp',
			'img-1',
			'octafuse-tools',
			'tool:web-search',
			'tool:web-fetch',
			'octafuse-mcp',
			'mcp:docs/%',
		]);
	});

	it('keeps a single one-condition group unwrapped', () => {
		const conditions: string[] = [];
		const bindValues: unknown[] = [];
		appendAnyOfCondition(conditions, bindValues, '', [
			{ providerIds: ['octafuse-mcp'] },
		]);
		assert.deepEqual(conditions, ['provider_id IN (?)']);
		assert.deepEqual(bindValues, ['octafuse-mcp']);
	});

	it('matches nothing for an empty group list or groups whose id list is empty', () => {
		for (const groups of [
			[],
			[{ modelIds: [] }],
			[{ providerIds: ['octafuse-tools'], modelIds: [' '] }],
			[{ modelKinds: { kinds: ['video'], catalog: {} } }],
		]) {
			const conditions: string[] = [];
			const bindValues: unknown[] = [];
			appendAnyOfCondition(conditions, bindValues, '', groups);
			assert.deepEqual(conditions, ['1 = 0']);
			assert.deepEqual(bindValues, []);
		}
	});

	it('adds no condition when unset or when one group is unrestricted', () => {
		for (const groups of [undefined, [{ providerIds: ['octafuse-tools'] }, {}]]) {
			const conditions: string[] = [];
			const bindValues: unknown[] = [];
			appendAnyOfCondition(conditions, bindValues, '', groups);
			assert.deepEqual(conditions, []);
			assert.deepEqual(bindValues, []);
		}
	});

	it('infers the model kind from billing, operations, the catalog, then falls back to llm', () => {
		const bindValues: unknown[] = [];
		const sql = requestLogModelKindCase('rl.', { image: ['img-1'], asr: ['asr-1', ' '], tts: [] }, bindValues);
		const billing = "COALESCE(rl.billing_kind, '')";
		const request = "COALESCE(rl.request_operation, '')";
		const upstream = "COALESCE(rl.upstream_operation, '')";
		assert.equal(
			sql,
			[
				'CASE',
				`WHEN ${billing} IN ('image_per_image', 'image_tokens') THEN 'image'`,
				`WHEN ${billing} = 'audio_per_character' THEN 'tts'`,
				`WHEN ${billing} = 'audio_per_second' THEN 'asr'`,
				`WHEN ${request} LIKE '%images.%' OR ${upstream} LIKE '%images.%' THEN 'image'`,
				`WHEN ${request} LIKE '%audio.speech%' OR ${upstream} LIKE '%audio.speech%' THEN 'tts'`,
				`WHEN ${request} LIKE '%audio.transcriptions%' OR ${upstream} LIKE '%audio.transcriptions%' THEN 'asr'`,
				`WHEN ${request} IN ('embeddings', 'models.embed') OR ${upstream} IN ('embeddings', 'models.embed') THEN 'embedding'`,
				"WHEN rl.model_id IN (?) THEN 'image'",
				"WHEN rl.model_id IN (?) THEN 'asr'",
				`WHEN ${billing} = 'audio_tokens' THEN 'asr'`,
				"ELSE 'llm' END",
			].join(' '),
		);
		assert.deepEqual(bindValues, ['img-1', 'asr-1']);
	});

	it('filters a group by model kind after its other conditions', () => {
		const conditions: string[] = [];
		const bindValues: unknown[] = [];
		appendAnyOfCondition(conditions, bindValues, '', [
			{ excludeProviderIds: ['octafuse-tools'], modelKinds: { kinds: ['tts', 'image', 'nope'], catalog: { tts: ['tts-1'] } } },
			{ providerIds: ['octafuse-mcp'] },
		]);
		assert.equal(conditions.length, 1);
		assert.match(
			conditions[0],
			/^\(\(\(provider_id IS NULL OR provider_id NOT IN \(\?\)\) AND CASE WHEN .* WHEN model_id IN \(\?\) THEN 'tts' .* ELSE 'llm' END IN \('image', 'tts'\)\) OR provider_id IN \(\?\)\)$/,
		);
		assert.deepEqual(bindValues, ['octafuse-tools', 'tts-1', 'octafuse-mcp']);
	});

	it('skips the kind expression when every model kind is selected', () => {
		const conditions: string[] = [];
		const bindValues: unknown[] = [];
		appendAnyOfCondition(conditions, bindValues, '', [
			{
				excludeProviderIds: ['octafuse-tools'],
				modelKinds: { kinds: ['llm', 'image', 'asr', 'tts', 'embedding'], catalog: { image: ['img-1'] } },
			},
		]);
		assert.deepEqual(conditions, ['(provider_id IS NULL OR provider_id NOT IN (?))']);
		assert.deepEqual(bindValues, ['octafuse-tools']);
	});

	it('uses the MySQL escape literal for prefixes inside a group', () => {
		const conditions: string[] = [];
		appendAnyOfCondition(conditions, [], 'rl.', [{ modelIdPrefix: 'mcp:a/' }], 'mysql');
		assert.deepEqual(conditions, ["rl.model_id LIKE ? ESCAPE '\\\\'"]);
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