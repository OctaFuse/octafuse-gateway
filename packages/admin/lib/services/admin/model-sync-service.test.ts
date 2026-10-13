import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GatewayRepositories } from '@octafuse/core';
import { listStaticModelPresets } from '@/lib/model-preset';
import { applyModelSyncService, getModelSyncReportService } from './model-sync-service';

type Row = Record<string, unknown> & { id: string };

function fakeRepos(rows: Row[]) {
	const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
	const tagWrites: string[] = [];
	const repos = {
		systemConfig: { getConfig: async () => 'USD' },
		models: {
			listModelsWithRouteCounts: async () => rows,
			getModelDetailWithRouteCounts: async (id: string) => rows.find((r) => r.id === id) ?? null,
			updateModelByPatch: async (id: string, patch: Record<string, unknown>) => {
				patches.push({ id, patch });
				return 1;
			},
			replaceModelTags: async (id: string) => {
				tagWrites.push(id);
			},
		},
		modelRouting: { getModelById: async () => null },
		routes: { listModelRoutesWithJoins: async () => [] },
	} as unknown as GatewayRepositories;
	return { repos, patches, tagWrites };
}

describe('model sync service', () => {
	const preset = listStaticModelPresets().find((p) => p.display_name && p.context_window);
	assert.ok(preset, 'need a bundled preset with display_name and context_window');
	const id = String(preset.id);

	it('reports a stale imported model and ignores user-made models', async () => {
		const { repos } = fakeRepos([
			{
				id,
				display_name: 'Old Name',
				vendor: preset.vendor,
				context_window: 1,
				routes_count: 2,
				active_routes_count: 1,
			},
			{ id: 'custom-model-not-in-catalog', display_name: 'Mine', routes_count: 0, active_routes_count: 0 },
		]);
		const report = await getModelSyncReportService(repos);
		assert.equal(report.models_with_diff, 1);
		const entry = report.groups.flatMap((g) => g.models).find((m) => m.model_id === id);
		assert.ok(entry);
		assert.equal(entry.routes_count, 2);
		const keys = entry.fields.map((f) => f.key);
		assert.ok(keys.includes('display_name'));
		assert.ok(keys.includes('context_window'));
	});

	it('apply writes only the selected fields and never touches tags', async () => {
		const { repos, patches, tagWrites } = fakeRepos([
			{ id, display_name: 'Old Name', vendor: preset.vendor, context_window: 1, routes_count: 0, active_routes_count: 0 },
		]);
		const out = await applyModelSyncService(repos, { items: [{ model_id: id, fields: ['display_name'] }] });
		assert.deepEqual(out, { updated: 1, skipped: 0, failed: [] });
		assert.equal(patches.length, 1);
		assert.deepEqual(Object.keys(patches[0].patch), ['display_name']);
		assert.equal(patches[0].patch.display_name, preset.display_name);
		assert.deepEqual(tagWrites, []);
	});

	it('apply skips fields that no longer differ and rejects empty bodies', async () => {
		const { repos, patches } = fakeRepos([
			{ id, display_name: preset.display_name, vendor: preset.vendor, context_window: preset.context_window },
		]);
		const out = await applyModelSyncService(repos, {
			items: [{ model_id: id, fields: ['display_name', 'context_window'] }],
		});
		assert.equal(out.updated, 0);
		assert.equal(out.skipped, 1);
		assert.equal(patches.length, 0);
		await assert.rejects(() => applyModelSyncService(repos, { items: [] }));
	});

	it('unknown model ids are reported as failed', async () => {
		const { repos } = fakeRepos([]);
		const out = await applyModelSyncService(repos, { items: [{ model_id: 'nope', fields: ['description'] }] });
		assert.equal(out.failed.length, 1);
	});
});
