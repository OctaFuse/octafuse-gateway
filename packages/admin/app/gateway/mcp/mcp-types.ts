export type ServerSummary = {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	status: 'active' | 'disabled';
	urlMasked: string;
	authHeaderNames: string[];
	metered: number;
	standard: number;
	charged: number;
	timeoutMs: number;
	maxResponseBytes: number;
	lastSyncedAt: string | null;
	lastSyncError: string | null;
	enabledCount: number;
	pendingCount: number;
};

export type CatalogItem = {
	id: string;
	kind: 'tool' | 'prompt' | 'resource';
	upstreamKey: string;
	exposedName: string;
	definition: { description?: string; title?: string };
	pendingDefinition: { description?: string } | null;
	reviewState: 'none' | 'new' | 'changed';
	status: 'enabled' | 'disabled' | 'removed';
	metered: number | null;
	standard: number | null;
	charged: number | null;
};

export type ServerDetail = {
	server: ServerSummary;
	items: CatalogItem[];
};

export type HeaderDraft = { key: string; value: string };

export type ServerForm = {
	slug: string;
	name: string;
	description: string;
	url: string;
	headers: HeaderDraft[];
	metered: string;
	standard: string;
	charged: string;
	timeoutMs: string;
	maxResponseBytes: string;
};

export const EMPTY_FORM: ServerForm = {
	slug: '',
	name: '',
	description: '',
	url: '',
	headers: [{ key: '', value: '' }],
	metered: '0',
	standard: '0',
	charged: '0',
	timeoutMs: '30000',
	maxResponseBytes: '1048576',
};
