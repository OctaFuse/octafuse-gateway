import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createTranslator } from 'next-intl';
import { toolConfigurationState } from './tool-workspace-state';
import { GATEWAY_TOOLS } from '@/lib/gateway-tools';
import {
	TOOL_API_DEFINITIONS,
	normalizeToolProxyUrl,
	toolApiUrl,
	buildToolCurl,
	buildAgentToolDefinition,
	buildToolExecutor,
	AGENT_TOOL_FORMATS,
	formatAgentToolDefinition,
	buildAgentToolHandler,
	type RestToolId,
} from './tool-api-guide';

const ids = Object.keys(TOOL_API_DEFINITIONS) as RestToolId[];
test('documents every public tool with matching required arguments and unique function names', () => {
	assert.deepEqual(
		ids,
		GATEWAY_TOOLS.map((tool) => tool.id)
	);
	assert.equal(new Set(ids.map((id) => TOOL_API_DEFINITIONS[id].name)).size, ids.length);
	for (const id of ids) {
		const tool = TOOL_API_DEFINITIONS[id];
		for (const name of tool.required) assert.ok(name in tool.request, `${id}: ${name}`);
		const definition = buildAgentToolDefinition(id, 'Tool description', { query: 'Search query' });
		assert.deepEqual(definition.inputSchema.required, tool.required);
		assert.deepEqual(Object.keys(definition.inputSchema.properties), Object.keys(tool.properties));
		assert.equal(definition.inputSchema.additionalProperties, false);
	}
	assert.equal(TOOL_API_DEFINITIONS['web-search'].properties.count.default, 8);
	assert.equal(TOOL_API_DEFINITIONS['web-deep-search'].properties.count.default, 5);
});

test('normalizes deployment prefixes without guessing a Proxy from invalid or scoped addresses', () => {
	assert.equal(normalizeToolProxyUrl(' https://gateway.example/prefix/// '), 'https://gateway.example/prefix');
	for (const raw of [
		'',
		'/v1',
		'javascript:alert(1)',
		'ftp://example.com',
		'https://user:password@example.com',
		'https://example.com/?key=secret',
		'https://example.com/#fragment',
		'https://example.com/v1',
		'https://example.com/v1/tools',
		'https://example.com/v1/chat/completions',
		'https://example.com/v1/tools/web-search',
		'https://example.com/mcp/server',
	]) {
		assert.equal(normalizeToolProxyUrl(raw), null, raw);
	}
	assert.equal(
		toolApiUrl('web-fetch', 'https://gateway.example/prefix/'),
		'https://gateway.example/prefix/v1/tools/web-fetch'
	);
	assert.equal(toolApiUrl('web-fetch', ''), 'https://<YOUR_PROXY_URL>/v1/tools/web-fetch');
});

test('cURL examples parse in a shell, including quoted deployment paths, and use user key env vars', () => {
	for (const id of ids) {
		const command = buildToolCurl(id, "https://gateway.example/path'quote");
		assert.equal(spawnSync('sh', ['-n'], { input: command, encoding: 'utf8' }).status, 0);
		assert.ok(command.includes('$OCTAFUSE_API_KEY'));
		assert.ok(command.includes(`/v1/tools/${id}`));
		assert.ok(!command.includes('providerApiKey'));
		// Stub cURL to inspect actual shell arguments without making any network request.
		const parsed = spawnSync('sh', ['-c', 'curl() { printf "%s\\0" "$@"; };\n' + command], {
			encoding: 'utf8',
			env: { ...process.env, OCTAFUSE_API_KEY: 'test-user-key' },
		});
		assert.equal(parsed.status, 0, parsed.stderr);
		const args = parsed.stdout.split('\0');
		assert.ok(args.includes(toolApiUrl(id, "https://gateway.example/path'quote")));
		assert.ok(args.includes('Authorization: Bearer test-user-key'));
		assert.deepEqual(JSON.parse(args[args.indexOf('--data') + 1]), TOOL_API_DEFINITIONS[id].request);
	}
});

