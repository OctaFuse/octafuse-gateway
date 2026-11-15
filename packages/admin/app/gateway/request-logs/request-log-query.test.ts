import assert from 'node:assert/strict';
import { test } from 'node:test';
import { utcApiToZonedInput } from '@/lib/business-timezone-client';
import {
	customLogRange,
	readRequestLogFilters,
	requestLogDuration,
	requestLogQuery,
} from './request-log-query';

test('default today starts at midnight in the configured business timezone', () => {
	for (const timezone of ['Asia/Shanghai', 'America/New_York']) {
		const filters = readRequestLogFilters('', timezone);
		assert.equal(filters.range.preset, 'today');
		assert.match(utcApiToZonedInput(filters.range.start_date, timezone), /T00:00$/);
	}
});
test('unbounded, one-sided and historical exact-ID lookups survive URL round trips', () => {
	for (const search of [
		'?start_date=&end_date=',
		'?start_date=2025-01-01+00%3A00%3A00',
		'?end_date=2025-01-01+00%3A00%3A00',
		'?id=historical%2Frequest',
	]) {
		const filters = readRequestLogFilters(search, 'Asia/Shanghai');
		const reloaded = readRequestLogFilters(requestLogQuery(filters).toString(), 'Asia/Shanghai');
		assert.deepEqual(reloaded, filters);
		assert.equal(filters.range.preset, 'custom');
	}
	assert.deepEqual(readRequestLogFilters('?id=old', 'Asia/Shanghai').range, {
		preset: 'custom',
		start_date: '',
		end_date: '',
	});
});
test('URL and API queries retain every filter including encoded identity and pagination', () => {
	const filters = readRequestLogFilters(
		'?page=2&status=error&model_id=model%2F1&provider_id=provider%2B1&user_email=a%2Bb%40example.com&api_key_id=key%2F1&id=log%2B1&route_group=free&protocol=gemini&start_date=&end_date=',
		'Asia/Shanghai'
	);
	const query = requestLogQuery(filters);
	assert.equal(query.get('page_size'), '50');
	assert.equal(query.get('user_email'), 'a+b@example.com');
	// 旧链接的单值 model_id / provider_id 并进多选。
	assert.deepEqual([filters.models.items, filters.providers.items], [['model/1'], ['provider+1']]);
	assert.equal(query.get('provider_ids'), 'provider+1');
	assert.equal(query.get('model_ids'), 'model/1');
	assert.equal(query.has('provider_id') || query.has('model_id'), false);
	assert.deepEqual(readRequestLogFilters(query.toString(), 'Asia/Shanghai'), filters);
	for (const page of ['0', '-1', 'NaN', '1.5'])
		assert.equal(readRequestLogFilters(`?page=${page}`, 'UTC').page, 1);
});
test('custom bounds convert business wall time to UTC and reject reversed or malformed ranges', () => {
	assert.deepEqual(customLogRange('2026-11-10T00:00', '2026-11-10T01:00', 'Asia/Shanghai'), {
		preset: 'custom',
		start_date: '2026-11-09 16:00:00',
		end_date: '2026-11-09 17:00:00',
	});
	assert.deepEqual(customLogRange('', '', 'Asia/Shanghai'), {
		preset: 'custom',
		start_date: '',
		end_date: '',
	});
	assert.equal(customLogRange('2026-11-10T01:00', '2026-11-10T00:00', 'Asia/Shanghai'), null);
	assert.equal(customLogRange('broken', '', 'UTC'), null);
	assert.equal(customLogRange('', '2026-11-10T00:00', 'Asia/Shanghai')?.start_date, '');
});
test('duration formatting distinguishes missing observations, zero, milliseconds and seconds', () => {
	for (const value of [null, undefined, -1, NaN, Infinity, '12'])
		assert.equal(requestLogDuration(value), '—');
	assert.equal(requestLogDuration(0), '0 ms');
	assert.equal(requestLogDuration(999), '999 ms');
	assert.equal(requestLogDuration(1000), '1 s');
	assert.equal(requestLogDuration(13432), '13.43 s');
});

