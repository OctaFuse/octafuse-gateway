import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	isModelRetiringSoon,
	modelLifecycleMatchesFilter,
	parseModelLifecycleFilter,
	resolveModelLifecycle,
} from './model-lifecycle';
import { getStaticModelPresetRetired, listStaticModelPresets } from './model-preset';

const TODAY = '2026-10-16';

describe('resolveModelLifecycle', () => {
	it('treats empty as active', () => {
		assert.equal(resolveModelLifecycle(null, TODAY), 'active');
		assert.equal(resolveModelLifecycle(undefined, TODAY), 'active');
		assert.equal(resolveModelLifecycle('', TODAY), 'active');
	});
	it('future date is active, today and past are retired', () => {
		assert.equal(resolveModelLifecycle('2026-10-17', TODAY), 'active');
		assert.equal(resolveModelLifecycle('2026-10-16', TODAY), 'retired');
		assert.equal(resolveModelLifecycle('2025-01-01', TODAY), 'retired');
	});
	it('invalid date falls back to active', () => {
		assert.equal(resolveModelLifecycle('soon', TODAY), 'active');
	});
});

describe('isModelRetiringSoon', () => {
	it('only for future dates', () => {
		assert.equal(isModelRetiringSoon('2026-10-17', TODAY), true);
		assert.equal(isModelRetiringSoon('2026-10-16', TODAY), false);
		assert.equal(isModelRetiringSoon(null, TODAY), false);
	});
});

describe('modelLifecycleMatchesFilter', () => {
	it('filters by lifecycle', () => {
		assert.equal(modelLifecycleMatchesFilter('2020-01-01', 'all', TODAY), true);
		assert.equal(modelLifecycleMatchesFilter('2020-01-01', 'active', TODAY), false);
		assert.equal(modelLifecycleMatchesFilter('2020-01-01', 'retired', TODAY), true);
		assert.equal(modelLifecycleMatchesFilter(null, 'active', TODAY), true);
		assert.equal(modelLifecycleMatchesFilter(null, 'retired', TODAY), false);
	});
});

describe('parseModelLifecycleFilter', () => {
	it('defaults to all', () => {
		assert.equal(parseModelLifecycleFilter('retired'), 'retired');
		assert.equal(parseModelLifecycleFilter('active'), 'active');
		assert.equal(parseModelLifecycleFilter('x'), 'all');
		assert.equal(parseModelLifecycleFilter(null), 'all');
	});
});

describe('static catalog retired dates', () => {
	it('uses valid dates and resolves by model id', () => {
		let withRetired = 0;
		for (const preset of listStaticModelPresets()) {
			if (!preset.retired) {
				assert.equal(getStaticModelPresetRetired(preset.id), null, preset.id);
				continue;
			}
			withRetired += 1;
			assert.match(preset.retired, /^\d{4}-\d{2}-\d{2}$/, preset.id);
			assert.equal(getStaticModelPresetRetired(preset.id), preset.retired, preset.id);
		}
		assert.ok(withRetired > 0);
	});

	it('returns null for models missing from the catalog', () => {
		assert.equal(getStaticModelPresetRetired('custom-model-not-in-catalog'), null);
	});
});