test('generated executors post only tool arguments to the Proxy and return data or report errors', async () => {
	for (const id of ids) {
		const emitted = ts.transpileModule(buildToolExecutor(id, 'https://default.example'), {
			compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
			reportDiagnostics: true,
		});
		assert.equal(emitted.diagnostics?.length, 0);
		const exported: Record<string, (args: unknown) => Promise<unknown>> = {};
		let failed = false;
		let calls = 0;
		runInNewContext(emitted.outputText, {
			exports: exported,
			process: {
				env: { OCTAFUSE_BASE_URL: 'https://override.example/prefix/', OCTAFUSE_API_KEY: 'test-user-key' },
			},
			fetch: async (url: string, options: { method: string; body: string; headers: Record<string, string> }) => {
				calls++;
				assert.equal(url, `https://override.example/prefix/v1/tools/${id}`);
				assert.equal(options.method, 'POST');
				assert.equal(options.headers.Authorization, 'Bearer test-user-key');
				assert.deepEqual(JSON.parse(options.body), TOOL_API_DEFINITIONS[id].request);
				return {
					ok: !failed,
					status: failed ? 503 : 200,
					json: async () => (failed ? { error: 'not configured' } : { data: { result: 'ok' } }),
				};
			},
		});
		assert.deepEqual(await exported[TOOL_API_DEFINITIONS[id].name](TOOL_API_DEFINITIONS[id].request), {
			result: 'ok',
		});
		failed = true;
		await assert.rejects(
			exported[TOOL_API_DEFINITIONS[id].name](TOOL_API_DEFINITIONS[id].request),
			/503.*not configured/
		);
		assert.equal(calls, 2);
	}
});

test('API guide translations have matching keys and valid ICU placeholders in all four locales', () => {
	function flatten(value: Record<string, unknown>, prefix = ''): Array<[string, string]> {
		return Object.entries(value).flatMap(([key, item]) =>
			typeof item === 'string'
				? [[`${prefix}${key}`, item] as [string, string]]
				: flatten(item as Record<string, unknown>, `${prefix}${key}.`)
		);
	}
	let expected: string[] | undefined;
	for (const locale of ['en', 'zh', 'ja', 'ko']) {
		const toolMessages = JSON.parse(
			readFileSync(new URL(`../../../messages/${locale}.json`, import.meta.url), 'utf8')
		).tools;
		assert.equal(typeof toolMessages.workspace.noMatches, 'string', `${locale}: tools.workspace.noMatches`);
		const messages = { apiGuide: toolMessages.apiGuide, workspace: toolMessages.workspace };
		const entries = flatten(messages);
		if (expected)
			assert.deepEqual(
				entries.map(([key]) => key),
				expected
			);
		else expected = entries.map(([key]) => key);
		for (const [key, message] of entries) {
			assert.doesNotThrow(
				() =>
					createTranslator({
						locale,
						messages: { text: message },
						onError(error) {
							throw error;
						},
					})('text', { name: 'Tool', value: 8 }),
				`${locale}: ${key}`
			);
		}
	}
});

test('tool readiness follows saved credentials, not credentials being edited', () => {
	const item = {
		savedPrices: { standard: '0.001', charged: '0.001', metered: '0.001' },
		savedConfigured: false,
		status: {
			isActive: true,
			isSelected: true,
			isDirty: true,
			isConfigured: true,
			isImplemented: true,
			isLossPricing: false,
		},
	};
	assert.equal(toolConfigurationState([item]).ready, false);
	assert.equal(
		toolConfigurationState([{ ...item, savedConfigured: true, status: { ...item.status, isConfigured: false } }]).ready,
		true
	);
	assert.equal(
		toolConfigurationState([{ ...item, savedConfigured: true, status: { ...item.status, isActive: false } }]).ready,
		false
	);
	assert.equal(
		toolConfigurationState([{ ...item, savedConfigured: true, status: { ...item.status, isImplemented: false } }])
			.ready,
		false
	);
});

test('applied pricing remains separate from unsaved provider edits', () => {
	const applied = { standard: '0.001', charged: '0.001', metered: '0.001' };
	const state = toolConfigurationState([
		{
			savedPrices: applied,
			prices: { standard: '10', charged: '20', metered: '30' },
			savedConfigured: true,
			status: {
				isActive: true,
				isSelected: true,
				isDirty: true,
				isConfigured: true,
				isImplemented: true,
				isLossPricing: false,
			},
		},
	]);
	assert.equal(state.ready, true);
	assert.equal(state.dirty, true);
	assert.deepEqual(state.active?.savedPrices, applied);
	assert.equal(state.active?.prices.charged, '20');
});

