import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	invocationLogQuery,
	invocationLogsHref,
	legacyInvocationsHref,
	modelFilterFitsKinds,
	normalizeRequestLogKinds,
	parseRequestLogKinds,
	readRequestLogKinds,
	requestLogKindDisplayNodes,
	requestLogKindRoot,
	requestLogKindScope,
	requestLogKindState,
	selectedModelKinds,
	serializeRequestLogKinds,
	toggleRequestLogKind,
} from './request-log-kind';

const read = (search: string) => readRequestLogKinds(new URLSearchParams(search));
const tree = {
	model: ['model:llm', 'model:image', 'model:asr', 'model:tts', 'model:embedding'],
	tool: ['tool:web-search', 'tool:web-fetch'],
	mcp: ['mcp:docs', 'mcp:wiki'],
};

describe('request log kind terms', () => {
	it('accepts the three roots and their children only', () => {
		assert.equal(requestLogKindRoot('model'), 'model');
		assert.equal(requestLogKindRoot('model:image'), 'model');
		assert.equal(requestLogKindRoot('tool:web-search'), 'tool');
		assert.equal(requestLogKindRoot('mcp:soloent-insight'), 'mcp');
		for (const term of ['', 'model:video', 'mcp:docs/search', 'mcp:', 'tool:Web Search', 'invocation', 'gpt-5']) {
			assert.equal(requestLogKindRoot(term), null, term);
		}
	});

	it('normalizes order, duplicates and terms covered by a whole category', () => {
		assert.deepEqual(
			normalizeRequestLogKinds(['mcp:wiki', 'tool:web-fetch', 'model:tts', 'bogus', 'mcp:docs', 'tool:web-search', 'model:image', 'mcp:wiki']),
			['model:image', 'model:tts', 'tool:web-search', 'tool:web-fetch', 'mcp:docs', 'mcp:wiki'],
		);
		assert.deepEqual(normalizeRequestLogKinds(['tool:web-search', 'tool', 'mcp']), ['tool', 'mcp']);
		assert.deepEqual(normalizeRequestLogKinds(tree.model), ['model']);
	});

	it('parses the query value and reports unknown terms', () => {
		assert.deepEqual(parseRequestLogKinds(' mcp:docs , model ,x:y,'), { kinds: ['model', 'mcp:docs'], invalid: ['x:y'] });
		assert.deepEqual(parseRequestLogKinds(null), { kinds: [], invalid: [] });
	});

	it('omits the parameter when nothing or everything is selected', () => {
		assert.equal(serializeRequestLogKinds([]), '');
		assert.equal(serializeRequestLogKinds(['tool', 'mcp', 'model']), '');
		assert.equal(serializeRequestLogKinds(['mcp:docs', 'model:image']), 'model:image,mcp:docs');
	});

	it('tells whether the scope holds model requests and tool calls', () => {
		assert.deepEqual(requestLogKindScope([]), { model: true, invocation: true });
		assert.deepEqual(requestLogKindScope(['model:image']), { model: true, invocation: false });
		assert.deepEqual(requestLogKindScope(['mcp:docs', 'tool']), { model: false, invocation: true });
		assert.deepEqual(requestLogKindScope(['model', 'tool:web-search']), { model: true, invocation: true });
	});

	it('narrows the model list only when model kinds are picked without the whole category', () => {
		assert.deepEqual(selectedModelKinds(['model:image', 'model:tts', 'tool']), ['image', 'tts']);
		assert.equal(selectedModelKinds(['model']), null);
		assert.equal(selectedModelKinds(['tool']), null);
	});

	it('merges REST and MCP into one display node and shows nothing for an unrestricted scope', () => {
		assert.deepEqual(requestLogKindDisplayNodes(['model:image', 'tool', 'mcp']), ['model:image', 'invocation']);
		assert.deepEqual(requestLogKindDisplayNodes(['tool', 'mcp:docs']), ['tool', 'mcp:docs']);
		assert.deepEqual(requestLogKindDisplayNodes(['model', 'tool', 'mcp']), []);
	});
});

