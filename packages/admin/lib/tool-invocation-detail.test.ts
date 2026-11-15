import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	classifyMcpFailure,
	listRequestParams,
	parseAiDetectionSummary,
	parseMcpArguments,
	parseMcpInvocationSummary,
	parseMcpResult,
	parseToolPricingAudit,
	parseToolResponseSummary,
	resolveInvocationSource,
} from './tool-invocation-detail';

describe('resolveInvocationSource', () => {
	it('classifies REST and MCP rows', () => {
		assert.equal(resolveInvocationSource({ provider_id: 'octafuse-tools', model_id: 'tool:web-search' }), 'rest');
		assert.equal(resolveInvocationSource({ provider_id: 'octafuse-mcp', model_id: 'mcp:deepwiki/ask' }), 'mcp');
		assert.equal(resolveInvocationSource({ model_id: 'mcp:mock/echo' }), 'mcp');
		assert.equal(resolveInvocationSource({ provider_id: 'openai', model_id: 'gpt-5' }), null);
	});
});

describe('parseMcpInvocationSummary', () => {
	it('reads the slug, tool name, and a short argument summary', () => {
		const summary = parseMcpInvocationSummary({
			model_id: 'mcp:deepwiki/read_wiki_structure',
			request_body: JSON.stringify({
				name: 'read_wiki_structure',
				arguments: { repoName: 'OctaFuse/octafuse-gateway', extra: { n: 1 } },
			}),
		});
		assert.equal(summary.slug, 'deepwiki');
		assert.equal(summary.tool, 'read_wiki_structure');
		assert.equal(summary.label, 'deepwiki / read_wiki_structure');
		assert.match(summary.argumentSummary ?? '', /repoName=OctaFuse\/octafuse-gateway/);
	});
});

describe('request parameters', () => {
	it('lists parameters by name and leaves out fields shown elsewhere', () => {
		assert.deepEqual(
			listRequestParams({ query: 'durable objects', provider: 'bocha', count: 2, allowed_domains: ['a.dev'] }, ['provider']),
			[
				{ name: 'query', value: 'durable objects' },
				{ name: 'count', value: '2' },
				{ name: 'allowed_domains', value: '[\n  "a.dev"\n]' },
			]
		);
	});

	it('distinguishes a call without arguments from an unreadable request body', () => {
		assert.deepEqual(parseMcpArguments('{"name":"insight_sites","arguments":{}}'), []);
		assert.deepEqual(parseMcpArguments('{"name":"ask","arguments":{"repo":"a/b"}}'), [{ name: 'repo', value: 'a/b' }]);
		assert.equal(parseMcpArguments('{"name":"ask","arguments":{"repo":"a/…'), null);
		assert.equal(parseMcpArguments(null), null);
	});
});

describe('REST tool responses', () => {
	it('keeps the fetched content length', () => {
		const summary = parseToolResponseSummary(
			JSON.stringify({ url: 'https://a.dev/', title: 'A', content_preview: 'hello', content_length: 3156 })
		);
		assert.equal(summary.contentLength, 3156);
		assert.deepEqual(summary.results, [{ title: 'A', url: 'https://a.dev/', snippet: 'hello' }]);
	});

	it('reads AI detection scores per segment', () => {
		const summary = parseAiDetectionSummary(
			JSON.stringify({
				overall_score: 62.5,
				total_chars: 1200,
				billing_units: 2,
				segment_count: 2,
				segments: [
					{ index: 0, chars: 800, score: 80 },
					{ index: 1, chars: 400, score: 27.5 },
				],
			})
		);
		assert.equal(summary?.overallScore, 62.5);
		assert.equal(summary?.totalChars, 1200);
		assert.equal(summary?.segmentCount, 2);
		assert.deepEqual(summary?.segments[1], { index: 1, chars: 400, score: 27.5 });
		assert.equal(parseAiDetectionSummary(null), null);
	});
});