test('Agent formats preserve optional arguments and protocol-specific wrappers without mutating the contract', () => {
	for (const id of ids) {
		const definition = buildAgentToolDefinition(id, 'Tool description', {});
		const original = JSON.stringify(definition);
		for (const format of AGENT_TOOL_FORMATS) {
			const result = JSON.parse(JSON.stringify(formatAgentToolDefinition(definition, format)));
			const fn = format === 'chat' ? result.function : result;
			assert.equal(fn.name, TOOL_API_DEFINITIONS[id].name);
			assert.equal(fn.description, 'Tool description');
			const schema = fn.parameters ?? fn.input_schema ?? fn.inputSchema;
			assert.deepEqual(schema.required, TOOL_API_DEFINITIONS[id].required);
			assert.equal(schema.additionalProperties, false);
			assert.deepEqual(Object.keys(schema.properties), Object.keys(TOOL_API_DEFINITIONS[id].properties));
			if (format === 'responses' || format === 'chat') {
				assert.equal(result.type, 'function');
				assert.equal(fn.strict, false);
				assert.ok(!('inputSchema' in fn));
			} else assert.ok(!('type' in result));
			if ('count' in schema.properties) assert.ok(!schema.required.includes('count'));
		}
		assert.equal(JSON.stringify(definition), original);
	}
});

test('Agent bridges preserve IDs, parse arguments and dispatch only the selected tool without retrying', async () => {
	for (const id of ids) {
		const name = TOOL_API_DEFINITIONS[id].name;
		for (const format of AGENT_TOOL_FORMATS) {
			const emitted = ts.transpileModule(buildAgentToolHandler(id, format), {
				compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
				reportDiagnostics: true,
			});
			assert.equal(emitted.diagnostics?.length, 0);
			let calls = 0;
			let fail = false;
			const exported: Record<string, (call: unknown) => Promise<unknown>> = {};
			runInNewContext(emitted.outputText, {
				exports: exported,
				[name]: async (args: unknown) => {
					calls++;
					assert.deepEqual(JSON.parse(JSON.stringify(args)), TOOL_API_DEFINITIONS[id].request);
					if (fail) throw new Error('Gateway unavailable');
					return { result: 'ok' };
				},
			});
			const args = TOOL_API_DEFINITIONS[id].request;
			const call =
				format === 'chat'
					? { id: 'original-call', function: { name, arguments: JSON.stringify(args) } }
					: format === 'anthropic'
					? { id: 'original-call', name, input: args }
					: format === 'responses'
					? { call_id: 'original-call', name, arguments: JSON.stringify(args) }
					: { name, arguments: args };
			const result = JSON.parse(JSON.stringify(await exported.handleToolCall(call)));
			const output = JSON.stringify({ result: 'ok' });
			const expected =
				format === 'chat'
					? { role: 'tool', tool_call_id: 'original-call', content: output }
					: format === 'anthropic'
					? { type: 'tool_result', tool_use_id: 'original-call', content: output }
					: format === 'responses'
					? { type: 'function_call_output', call_id: 'original-call', output }
					: { result: 'ok' };
			assert.deepEqual(result, expected);
			const wrongName =
				format === 'chat'
					? { ...call, function: { name: 'other_tool', arguments: JSON.stringify(args) } }
					: { ...call, name: 'other_tool' };
			await assert.rejects(exported.handleToolCall(wrongName), /Unknown tool/);
			assert.equal(calls, 1);
			if (format === 'responses' || format === 'chat') {
				const invalid =
					format === 'chat' ? { ...call, function: { name, arguments: '{' } } : { ...call, arguments: '{' };
				await assert.rejects(exported.handleToolCall(invalid));
				assert.equal(calls, 1);
			}
			fail = true;
			await assert.rejects(exported.handleToolCall(call), /Gateway unavailable/);
			assert.equal(calls, 2);
		}
	}
});
