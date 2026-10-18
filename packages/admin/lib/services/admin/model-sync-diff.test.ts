import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildModelSyncPatch, diffModelAgainstPreset } from '@/lib/model-sync-diff';
import { listStaticModelPresets, pickPresetPricingRawForBillingCurrency } from '@/lib/model-preset';
import { coerceModelPricingProfileInput } from '@/lib/services/admin/pricing-input';

const pricing = (input: number, output: number) =>
	JSON.stringify({ tiers: [{ upto: null, input_price: input, output_price: output }] });

const preset = {
	display_name: 'Model X',
	vendor: 'openai',
	context_window: 128000,
	max_tokens: 8192,
	released: '2026-01-01',
	input_modalities: ['text', 'image'],
	output_modalities: ['text'],
	pricing_profile: pricing(2, 10),
};

const synced = {
	display_name: 'Model X',
	vendor: 'openai',
	context_window: 128000,
	max_tokens: 8192,
	released_at: '2026-01-01',
	input_modalities: JSON.stringify(['image', 'text']),
	output_modalities: JSON.stringify(['text']),
	pricing_profile: pricing(2, 10),
};

describe('diffModelAgainstPreset', () => {
	it('returns no fields when the model matches (modalities order-insensitive)', () => {
		assert.deepEqual(diffModelAgainstPreset(synced, preset), []);
	});

	it('reports changed and added scalar fields with default_apply', () => {
		const fields = diffModelAgainstPreset(
			{ ...synced, display_name: 'Old', context_window: 64000 },
			preset
		);
		assert.deepEqual(
			fields.map((f) => [f.key, f.status]),
			[
				['display_name', 'changed'],
				['context_window', 'changed'],
			]
		);
		assert.ok(fields.every((f) => f.default_apply));
	});

	it('never proposes clearing a value the official entry does not specify', () => {
		const fields = diffModelAgainstPreset(
			{ ...synced, max_tokens: 4096, released_at: '2020-01-01' },
			{ ...preset, max_tokens: null, released: null }
		);
		assert.deepEqual(fields, []);
	});

	it('reports pricing as leaf rows and defaults to keeping the current price', () => {
		const [field] = diffModelAgainstPreset({ ...synced, pricing_profile: pricing(2, 8) }, preset);
		assert.equal(field.key, 'pricing_profile');
		assert.equal(field.default_apply, false);
		assert.deepEqual(field.key === 'pricing_profile' ? field.rows : [], [
			{ path: 'tiers[0].output_price', status: 'changed', current: '8', official: '10' },
		]);
	});

	it('flags extra local pricing leaves as removed and missing ones as added', () => {
		const local = JSON.stringify({ tiers: [{ upto: null, input_price: 2, output_price: 10, cache_read_price: 1 }] });
		const official = JSON.stringify({ tiers: [{ upto: null, input_price: 2, output_price: 10 }], image: { default: 1 } });
		const [field] = diffModelAgainstPreset(
			{ ...synced, pricing_profile: local },
			{ ...preset, pricing_profile: official }
		);
		assert.deepEqual(
			field.key === 'pricing_profile' ? field.rows.map((r) => [r.path, r.status]) : [],
			[
				['image.default', 'added'],
				['tiers[0].cache_read_price', 'removed'],
			]
		);
	});

	it('skips pricing when the official branch is unavailable', () => {
		assert.deepEqual(
			diffModelAgainstPreset({ ...synced, pricing_profile: pricing(1, 1) }, { ...preset, pricing_profile: null }),
			[]
		);
	});

	it('treats every bundled preset as in sync with a row built the way import builds it', () => {
		for (const row of listStaticModelPresets()) {
			const pricingProfile = coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(row, 'USD'));
			const model = {
				display_name: row.display_name ?? null,
				vendor: row.vendor ?? null,
				context_window: row.context_window ?? null,
				max_tokens: row.max_tokens ?? 8192,
				released_at: row.released ?? null,
				input_modalities: row.modalities ? JSON.stringify(row.modalities.input) : null,
				output_modalities: row.modalities ? JSON.stringify(row.modalities.output) : null,
				pricing_profile: pricingProfile,
			};
			const official = {
				display_name: row.display_name ?? null,
				vendor: row.vendor ?? null,
				context_window: row.context_window ?? null,
				max_tokens: row.max_tokens ?? null,
				released: row.released ?? null,
				input_modalities: row.modalities?.input ?? null,
				output_modalities: row.modalities?.output ?? null,
				pricing_profile: pricingProfile,
			};
			assert.deepEqual(diffModelAgainstPreset(model, official), [], row.id);
		}
	});
});

describe('buildModelSyncPatch', () => {
	const drifted = {
		...synced,
		display_name: 'Old',
		input_modalities: JSON.stringify(['text']),
		pricing_profile: pricing(2, 8),
	};

	it('only applies the selected fields', () => {
		assert.deepEqual(buildModelSyncPatch(drifted, preset, ['display_name']), { display_name: 'Model X' });
	});

	it('applies modalities and pricing from the official entry', () => {
		const patch = buildModelSyncPatch(drifted, preset, ['input_modalities', 'pricing_profile']);
		assert.deepEqual(patch, {
			input_modalities: ['text', 'image'],
			pricing_profile: pricing(2, 10),
		});
	});

	it('ignores unknown keys, protected fields and keys that no longer differ', () => {
		assert.deepEqual(buildModelSyncPatch(synced, preset, ['display_name', 'pricing_profile']), {});
		assert.deepEqual(buildModelSyncPatch(drifted, preset, ['tags', 'metadata', 'route_policy', 'note', 'id']), {});
	});
});
