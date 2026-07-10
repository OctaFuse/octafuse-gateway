import type { SimulatorGeminiAction, SimulatorProtocol } from '@/lib/simulator/endpoint';
import type { AdminKeyListItem, AdminModelRow } from '@/lib/services/admin/types';
import type { PlaygroundProtocol } from '@/lib/playground/merge-assistant-text';

export type RouteListRow = {
	id: string;
	model_id: string;
	provider_id: string;
	provider_model_name?: string | null;
	priority: number;
	status: string;
	route_group: string;
	upstream_protocol?: string | null;
	provider_name?: string | null;
};

export type ResponseMeta = {
	status: number;
	latencyMs: string | null;
	requestUrl: string | null;
	contentType: string | null;
};

export type WirePreview = {
	method: 'POST';
	url: string;
	headers: Record<string, string>;
	bodyText: string;
};

export type ResponseTab = 'merged' | 'raw';

export type SendBlockReason =
	| 'proxyBaseUrl'
	| 'model'
	| 'keyLoading'
	| 'key'
	| null;

export type { SimulatorProtocol, SimulatorGeminiAction, AdminKeyListItem, AdminModelRow, PlaygroundProtocol };
