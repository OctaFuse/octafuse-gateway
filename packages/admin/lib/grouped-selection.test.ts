import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	EMPTY_GROUPED_SELECTION,
	groupedGroupState,
	groupedItemState,
	groupedSelectionNodes,
	isEmptyGroupedSelection,
	normalizeGroupedSelection,
	parseGroupedSelection,
	toggleGroupedGroup,
	toggleGroupedItem,
	type GroupedCatalog,
} from './grouped-selection';

const catalog: GroupedCatalog = [
	{ group: 'openai', items: ['gpt-a', 'gpt-b', 'gpt-c'] },
	{ group: 'anthropic', items: ['claude-a'] },
];

describe('grouped selection', () => {
	it('reports group and item states', () => {
		const selection = { groups: ['anthropic'], items: ['gpt-a'] };
		assert.equal(groupedGroupState(selection, 'anthropic', catalog), 'checked');
		assert.equal(groupedGroupState(selection, 'openai', catalog), 'mixed');
		assert.equal(groupedGroupState(EMPTY_GROUPED_SELECTION, 'openai', catalog), 'unchecked');
		assert.equal(groupedItemState(selection, 'claude-a', catalog), 'checked');
		assert.equal(groupedItemState(selection, 'gpt-a', catalog), 'checked');
		assert.equal(groupedItemState(selection, 'gpt-b', catalog), 'unchecked');
	});

	it('checking a group replaces its items and unchecking removes both', () => {
		const picked = toggleGroupedGroup({ groups: [], items: ['gpt-a', 'claude-a'] }, 'openai', true, catalog);
		assert.deepEqual(picked, { groups: ['openai'], items: ['claude-a'] });
		assert.deepEqual(toggleGroupedGroup({ groups: [], items: ['gpt-a', 'claude-a'] }, 'openai', false, catalog), {
			groups: [],
			items: ['claude-a'],
		});
		assert.deepEqual(toggleGroupedGroup(picked, 'openai', false, catalog), { groups: [], items: ['claude-a'] });
	});

	it('checking the last item of a group collapses to the group', () => {
		let selection = toggleGroupedItem(EMPTY_GROUPED_SELECTION, 'gpt-a', true, catalog);
		selection = toggleGroupedItem(selection, 'gpt-b', true, catalog);
		assert.deepEqual(selection, { groups: [], items: ['gpt-a', 'gpt-b'] });
		assert.deepEqual(toggleGroupedItem(selection, 'gpt-c', true, catalog), { groups: ['openai'], items: [] });
		assert.deepEqual(toggleGroupedItem(EMPTY_GROUPED_SELECTION, 'claude-a', true, catalog), {
			groups: ['anthropic'],
			items: [],
		});
	});

	it('unchecking an item of a selected group keeps the other items', () => {
		assert.deepEqual(toggleGroupedItem({ groups: ['openai'], items: [] }, 'gpt-b', false, catalog), {
			groups: [],
			items: ['gpt-a', 'gpt-c'],
		});
		assert.deepEqual(toggleGroupedItem({ groups: ['anthropic'], items: [] }, 'claude-a', false, catalog), {
			groups: [],
			items: [],
		});
	});

	it('keeps groups and items that are not in the catalog and lets them be removed', () => {
		const selection = { groups: ['gone-vendor'], items: ['gone-model', 'gpt-a'] };
		assert.deepEqual(normalizeGroupedSelection(selection, catalog), selection);
		assert.deepEqual(toggleGroupedItem(selection, 'gone-model', false, catalog), {
			groups: ['gone-vendor'],
			items: ['gpt-a'],
		});
		assert.deepEqual(toggleGroupedGroup(selection, 'gone-vendor', false, catalog), {
			groups: [],
			items: ['gone-model', 'gpt-a'],
		});
	});

	it('lists selected nodes in catalog order with unknown ones last', () => {
		assert.deepEqual(
			groupedSelectionNodes({ groups: ['gone-vendor', 'anthropic'], items: ['gone-model', 'gpt-c', 'gpt-a', 'claude-a'] }, catalog),
			[
				{ type: 'item', id: 'gpt-a' },
				{ type: 'item', id: 'gpt-c' },
				{ type: 'group', id: 'anthropic' },
				{ type: 'group', id: 'gone-vendor' },
				{ type: 'item', id: 'gone-model' },
			],
		);
	});

	it('parses comma separated params', () => {
		assert.deepEqual(parseGroupedSelection('openai, anthropic,,openai', null), { groups: ['openai', 'anthropic'], items: [] });
		assert.equal(isEmptyGroupedSelection(parseGroupedSelection('', undefined)), true);
	});
});
