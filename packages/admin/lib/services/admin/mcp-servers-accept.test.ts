import assert from 'node:assert/strict';
import test from 'node:test';
import type { GatewayRepositories } from '@octafuse/core';
import { acceptMcpItemChanges } from './mcp-servers-service';
import { isAdminServiceError } from './errors';

type Row = {
	id: string;
	status: 'enabled' | 'disabled' | 'removed';
	reviewState: 'none' | 'new' | 'changed';
	pendingDefinition: string | null;
	pendingHash: string | null;
};

function fixture(rows: Row[], serverExists = true) {
	const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
	const repos = new Proxy({} as GatewayRepositories, {
		get(_target, key) {
			if (key !== 'mcpServers') throw new Error(`Unexpected repository: ${String(key)}`);
			return {
				getServerById: async () => (serverExists ? { id: 'srv' } : null),
				listItems: async () => rows,
				updateItem: async (id: string, patch: Record<string, unknown>) => {
					updates.push({ id, patch });
				},
			};
		},
	});
	return { repos, updates };
}

const changed = (id: string, over: Partial<Row> = {}): Row => ({
	id,
	status: 'enabled',
	reviewState: 'changed',
	pendingDefinition: `{"v":"${id}"}`,
	pendingHash: `hash-${id}`,
	...over,
});

test('batch accept promotes pending definitions and clears the review state', async () => {
	const { repos, updates } = fixture([changed('a'), changed('b')]);
	const result = await acceptMcpItemChanges(repos, 'srv', ['a', 'b']);
	assert.deepEqual(result, { accepted: 2, skipped: 0 });
	assert.deepEqual(updates[0], {
		id: 'a',
		patch: {
			definition: '{"v":"a"}',
			contentHash: 'hash-a',
			pendingDefinition: null,
			pendingHash: null,
			reviewState: 'none',
		},
	});
});

test('batch accept skips stale, removed and non-changed ids instead of failing', async () => {
	const { repos, updates } = fixture([
		changed('a'),
		changed('gone', { status: 'removed' }),
		{ id: 'fresh', status: 'disabled', reviewState: 'new', pendingDefinition: null, pendingHash: null },
		changed('unrequested'),
	]);
	const result = await acceptMcpItemChanges(repos, 'srv', ['a', 'gone', 'fresh', 'missing']);
	assert.deepEqual(result, { accepted: 1, skipped: 3 });
	assert.deepEqual(updates.map((u) => u.id), ['a']);
});

test('batch accept validates input and the server', async () => {
	await assert.rejects(
		() => acceptMcpItemChanges(fixture([]).repos, 'srv', 'a'),
		(error) => isAdminServiceError(error) && error.status === 400
	);
	await assert.rejects(
		() => acceptMcpItemChanges(fixture([], false).repos, 'srv', ['a']),
		(error) => isAdminServiceError(error) && error.status === 404
	);
});
