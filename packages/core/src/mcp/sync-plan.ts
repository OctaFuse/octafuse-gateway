import { exposeMcpName, exposeResourceUri, mcpDefinitionHash } from './namespace';
import { sha256Hex } from './hash';
import type { McpItemKind, McpItemStatus, McpReviewState, McpServerItemRow } from '../db/mcp-types';

export type McpCatalogEntry = {
	kind: McpItemKind;
	upstreamKey: string;
	definition: unknown;
};

export type McpSyncSummary = {
	added: string[];
	changed: string[];
	removed: string[];
	unchanged: number;
};

export type McpSyncInsert = {
	kind: McpItemKind;
	upstreamKey: string;
	upstreamKeyHash: string;
	exposedName: string;
	exposedNameHash: string;
	definition: string;
	contentHash: string;
	reviewState: McpReviewState;
	status: McpItemStatus;
};

export type McpSyncUpdate = {
	id: string;
	definition?: string;
	contentHash?: string;
	pendingDefinition?: string | null;
	pendingHash?: string | null;
	reviewState?: McpReviewState;
	status?: McpItemStatus;
};

export type McpSyncPlan = {
	inserts: McpSyncInsert[];
	updates: McpSyncUpdate[];
	summary: McpSyncSummary;
};

function itemLabel(kind: McpItemKind, upstreamKey: string): string {
	return `${kind}:${upstreamKey}`;
}

/**
 * New entries stay disabled until an admin enables them.
 * Enabled entries keep the published definition when the upstream hash changes;
 * the new definition waits in `pending_*` so clients keep seeing the reviewed text.
 */
export async function planMcpSync(input: {
	slug: string;
	existing: McpServerItemRow[];
	incoming: McpCatalogEntry[];
	usedExposedNames: ReadonlySet<string>;
}): Promise<McpSyncPlan> {
	const used = new Set(input.usedExposedNames);
	const existingByKey = new Map<string, McpServerItemRow>();
	for (const row of input.existing) {
		existingByKey.set(`${row.kind}\n${row.upstreamKey}`, row);
		used.add(row.exposedName);
	}

	const inserts: McpSyncInsert[] = [];
	const updates: McpSyncUpdate[] = [];
	const summary: McpSyncSummary = { added: [], changed: [], removed: [], unchanged: 0 };
	const seen = new Set<string>();

	for (const entry of input.incoming) {
		const key = `${entry.kind}\n${entry.upstreamKey}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		const definition = JSON.stringify(entry.definition);
		const contentHash = await mcpDefinitionHash(entry.definition);
		const current = existingByKey.get(key);
		if (!current) {
			const exposedName =
				entry.kind === 'resource'
					? exposeResourceUri(input.slug, entry.upstreamKey)
					: await exposeMcpName(input.slug, entry.upstreamKey, used);
			used.add(exposedName);
			inserts.push({
				kind: entry.kind,
				upstreamKey: entry.upstreamKey,
				upstreamKeyHash: await sha256Hex(`${entry.kind}\n${entry.upstreamKey}`),
				exposedName,
				exposedNameHash: await sha256Hex(exposedName),
				definition,
				contentHash,
				reviewState: 'new',
				status: 'disabled',
			});
			summary.added.push(itemLabel(entry.kind, entry.upstreamKey));
			continue;
		}

		if (current.status === 'removed') {
			updates.push({
				id: current.id,
				definition,
				contentHash,
				pendingDefinition: null,
				pendingHash: null,
				reviewState: 'new',
				status: 'disabled',
			});
			summary.added.push(itemLabel(entry.kind, entry.upstreamKey));
			continue;
		}

		if (current.contentHash === contentHash && !current.pendingHash) {
			summary.unchanged += 1;
			continue;
		}
		if (current.contentHash === contentHash && current.pendingHash && current.pendingHash !== contentHash) {
			// Upstream reverted to the published definition.
			updates.push({
				id: current.id,
				pendingDefinition: null,
				pendingHash: null,
				reviewState: current.status === 'disabled' && current.reviewState === 'new' ? 'new' : 'none',
			});
			summary.unchanged += 1;
			continue;
		}
		if (current.pendingHash === contentHash) {
			summary.unchanged += 1;
			continue;
		}

		if (current.status === 'enabled') {
			updates.push({
				id: current.id,
				pendingDefinition: definition,
				pendingHash: contentHash,
				reviewState: 'changed',
			});
			summary.changed.push(itemLabel(entry.kind, entry.upstreamKey));
			continue;
		}

		updates.push({
			id: current.id,
			definition,
			contentHash,
			pendingDefinition: null,
			pendingHash: null,
			reviewState: current.reviewState === 'new' ? 'new' : 'none',
		});
		summary.changed.push(itemLabel(entry.kind, entry.upstreamKey));
	}

	for (const row of input.existing) {
		const key = `${row.kind}\n${row.upstreamKey}`;
		if (seen.has(key) || row.status === 'removed') {
			continue;
		}
		updates.push({
			id: row.id,
			status: 'removed',
			pendingDefinition: null,
			pendingHash: null,
			reviewState: 'none',
		});
		summary.removed.push(itemLabel(row.kind, row.upstreamKey));
	}

	return { inserts, updates, summary };
}
