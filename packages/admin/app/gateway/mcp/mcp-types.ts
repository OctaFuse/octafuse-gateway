import type { McpPricingRule } from '@octafuse/core';
import { DEFAULT_PRICING_DRAFT, type PricingDraft } from './mcp-pricing-draft';

export type ServerSummary = {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	status: 'active' | 'disabled';
	urlMasked: string;
	authHeaderNames: string[];
	/** null when the stored rule is invalid; tool calls are refused until it is saved again. */
	pricing: McpPricingRule | null;
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
	/** Tool rule override; null inherits the server default. */
	pricing: McpPricingRule | null;
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
	pricing: PricingDraft;
	timeoutMs: string;
	maxResponseBytes: string;
};

export const EMPTY_FORM: ServerForm = {
	slug: '',
	name: '',
	description: '',
	url: '',
	headers: [{ key: '', value: '' }],
	pricing: DEFAULT_PRICING_DRAFT,
	timeoutMs: '30000',
	maxResponseBytes: '1048576',
};
