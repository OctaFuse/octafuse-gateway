import type { PlaygroundProtocol } from '@/lib/playground/merge-assistant-text';
import type { ImageOperation, ImagePreviewItem } from '@/lib/image-generations';
import type { AdminModelRow } from '@/lib/services/admin/types';
import type { GatewayProvider } from '@/lib/types';
import type { ModelKindFilter } from '../models/types';

export type PlaygroundMode = 'routes' | 'tools';

export type ResponseTab = 'merged' | 'raw';

export type GeminiAction = 'generateContent' | 'streamGenerateContent';

export type RouteListRow = {
	id: string;
	model_id: string;
	provider_id: string;
	provider_model_name: string;
	priority: number;
	status: string;
	route_group: string;
	price_override: string | null;
	custom_params: string | null;
	upstream_protocol: string;
	upstream_operation?: string | null;
	adapter?: string | null;
	route_pool_id?: string | null;
	pool_name?: string | null;
	surfaces?: string | null;
	model_name: string | null;
	provider_name: string | null;
};

export type ResponseMeta = {
	status: number;
	latencyMs: string | null;
	upstreamUrl: string | null;
	contentType: string | null;
};

export type FilterOption = { id: string; label: string };

export type { PlaygroundProtocol, ImageOperation, ImagePreviewItem, AdminModelRow, GatewayProvider, ModelKindFilter };