describe('request log kind tree', () => {
	it('derives parent states from the selected terms', () => {
		const kinds = ['model:image', 'tool', 'mcp:docs'];
		assert.equal(requestLogKindState(kinds, 'model', tree), 'mixed');
		assert.equal(requestLogKindState(kinds, 'model:image', tree), 'checked');
		assert.equal(requestLogKindState(kinds, 'model:llm', tree), 'unchecked');
		assert.equal(requestLogKindState(kinds, 'tool', tree), 'checked');
		assert.equal(requestLogKindState(kinds, 'tool:web-fetch', tree), 'checked');
		assert.equal(requestLogKindState(kinds, 'mcp', tree), 'mixed');
		assert.equal(requestLogKindState(kinds, 'invocation', tree), 'mixed');
		assert.equal(requestLogKindState(['tool', 'mcp'], 'invocation', tree), 'checked');
		assert.equal(requestLogKindState(['model'], 'invocation', tree), 'unchecked');
		// 细项逐个选全，父级显示为选中。
		assert.equal(requestLogKindState(['tool:web-search', 'tool:web-fetch'], 'tool', tree), 'checked');
	});

	it('collapses to the category when its last child is checked', () => {
		assert.deepEqual(toggleRequestLogKind(['tool:web-search'], 'tool:web-fetch', true, tree), ['tool']);
		assert.deepEqual(toggleRequestLogKind(['mcp:docs'], 'model:image', true, tree), ['model:image', 'mcp:docs']);
	});

	it('keeps the remaining children when one is unchecked under a selected category', () => {
		assert.deepEqual(toggleRequestLogKind(['model', 'mcp'], 'mcp:docs', false, tree), ['model', 'mcp:wiki']);
		assert.deepEqual(toggleRequestLogKind(['model'], 'model:llm', false, tree), [
			'model:image',
			'model:asr',
			'model:tts',
			'model:embedding',
		]);
	});

	it('checks and clears whole categories, including the combined tools node', () => {
		assert.deepEqual(toggleRequestLogKind(['tool:web-search', 'model:image'], 'tool', true, tree), ['model:image', 'tool']);
		assert.deepEqual(toggleRequestLogKind(['model', 'mcp:docs'], 'invocation', true, tree), ['model', 'tool', 'mcp']);
		assert.deepEqual(toggleRequestLogKind(['model', 'tool', 'mcp:docs'], 'invocation', false, tree), ['model']);
		assert.deepEqual(toggleRequestLogKind(['model:image', 'tool'], 'model', false, tree), ['tool']);
	});

	it('never treats the listed MCP servers as the whole MCP category', () => {
		// 日志里还有已删除服务的调用，现有服务选全不等于全部 MCP 工具。
		assert.deepEqual(toggleRequestLogKind(['mcp:docs'], 'mcp:wiki', true, tree), ['mcp:docs', 'mcp:wiki']);
		assert.equal(requestLogKindState(['mcp:docs', 'mcp:wiki'], 'mcp', tree), 'mixed');
		assert.deepEqual(toggleRequestLogKind([], 'mcp:docs', true, { ...tree, mcp: [] }), ['mcp:docs']);
	});
});

describe('model filter against the kind scope', () => {
	it('keeps filters that still fall inside the scope', () => {
		assert.equal(modelFilterFitsKinds('gpt-5', [], 'llm'), true);
		assert.equal(modelFilterFitsKinds('', ['tool'], undefined), true);
		assert.equal(modelFilterFitsKinds('gpt-5', ['model', 'tool'], 'llm'), true);
		assert.equal(modelFilterFitsKinds('gpt-image-1', ['model:image'], 'image'), true);
		assert.equal(modelFilterFitsKinds('gone-model', ['model:llm'], undefined), true);
		assert.equal(modelFilterFitsKinds('tool:web-search', ['tool:web-search', 'model'], undefined), true);
		assert.equal(modelFilterFitsKinds('mcp:docs/search', ['mcp:docs'], undefined), true);
		assert.equal(modelFilterFitsKinds('mcp:docs/search', ['mcp'], undefined), true);
	});

	it('drops filters the new scope can no longer match', () => {
		assert.equal(modelFilterFitsKinds('gpt-5', ['tool'], 'llm'), false);
		assert.equal(modelFilterFitsKinds('gpt-5', ['model:image'], 'llm'), false);
		assert.equal(modelFilterFitsKinds('tool:web-search', ['model'], undefined), false);
		assert.equal(modelFilterFitsKinds('tool:web-search', ['tool:web-fetch'], undefined), false);
		assert.equal(modelFilterFitsKinds('mcp:docs/search', ['mcp:wiki', 'tool'], undefined), false);
	});
});