describe('parseMcpResult', () => {
	it('formats JSON text blocks and keeps other block types as JSON', () => {
		const result = parseMcpResult(
			JSON.stringify({
				content: [
					{ type: 'text', text: '{"total":2}' },
					{ type: 'text', text: 'plain answer' },
					{ type: 'image', mimeType: 'image/png', data: 'AAAA' },
				],
				structuredContent: { total: 2 },
				isError: false,
			})
		);
		assert.deepEqual(result?.blocks[0], { type: 'text', text: '{\n  "total": 2\n}', isJson: true });
		assert.deepEqual(result?.blocks[1], { type: 'text', text: 'plain answer', isJson: false });
		assert.equal(result?.blocks[2].type, 'image');
		assert.equal(result?.structured, '{\n  "total": 2\n}');
		assert.equal(result?.isError, false);
		assert.equal(result?.truncated, false);
	});

	it('reports upstream tool errors', () => {
		const result = parseMcpResult('{"content":[{"type":"text","text":"upstream failed"}],"isError":true}');
		assert.equal(result?.isError, true);
		assert.equal(result?.blocks[0].text, 'upstream failed');
	});

	it('recovers readable text from a result cut off by the log limit', () => {
		const full = JSON.stringify({ content: [{ type: 'text', text: '{\n  "name": "起点 \\"三江\\"",\n  "rows": [1, 2, 3]\n}' }] });
		// 截断点分别落在普通字符、`\n` 转义和 `\"` 转义的中间。
		for (const cut of [full.indexOf('rows'), full.indexOf('\\n') + 1, full.indexOf('\\\\') + 1]) {
			const result = parseMcpResult(`${full.slice(0, cut)}…`);
			assert.equal(result?.truncated, true);
			assert.equal(result?.blocks.length, 1);
			assert.ok(result?.blocks[0].text.startsWith('{'), result?.blocks[0].text);
			assert.ok(!result?.blocks[0].text.includes('"content"'));
			assert.ok(!result?.blocks[0].text.endsWith('\\'));
		}
	});

	it('shows unreadable results as stored', () => {
		assert.deepEqual(parseMcpResult('not json'), {
			blocks: [{ type: 'text', text: 'not json', isJson: false }],
			structured: null,
			isError: false,
			truncated: false,
		});
		assert.equal(parseMcpResult('  '), null);
	});
});

describe('classifyMcpFailure', () => {
	it('tells where an MCP call failed', () => {
		assert.equal(classifyMcpFailure('Upstream tool returned isError'), 'toolError');
		assert.equal(classifyMcpFailure('Upstream returned an invalid tool result'), 'invalidResult');
		assert.equal(classifyMcpFailure('MCP upstream timed out'), 'timeout');
		assert.equal(classifyMcpFailure('MCP upstream request failed'), 'upstream');
		assert.equal(classifyMcpFailure(null), null);
	});
});

describe('parseToolPricingAudit', () => {
	it('reads unit prices and the MCP rule snapshot', () => {
		const pricing = parseToolPricingAudit(
			JSON.stringify({
				v: 4,
				kind: 'fixed_tool_cost',
				tool_id: 'mcp:deepwiki/ask',
				unit: 'request',
				billing_units: 1,
				unit_prices: { metered: 0.01, standard: 0.02, charged: 0.05 },
				totals: { metered_cost: 0.01, standard_cost: 0.02, charged_cost: 0.05 },
				mcp_pricing: {
					rule_source: 'server',
					rule_version: 2,
					charged_factor: 2.5,
					metered_factor: 0.5,
					preflight_units: 1,
					unit: 'request',
					settled_units: 1,
				},
			})
		);
		assert.deepEqual(pricing, {
			unit: 'request',
			billingUnits: 1,
			unitPrices: { charged: 0.05, metered: 0.01, standard: 0.02 },
			chargedFactor: 2.5,
			meteredFactor: 0.5,
			ruleSource: 'server',
			preflightUnits: 1,
			settledUnits: 1,
		});
	});

	it('reads REST tool factors and tolerates rows without a rule snapshot', () => {
		const base = { kind: 'fixed_tool_cost', unit: 'chars', billing_units: 3, unit_prices: { charged: 0.2 } };
		const withFactors = parseToolPricingAudit(
			JSON.stringify({ ...base, tool_pricing: { rule_version: 1, charged_factor: 2, metered_factor: 1 } })
		);
		assert.equal(withFactors?.chargedFactor, 2);
		assert.equal(withFactors?.ruleSource, null);
		const legacy = parseToolPricingAudit(JSON.stringify(base));
		assert.equal(legacy?.chargedFactor, null);
		assert.deepEqual(legacy?.unitPrices, { charged: 0.2, metered: null, standard: null });
		assert.equal(parseToolPricingAudit('{"v":3,"kind":"tokens"}'), null);
	});
});
