import assert from 'node:assert/strict';
import { test } from 'node:test';
import { highlightCode } from './code-highlight';
import {
	AGENT_TOOL_FORMATS,
	TOOL_API_DEFINITIONS,
	buildAgentToolDefinition,
	formatAgentToolDefinition,
	buildAgentToolHandler,
	buildToolCurl,
	buildToolExecutor,
	type RestToolId,
} from '../app/gateway/tools/tool-api-guide';

const ids = Object.keys(TOOL_API_DEFINITIONS) as RestToolId[];

test('JSON highlighting distinguishes keys, strings, numbers and booleans without changing text', async () => {
	const code = '{\n  "query": "中文 <script>alert(1)</script> & \\"quoted\\"",\n  "count": 8, "enabled": false\n}\n';
	const tokens = await highlightCode(code, 'json');
	assert.equal(tokens.map((token) => token.text).join(''), code);
	assert.ok(tokens.some((token) => token.kind === 'var' && token.text.includes('query')));
	assert.ok(tokens.some((token) => token.kind === 'str' && token.text.includes('中文')));
	assert.ok(tokens.some((token) => token.kind === 'num' && token.text === '8'));
	assert.ok(tokens.some((token) => token.kind === 'bool' && token.text === 'false'));
});

test('cURL highlighting preserves shell quoting, environment variables and line continuations', async () => {
	for (const id of ids) {
		const code = buildToolCurl(id, "https://gateway.example/path'quote");
		const tokens = await highlightCode(code, 'bash');
		assert.equal(tokens.map((token) => token.text).join(''), code);
		assert.ok(tokens.some((token) => token.kind === 'func' && token.text === 'curl'));
		assert.ok(tokens.some((token) => token.kind === 'var' && token.text === '$OCTAFUSE_API_KEY'));
	}
});

test('all generated Agent definitions, executors and bridges retain exact code after tokenization', async () => {
	for (const id of ids) {
		const executor = buildToolExecutor(id, 'https://gateway.example/prefix');
		const executorTokens = await highlightCode(executor, 'ts');
		assert.equal(executorTokens.map((token) => token.text).join(''), executor);
		assert.ok(executorTokens.some((token) => token.kind === 'kwd' && token.text === 'await'));
		assert.ok(executorTokens.some((token) => token.kind === 'func' && token.text === 'fetch'));
		for (const format of AGENT_TOOL_FORMATS) {
			const definition = JSON.stringify(
				formatAgentToolDefinition(buildAgentToolDefinition(id, '工具说明', {}), format),
				null,
				2
			);
			const definitionTokens = await highlightCode(definition, 'json');
			assert.equal(definitionTokens.map((token) => token.text).join(''), definition);
			const handler = buildAgentToolHandler(id, format);
			const handlerTokens = await highlightCode(handler, 'ts');
			assert.equal(handlerTokens.map((token) => token.text).join(''), handler);
		}
	}
});
