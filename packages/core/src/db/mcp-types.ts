export type McpServerStatus = 'active' | 'disabled';
export type McpItemKind = 'tool' | 'prompt' | 'resource';
export type McpItemStatus = 'enabled' | 'disabled' | 'removed';
export type McpReviewState = 'none' | 'new' | 'changed';

export type McpServerRow = {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	url: string;
	authHeaders: string;
	status: McpServerStatus;
	metered: number;
	standard: number;
	charged: number;
	timeoutMs: number;
	maxResponseBytes: number;
	serverInfo: string | null;
	lastSyncedAt: string | null;
	lastSyncError: string | null;
	lastSyncSummary: string | null;
	createdAt: string;
	updatedAt: string;
};

export type McpServerListRow = McpServerRow & {
	enabledCount: number;
	pendingCount: number;
};

export type McpServerItemRow = {
	id: string;
	serverId: string;
	kind: McpItemKind;
	upstreamKey: string;
	upstreamKeyHash: string;
	exposedName: string;
	exposedNameHash: string;
	definition: string;
	contentHash: string;
	pendingDefinition: string | null;
	pendingHash: string | null;
	reviewState: McpReviewState;
	status: McpItemStatus;
	metered: number | null;
	standard: number | null;
	charged: number | null;
	syncedAt: string;
};

/** Enabled or disabled item joined to an active server, for listing and calls. */
export type McpCallableItem = McpServerItemRow & {
	slug: string;
	serverStatus: McpServerStatus;
	url: string;
	authHeaders: string;
	timeoutMs: number;
	maxResponseBytes: number;
	defaultMetered: number;
	defaultStandard: number;
	defaultCharged: number;
};

export type McpToolPriceRow = {
	slug: string;
	upstreamKey: string;
	exposedName: string;
	metered: number;
	standard: number;
	charged: number;
};

export type InsertMcpServerParams = {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	url: string;
	authHeaders: string;
	status?: McpServerStatus;
	metered: number;
	standard: number;
	charged: number;
	timeoutMs: number;
	maxResponseBytes: number;
};

export type UpdateMcpServerParams = {
	name?: string;
	description?: string | null;
	url?: string;
	authHeaders?: string;
	status?: McpServerStatus;
	metered?: number;
	standard?: number;
	charged?: number;
	timeoutMs?: number;
	maxResponseBytes?: number;
	serverInfo?: string | null;
	lastSyncedAt?: string | null;
	lastSyncError?: string | null;
	lastSyncSummary?: string | null;
};

export type InsertMcpItemParams = {
	id: string;
	serverId: string;
	kind: McpItemKind;
	upstreamKey: string;
	upstreamKeyHash: string;
	exposedName: string;
	exposedNameHash: string;
	definition: string;
	contentHash: string;
	reviewState: McpReviewState;
	status: McpItemStatus;
	syncedAt: string;
};

export type UpdateMcpItemParams = {
	definition?: string;
	contentHash?: string;
	pendingDefinition?: string | null;
	pendingHash?: string | null;
	reviewState?: McpReviewState;
	status?: McpItemStatus;
	metered?: number | null;
	standard?: number | null;
	charged?: number | null;
	syncedAt?: string;
};
