import {
	canonicalizeRequestOperation,
	isRequestOperationForProtocol,
	isUpstreamOperationForProtocol,
	isRouteAdapterCompatible,
	normalizeRouteCustomParamsForStorage,
	validateRouteCustomParamsHeaders,
} from '@octafuse/core';
import { normalizeUpstreamProtocol } from '@octafuse/core/upstream-protocol';
import type { PlaygroundRouteDraft } from '@/lib/playground/route-draft';
import { badRequest } from './errors';
import { normalizeJsonObjectField } from './shared';

export function parsePlaygroundRouteDraft(value: unknown): PlaygroundRouteDraft {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw badRequest('routeDraft must be a JSON object');
	}
	const input = value as Record<string, unknown>;
	function required(field: string): string {
		const value = input[field];
		if (typeof value !== 'string' || !value.trim()) throw badRequest(`routeDraft.${field} is required`);
		return value.trim();
	}
	const modelId = required('model_id');
	const providerId = required('provider_id');
	const providerModelName = required('provider_model_name');
	let requestProtocol;
	let upstreamProtocol;
	try {
		requestProtocol = normalizeUpstreamProtocol(required('request_protocol'));
		upstreamProtocol = normalizeUpstreamProtocol(required('upstream_protocol'));
	} catch (error) {
		throw badRequest(error instanceof Error ? error.message : 'Invalid route protocol');
	}
	const requestOperation = canonicalizeRequestOperation(requestProtocol, required('request_operation'));
	const upstreamOperation = canonicalizeRequestOperation(upstreamProtocol, required('upstream_operation'));
	const adapter = required('adapter');
	if (
		!isRequestOperationForProtocol(requestProtocol, requestOperation) ||
		!isUpstreamOperationForProtocol(upstreamProtocol, upstreamOperation) ||
		!isRouteAdapterCompatible({
			adapter,
			requestProtocol,
			requestOperation,
			upstreamProtocol,
			upstreamOperation,
		})
	) {
		throw badRequest('Invalid route protocol, operation, or adapter combination');
	}
	const normalized = normalizeJsonObjectField(input.custom_params, 'custom_params');
	if (!normalized.ok) throw badRequest(normalized.message);
	let customParams: string | null = null;
	if (normalized.value) {
		const params = JSON.parse(normalized.value) as Record<string, unknown>;
		const validation = validateRouteCustomParamsHeaders(params);
		if (!validation.ok) throw badRequest(validation.message);
		const envelope = normalizeRouteCustomParamsForStorage(params);
		customParams = envelope ? JSON.stringify(envelope) : null;
	}
	return {
		model_id: modelId,
		provider_id: providerId,
		provider_model_name: providerModelName,
		request_protocol: requestProtocol,
		request_operation: requestOperation,
		upstream_protocol: upstreamProtocol,
		upstream_operation: upstreamOperation,
		adapter,
		custom_params: customParams,
	};
}
