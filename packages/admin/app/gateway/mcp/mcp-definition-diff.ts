/**
 * Line diff for MCP catalog definitions (tool / prompt / resource JSON), used by the review dialog.
 * Keys are sorted before printing so an upstream that merely reorders keys does not look like a change.
 */

export type DiffLineKind = 'same' | 'add' | 'del';

export interface DiffLine {
	kind: DiffLineKind;
	text: string;
	/** 1-based line number in the current definition; null for added lines. */
	oldNo: number | null;
	/** 1-based line number in the pending definition; null for removed lines. */
	newNo: number | null;
}

export type DiffBlock =
	| { type: 'lines'; lines: DiffLine[] }
	/** Unchanged lines hidden by default; `lines` keeps them so the UI can expand. */
	| { type: 'gap'; lines: DiffLine[] };

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([key, item]) => [key, sortKeys(item)])
		);
	}
	return value;
}

export function stableStringify(value: unknown): string {
	return JSON.stringify(sortKeys(value ?? null), null, 2);
}

/** Above this many cells the middle section falls back to "all removed, then all added". */
const MAX_LCS_CELLS = 4_000_000;

export function diffLines(before: string, after: string): DiffLine[] {
	const a = before.split('\n');
	const b = after.split('\n');
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA -= 1;
		endB -= 1;
	}

	const lines: DiffLine[] = [];
	let oldNo = 1;
	let newNo = 1;
	const push = (kind: DiffLineKind, text: string) => {
		lines.push({
			kind,
			text,
			oldNo: kind === 'add' ? null : oldNo,
			newNo: kind === 'del' ? null : newNo,
		});
		if (kind !== 'add') oldNo += 1;
		if (kind !== 'del') newNo += 1;
	};

	for (let i = 0; i < start; i += 1) push('same', a[i]);

	const midA = a.slice(start, endA);
	const midB = b.slice(start, endB);
	if (midA.length * midB.length > MAX_LCS_CELLS) {
		for (const text of midA) push('del', text);
		for (const text of midB) push('add', text);
	} else if (midA.length || midB.length) {
		// Classic LCS table over the differing middle only.
		const rows = midA.length + 1;
		const cols = midB.length + 1;
		const table = new Uint32Array(rows * cols);
		for (let i = midA.length - 1; i >= 0; i -= 1) {
			for (let j = midB.length - 1; j >= 0; j -= 1) {
				table[i * cols + j] =
					midA[i] === midB[j]
						? table[(i + 1) * cols + j + 1] + 1
						: Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
			}
		}
		let i = 0;
		let j = 0;
		while (i < midA.length && j < midB.length) {
			if (midA[i] === midB[j]) {
				push('same', midA[i]);
				i += 1;
				j += 1;
			} else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
				push('del', midA[i]);
				i += 1;
			} else {
				push('add', midB[j]);
				j += 1;
			}
		}
		while (i < midA.length) push('del', midA[i++]);
		while (j < midB.length) push('add', midB[j++]);
	}

	for (let i = endA; i < a.length; i += 1) push('same', a[i]);
	return lines;
}

export function diffStats(lines: readonly DiffLine[]) {
	let added = 0;
	let removed = 0;
	for (const line of lines) {
		if (line.kind === 'add') added += 1;
		else if (line.kind === 'del') removed += 1;
	}
	return { added, removed };
}

/**
 * Groups lines into changed hunks (with `context` unchanged lines around them) and collapsed gaps.
 * A gap shorter than two lines is not worth hiding, so it stays visible.
 */
export function foldUnchanged(lines: readonly DiffLine[], context = 2): DiffBlock[] {
	const keep = new Array<boolean>(lines.length).fill(false);
	lines.forEach((line, index) => {
		if (line.kind === 'same') return;
		for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k += 1) {
			keep[k] = true;
		}
	});

	const blocks: DiffBlock[] = [];
	let current: DiffLine[] = [];
	let hidden: DiffLine[] = [];
	const flushHidden = () => {
		if (!hidden.length) return;
		if (hidden.length < 2) {
			current.push(...hidden);
		} else {
			if (current.length) blocks.push({ type: 'lines', lines: current });
			current = [];
			blocks.push({ type: 'gap', lines: hidden });
		}
		hidden = [];
	};
	lines.forEach((line, index) => {
		if (keep[index]) {
			flushHidden();
			current.push(line);
		} else {
			hidden.push(line);
		}
	});
	flushHidden();
	if (current.length) blocks.push({ type: 'lines', lines: current });
	return blocks;
}

/** Top-level fields whose value differs, e.g. `["description", "inputSchema"]`. */
export function changedFields(before: unknown, after: unknown): string[] {
	const left = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>;
	const right = (after && typeof after === 'object' ? after : {}) as Record<string, unknown>;
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
	return [...keys]
		.filter((key) => stableStringify(left[key]) !== stableStringify(right[key]))
		.sort();
}

export function diffDefinitions(before: unknown, after: unknown) {
	const lines = diffLines(stableStringify(before), stableStringify(after));
	return { lines, ...diffStats(lines), fields: changedFields(before, after) };
}
