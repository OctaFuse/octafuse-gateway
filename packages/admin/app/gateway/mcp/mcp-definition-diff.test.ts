import assert from 'node:assert/strict';
import test from 'node:test';
import {
	changedFields,
	diffDefinitions,
	diffLines,
	foldUnchanged,
	stableStringify,
	type DiffLine,
} from './mcp-definition-diff';

const text = (lines: DiffLine[], kind: DiffLine['kind']) => lines.filter((l) => l.kind === kind).map((l) => l.text);

test('key order alone is not a change', () => {
	const before = { name: 'a', inputSchema: { type: 'object', required: ['x'] }, description: 'd' };
	const after = { description: 'd', inputSchema: { required: ['x'], type: 'object' }, name: 'a' };
	assert.equal(stableStringify(before), stableStringify(after));
	const result = diffDefinitions(before, after);
	assert.equal(result.added, 0);
	assert.equal(result.removed, 0);
	assert.deepEqual(result.fields, []);
});

test('a schema-only change leaves the description untouched and names the changed field', () => {
	const before = { name: 'tags', description: 'same', inputSchema: { properties: { limit: { type: 'number' } } } };
	const after = {
		name: 'tags',
		description: 'same',
		inputSchema: { properties: { limit: { type: 'number' }, site: { type: 'string' } } },
	};
	const result = diffDefinitions(before, after);
	assert.deepEqual(result.fields, ['inputSchema']);
	assert.ok(result.added > 0);
	assert.ok(text(result.lines, 'add').some((line) => line.includes('"site"')));
	assert.ok(!result.lines.some((line) => line.kind !== 'same' && line.text.includes('"description"')));
});

test('line numbers follow each side and moved text is reported as remove + add', () => {
	const lines = diffLines('a\nb\nc', 'a\nx\nc');
	assert.deepEqual(
		lines.map((l) => [l.kind, l.oldNo, l.newNo]),
		[
			['same', 1, 1],
			['del', 2, null],
			['add', null, 2],
			['same', 3, 3],
		]
	);
});

test('pure insertions and deletions at the edges are handled', () => {
	assert.deepEqual(text(diffLines('a', 'a\nb'), 'add'), ['b']);
	assert.deepEqual(text(diffLines('a\nb', 'b'), 'del'), ['a']);
	assert.deepEqual(diffLines('', '').map((l) => l.kind), ['same']);
});

test('foldUnchanged keeps context around hunks and collapses long unchanged runs', () => {
	const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
	const after = before.replace('l10', 'changed');
	const blocks = foldUnchanged(diffLines(before, after), 2);
	assert.deepEqual(
		blocks.map((b) => b.type),
		['gap', 'lines', 'gap']
	);
	const shown = blocks[1].lines.map((l) => l.text);
	assert.deepEqual(shown, ['l8', 'l9', 'l10', 'changed', 'l11', 'l12']);
	assert.equal(blocks[0].lines.length, 8);
	assert.equal(blocks[2].lines.length, 7);
});

test('a single hidden line is not worth a gap', () => {
	const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n');
	const after = ['A', 'b', 'c', 'd', 'e', 'f', 'G'].join('\n');
	// context 1 hides c,d,e (3 lines) in the middle: worth a gap.
	assert.deepEqual(foldUnchanged(diffLines(before, after), 1).map((b) => b.type), ['lines', 'gap', 'lines']);
	// context 2 would hide only d: shown inline instead, so everything is one block.
	assert.deepEqual(foldUnchanged(diffLines(before, after), 2).map((b) => b.type), ['lines']);
});

test('changedFields compares top-level fields structurally', () => {
	assert.deepEqual(changedFields({ a: 1, b: { x: 1 } }, { a: 1, b: { x: 2 }, c: 3 }), ['b', 'c']);
	assert.deepEqual(changedFields(null, { a: 1 }), ['a']);
});