test('reads the type scope from kinds and writes it back', () => {
	const cases: [string, string[], Record<string, string | null>][] = [
		['?kinds=mcp%3Adocs%2Cmodel%3Aimage&provider_id=p1&protocol=openai', ['model:image', 'mcp:docs'], { kinds: 'model:image,mcp:docs', provider_ids: 'p1', protocol: 'openai' }],
		['?kinds=tool%3Aweb-search&status=error', ['tool:web-search'], { kinds: 'tool:web-search', status: 'error', model_id: null }],
		['?provider_id=p1&provider_ids=p1,p2', [], { provider_id: null, provider_ids: 'p1,p2', kinds: null }],
	];
	for (const [search, kinds, expected] of cases) {
		const filters = readRequestLogFilters(`${search}&start_date=&end_date=`, 'Asia/Shanghai');
		assert.deepEqual(filters.kinds, kinds, search);
		const params = requestLogQuery(filters);
		for (const [key, value] of Object.entries(expected)) assert.equal(params.get(key), value, `${search} ${key}`);
		assert.deepEqual(readRequestLogFilters(params.toString(), 'Asia/Shanghai'), filters);
	}
});
test('legacy provider and model parameters become kinds and are not kept as separate filters', () => {
	const tool = readRequestLogFilters('?provider_id=octafuse-tools&model_id=tool%3Aweb-fetch', 'UTC');
	assert.deepEqual([tool.kinds, tool.providers.items, tool.models.items, tool.invocationModel], [['tool:web-fetch'], [], [], '']);
	assert.equal(requestLogQuery(tool).get('kinds'), 'tool:web-fetch');
	assert.equal(requestLogQuery(tool).has('provider_id'), false);

	// 旧「调用记录」的范围：两个工具 provider 加 MCP 服务前缀，按 MCP 服务还原。
	const server = readRequestLogFilters('?provider_ids=octafuse-tools,octafuse-mcp&model_id_prefix=mcp%3Adocs%2F', 'UTC');
	assert.deepEqual([server.kinds, server.providers.items, server.modelPrefix], [['mcp:docs'], [], undefined]);

	// 具体的 MCP 工具：类型到服务一级，工具仍按 model_id 筛。
	const mcpTool = readRequestLogFilters('?model_id=mcp%3Adocs%2Fsearch', 'UTC');
	assert.deepEqual([mcpTool.kinds, mcpTool.invocationModel, mcpTool.models.items], [['mcp:docs'], 'mcp:docs/search', []]);
	assert.equal(requestLogQuery(mcpTool).get('model_id'), 'mcp:docs/search');

	assert.deepEqual(readRequestLogFilters('?model_id=gpt-5', 'UTC').kinds, []);
});
test('model-only filters are dropped when the scope holds tool calls only', () => {
	const filters = readRequestLogFilters('?kinds=tool%2Cmcp&provider_id=p1&protocol=openai&route_group=vip&model_id=gpt-5', 'UTC');
	assert.deepEqual(
		[filters.providers, filters.models, filters.protocol, filters.routeGroup],
		[{ groups: [], items: [] }, { groups: [], items: [] }, '', ''],
	);
	const picked = { groups: ['g1'], items: ['i1'] };
	const params = requestLogQuery({ ...filters, providers: picked, models: picked, protocol: 'openai', routeGroup: 'vip' });
	for (const key of ['provider_ids', 'provider_kinds', 'model_ids', 'model_vendors', 'protocol', 'route_group'])
		assert.equal(params.has(key), false, key);
	// 范围里有模型请求时照常保留。
	assert.deepEqual(readRequestLogFilters('?kinds=model%2Ctool&provider_id=p1', 'UTC').providers.items, ['p1']);
});
test('model and provider selections round trip as vendors / kinds plus ids', () => {
	const search =
		'?model_vendors=openai%2Canthropic&model_ids=gemini-x%2Cqwen-y&provider_kinds=DeepSeek%2C__unclassified__&provider_ids=p1&start_date=&end_date=';
	const filters = readRequestLogFilters(search, 'UTC');
	assert.deepEqual(filters.models, { groups: ['openai', 'anthropic'], items: ['gemini-x', 'qwen-y'] });
	assert.deepEqual(filters.providers, { groups: ['DeepSeek', '__unclassified__'], items: ['p1'] });
	const params = requestLogQuery(filters);
	assert.deepEqual(
		['model_vendors', 'model_ids', 'provider_kinds', 'provider_ids'].map((key) => params.get(key)),
		['openai,anthropic', 'gemini-x,qwen-y', 'DeepSeek,__unclassified__', 'p1'],
	);
	assert.deepEqual(readRequestLogFilters(params.toString(), 'UTC'), filters);
	// 模型多选与链接带来的具体工具互不影响。
	const mixed = readRequestLogFilters('?model_ids=gpt-5&model_id=mcp%3Adocs%2Fsearch&kinds=model%2Cmcp', 'UTC');
	assert.deepEqual([mixed.models.items, mixed.invocationModel], [['gpt-5'], 'mcp:docs/search']);
});
