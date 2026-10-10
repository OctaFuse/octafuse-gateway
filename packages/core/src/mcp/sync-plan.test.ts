import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { McpServerItemRow } from '../db/mcp-types';
import { planMcpSync } from './sync-plan';

function row(partial: Partial<McpServerItemRow> & Pick<McpServerItemRow, 'id' | 'upstreamKey' | 'status' | 'contentHash'>): McpServerItemRow {
	return {
		serverId: 'server',
		kind: 'tool',
		upstreamKeyHash: 'hash',
		exposedName: `deepwiki__${partial.upstreamKey}`,
		exposedNameHash: 'exposed',
		definition: JSON.stringify({ name: partial.upstreamKey, description: 'old' }),
		pendingDefinition: null,
		pendingHash: null,
		reviewState: 'none',
		metered: null,
		standard: null,
		charged: null,
		syncedAt: '2026-01-01T00:00:00.000Z',
		...partial,
	};
}

describe('planMcpSync', () => {
	it('keeps new tools disabled and published text unchanged when an enabled tool changes', async () => {
		const existing = row({ id: 'keep', upstreamKey: 'ask', status: 'enabled', contentHash: 'old-hash' });
		const plan = await planMcpSync({
			slug: 'deepwiki',
			existing: [existing],
			incoming: [
				{ kind: 'tool', upstreamKey: 'ask', definition: { name: 'ask', description: 'new description' } },
				{ kind: 'tool', upstreamKey: 'fresh', definition: { name: 'fresh', description: 'fresh' } },
			],
			usedExposedNames: new Set([existing.exposedName]),
		});
		assert.deepEqual(plan.summary.added, ['tool:fresh']);
		assert.equal(plan.inserts[0]?.status, 'disabled');
		assert.equal(plan.inserts[0]?.reviewState, 'new');
		assert.deepEqual(plan.summary.changed, ['tool:ask']);
		assert.equal(plan.updates[0]?.definition, undefined);
		assert.match(plan.updates[0]?.pendingDefinition ?? '', /new description/);
	});

	it('marks a missing tool removed', async () => {
		const existing = row({ id: 'gone', upstreamKey: 'ask', status: 'enabled', contentHash: 'hash' });
		const plan = await planMcpSync({
			slug: 'deepwiki',
			existing: [existing],
			incoming: [],
			usedExposedNames: new Set(),
		});
		assert.equal(plan.updates[0]?.status, 'removed');
		assert.deepEqual(plan.summary.removed, ['tool:ask']);
	});
});