describe('reading kinds from the URL', () => {
	it('uses the kinds parameter as is and ignores unknown terms', () => {
		assert.deepEqual(read('kinds=mcp%3Adocs%2Cmodel%3Aimage%2Cnope&provider_id=octafuse-tools'), {
			kinds: ['model:image', 'mcp:docs'],
			absorbed: [],
		});
		assert.deepEqual(read('kinds='), { kinds: [], absorbed: [] });
	});

	it('converts legacy provider and model parameters', () => {
		assert.deepEqual(read('provider_id=octafuse-tools'), { kinds: ['tool'], absorbed: ['provider_id'] });
		assert.deepEqual(read('provider_id=octafuse-tools&model_id=tool%3Aweb-search'), {
			kinds: ['tool:web-search'],
			absorbed: ['provider_id', 'model_id'],
		});
		assert.deepEqual(read('provider_id=octafuse-mcp'), { kinds: ['mcp'], absorbed: ['provider_id'] });
		assert.deepEqual(read('provider_id=octafuse-mcp&model_id_prefix=mcp%3Adocs%2F'), {
			kinds: ['mcp:docs'],
			absorbed: ['provider_id', 'model_id_prefix'],
		});
		assert.deepEqual(read('provider_ids=octafuse-mcp,octafuse-tools'), { kinds: ['tool', 'mcp'], absorbed: ['provider_ids'] });
		assert.deepEqual(read('model_id=tool%3Aweb-fetch'), { kinds: ['tool:web-fetch'], absorbed: ['model_id'] });
	});

	it('keeps a specific MCP tool as a model filter under its server', () => {
		assert.deepEqual(read('model_id=mcp%3Adocs%2Fsearch'), { kinds: ['mcp:docs'], absorbed: [] });
		assert.deepEqual(read('provider_id=octafuse-mcp&model_id=mcp%3Adocs%2Fsearch'), {
			kinds: ['mcp:docs'],
			absorbed: ['provider_id'],
		});
	});

	it('prefers the narrower MCP scope over the combined provider set', () => {
		assert.deepEqual(read('provider_ids=octafuse-tools,octafuse-mcp&model_id_prefix=mcp%3Adocs%2F'), {
			kinds: ['mcp:docs'],
			absorbed: ['model_id_prefix', 'provider_ids'],
		});
	});

	it('leaves unrelated filters untyped', () => {
		for (const search of [
			'',
			'model_id=gpt-4o',
			'provider_id=openai',
			'provider_id=openai&model_id=tool%3Aweb-search',
			'provider_ids=octafuse-tools,openai',
		]) {
			assert.deepEqual(read(search), { kinds: [], absorbed: [] }, search);
		}
	});
});

describe('invocation log scope', () => {
	it('keeps a selected MCP service scoped', () => {
		assert.equal(invocationLogQuery({ source: 'mcp', server: 'docs' }).get('kinds'), 'mcp:docs');
		assert.equal(invocationLogQuery({ source: 'mcp' }).get('kinds'), 'mcp');
	});

	it('limits an unfiltered view to both tool sources', () => {
		assert.equal(invocationLogQuery().toString(), 'kinds=tool%2Cmcp');
	});

	it('scopes a REST tool by id or model id, with or without a source', () => {
		for (const scope of [
			{ source: 'rest' as const, tool: 'web-search' },
			{ tool: 'tool:web-search' },
		]) {
			assert.equal(invocationLogQuery(scope).get('kinds'), 'tool:web-search');
		}
		assert.equal(invocationLogQuery({ source: 'rest' }).get('kinds'), 'tool');
	});

	it('ignores stale tool filters in MCP mode and stale server filters in REST mode', () => {
		assert.equal(invocationLogQuery({ source: 'mcp', tool: 'web-search', server: 'docs' }).get('kinds'), 'mcp:docs');
		assert.equal(invocationLogQuery({ source: 'rest', server: 'docs' }).get('kinds'), 'tool');
	});

	it('builds request-log links', () => {
		assert.equal(invocationLogsHref({ source: 'mcp', server: 'docs' }), '/gateway/request-logs?kinds=mcp%3Adocs');
		// slug 不合法时退回全部 MCP 工具，不把它写进类型。
		assert.equal(invocationLogsHref({ source: 'mcp', server: 'a b' }), '/gateway/request-logs?kinds=mcp');
	});
});

describe('legacy invocations bookmarks', () => {
	it('maps source, tool, status, range and page onto request-log filters', () => {
		const href = legacyInvocationsHref({
			source: 'rest',
			tool: 'web-fetch',
			status: 'error',
			start_date: '',
			end_date: '2026-11-01 00:00:00',
			page: '3',
		});
		const query = new URLSearchParams(href.split('?')[1]);
		assert.equal(href.startsWith('/gateway/request-logs?'), true);
		assert.equal(query.get('kinds'), 'tool:web-fetch');
		assert.equal(query.get('status'), 'error');
		assert.equal(query.get('start_date'), '');
		assert.equal(query.get('end_date'), '2026-11-01 00:00:00');
		assert.equal(query.get('page'), '3');
	});

	it('falls back to all tool calls and drops malformed values', () => {
		const query = new URLSearchParams(
			legacyInvocationsHref({ source: 'other', server: ['docs', 'x'], page: '0' }).split('?')[1],
		);
		assert.equal(query.get('kinds'), 'tool,mcp');
		assert.equal(query.has('page'), false);
		assert.equal(query.has('start_date'), false);
	});
});
