import assert from 'node:assert/strict';
import test from 'node:test';
import type { GatewayRepositories } from '@octafuse/core';
import { createMcpServer, setMcpItemPricing } from './mcp-servers-service';
import { isAdminServiceError } from './errors';

function fixture() {
	const writes: Array<Parameters<GatewayRepositories['mcpServers']['insertServer']>[0]> = [];
	const updates: Array<Record<string, unknown>> = [];
	const repos = new Proxy({} as GatewayRepositories, {
		get(_target, key) {
			if (key !== 'mcpServers') throw new Error(`Unexpected repository: ${String(key)}`);
			return {
				getServerBySlug: async () => null,
				listItems: async () => [
					{ id: 'tool', kind: 'tool' },
					{ id: 'prompt', kind: 'prompt' },
				],
				updateItem: async (_id: string, patch: Record<string, unknown>) => {
					updates.push(patch);
				},
				insertServer: async (input: Parameters<GatewayRepositories['mcpServers']['insertServer']>[0]) => {
					writes.push(input);
				},
			};
		},
	});
	return { repos, writes, updates };
}
const input = { slug: 'test-service', name: 'Test', url: 'https://example.com/mcp' };

test('admin writes canonical request pricing into the existing JSON field', async () => {
	const { repos, writes } = fixture();
	await createMcpServer(repos, {
		...input,
		pricing: { v: 2, standard: 0.01, chargedFactor: 1.2, meteredFactor: 0.5 },
	});
	assert.equal(writes.length, 1);
	assert.deepEqual(JSON.parse(writes[0].pricing), {
		v: 2,
		unit: 'request',
		standard: 0.01,
		chargedFactor: 1.2,
		meteredFactor: 0.5,
		config: {},
	});
});
test('admin defaults new services to free request billing', async () => {
	const { repos, writes } = fixture();
	await createMcpServer(repos, input);
	assert.equal(JSON.parse(writes[0].pricing).chargedFactor, 0);
});
test('admin rejects unsupported modes and parameters as 400 before writes', async () => {
	const { repos, writes } = fixture();
	for (const patch of [{ unit: 'page' }, { terms: [{ kind: 'reported' }] }, { config: { credits: 2 } }]) {
		await assert.rejects(
			createMcpServer(repos, {
				...input,
				pricing: { prices: { metered: 0, standard: 0, charged: 0 }, ...patch },
			}),
			(error) => isAdminServiceError(error) && error.status === 400 && /pricing\./.test(error.message)
		);
	}
	assert.equal(writes.length, 0);
});

test('tool prices use the same factor envelope, and null restores inheritance', async () => {
	const { repos, updates } = fixture();
	await setMcpItemPricing(repos, 'server', 'tool', {
		pricing: { v: 2, standard: 0.02, chargedFactor: 1.5, meteredFactor: 0.7 },
	});
	assert.deepEqual(JSON.parse(updates[0].pricing as string), {
		v: 2,
		unit: 'request',
		standard: 0.02,
		chargedFactor: 1.5,
		meteredFactor: 0.7,
		config: {},
	});
	await setMcpItemPricing(repos, 'server', 'tool', { pricing: null });
	assert.equal(updates[1].pricing, null);
	await assert.rejects(
		setMcpItemPricing(repos, 'server', 'tool', { pricing: { v: 2, standard: 0.02, meteredFactor: -1 } })
	);
	assert.equal(updates.length, 2);
});
test('old independent prices are preserved through the admin API', async () => {
	const { repos, writes } = fixture();
	const pricing = {
		v: 1,
		unit: 'request',
		prices: { standard: 0, charged: 0.02, metered: 0.01 },
		config: {},
	};
	await createMcpServer(repos, { ...input, pricing });
	assert.deepEqual(JSON.parse(writes[0].pricing), pricing);
});
