/**
 * OpenAI `POST /v1/images/generations` → Gemini `models/{model}:generateContent`。
 * 只出非流式 JSON。图片按 usageMetadata 的 TEXT / IMAGE 分项计费；没出图、客户端取消、网关超时都不扣费。
 */
import {
	applyRouteExtraHeaders,
	GEMINI_GENERATE_OPERATION,
	prepareGeminiUpstreamFetch,
	resolveGeminiAuthForUpstreamSecret,
	resolveProviderUpstreamSecret,
	resolveUpstreamEndpoint,
} from '@octafuse/core';
import { geminiImageBillingSize } from '@octafuse/core/gemini-image-native';
import {
	GeminiOpenAiImageClientError,
	buildGeminiImageBodyFromOpenAi,
	geminiImageFailureMessage,
	geminiImageResponseToOpenAi,
	geminiImageUsageFromResponse,
} from '@octafuse/core/gemini-image-openai';
import {
	applyUpstreamExtraFields,
	detachUpstreamExtraFields,
	protectedUpstreamPathsForRoute,
} from '@octafuse/core/upstream-extra-fields';
import type { RouteResult } from '../model-router';
import { EMPTY_USAGE } from '../proxy';
import type { ProxyDispatchMeta, ProxyDispatchResult } from '../failover-dispatch';
import type { RequestTimingAttempt, RequestTimingCollector } from '../request-timing';
import { extractUpstreamRequestId } from './upstream-request-id';
import { IMAGE_GENERATION_TIMEOUT_MS } from './openai-images-driver';
import { withTimeoutSignal, type GeminiImagePassthroughOptions } from './gemini-image-passthrough';

export type GeminiOpenAiImageOptions = GeminiImagePassthroughOptions;

function asObject(value: unknown): Record<string, unknown> | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function fail(
	status: number,
	message: string,
	meta: ProxyDispatchMeta,
	abort?: 'client_abort' | 'gateway_timeout',
): ProxyDispatchResult {
	const payload = { error: { message } };
	meta.parsedBody = payload;
	meta.imageCount = 0;
	meta.imageUsage = null;
	if (abort) meta.imageAbortReason = abort;
	return {
		response: new Response(JSON.stringify(payload), {
			status,
			headers: { 'Content-Type': 'application/json' },
		}),
		usagePromise: Promise.resolve(EMPTY_USAGE),
		upstreamRequestId: null,
		meta,
	};
}

function upstreamErrorMessage(payload: unknown, status: number): string {
	const message = asObject(asObject(payload)?.error)?.message;
	if (typeof message === 'string' && message.trim() !== '') return message.trim();
	return `HTTP ${status}`;
}

export async function dispatchGeminiOpenAiImage(
	route: RouteResult,
	body: Record<string, unknown>,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options: GeminiOpenAiImageOptions = {},
): Promise<ProxyDispatchResult> {
	if (route.adapter !== 'gemini-image' || route.upstreamOperation !== GEMINI_GENERATE_OPERATION) {
		throw new Error(`Unsupported Gemini image adapter: ${route.adapter}`);
	}
	const meta: ProxyDispatchMeta = { imageUsage: null, parsedBody: null, imageBillingSize: null, imageCount: null };
	let upstreamBody: Record<string, unknown>;
	let restoredUpstreamPaths: string[] = [];
	try {
		const detached = detachUpstreamExtraFields(body);
		const applied = applyUpstreamExtraFields({
			built: buildGeminiImageBodyFromOpenAi(detached.body),
			customParams: route.customParams,
			extras: detached.extras,
			protectedPaths: protectedUpstreamPathsForRoute(route),
		});
		upstreamBody = applied.body;
		restoredUpstreamPaths = applied.restoredPaths;
	} catch (error) {
		if (error instanceof GeminiOpenAiImageClientError) return fail(400, error.message, meta);
		if (error instanceof Error && error.name === 'UpstreamExtraFieldsError') return fail(400, error.message, meta);
		throw error;
	}
	meta.imageBillingSize = geminiImageBillingSize(upstreamBody);
	meta.restoredUpstreamPaths = restoredUpstreamPaths;

	const timeoutMs = options.timeoutMs ?? IMAGE_GENERATION_TIMEOUT_MS;
	const timeout = withTimeoutSignal(requestSignal, timeoutMs);
	let response: Response;
	let text: string;
	try {
		const resolvedUrl = resolveUpstreamEndpoint('gemini', GEMINI_GENERATE_OPERATION, route.providerEndpoints, {
			model: route.providerModelName,
			action: 'generateContent',
			providerId: route.providerId,
		});
		const resolved = await resolveProviderUpstreamSecret(route.providerApiKey);
		const prepared = prepareGeminiUpstreamFetch({
			resolvedUrl,
			modelName: route.providerModelName,
			action: 'generateContent',
			apiKey: resolved.secret,
			search: '',
			auth: resolveGeminiAuthForUpstreamSecret(route.providerEndpoints.gemini?.auth, resolved.isServiceAccount),
		});
		response = await (options.fetchImpl ?? fetch)(prepared.url.toString(), {
			method: 'POST',
			headers: applyRouteExtraHeaders(prepared.headers, route.customParams),
			body: JSON.stringify(upstreamBody),
			signal: timeout.signal,
		});
		timing?.markAttemptHeaders(attempt, response.status);
		text = await response.text();
	} catch (error) {
		const abort = timeout.getAbortReason();
		const clientAborted = abort === 'client_abort' || requestSignal?.aborted === true;
		if (abort === 'gateway_timeout') {
			return fail(504, `Gemini image generation timed out after ${timeoutMs}ms`, meta, 'gateway_timeout');
		}
		if (clientAborted) {
			return fail(499, 'Image generation was cancelled by the client', meta, 'client_abort');
		}
		throw error;
	} finally {
		timeout.clear();
		timing?.markStreamComplete();
	}

	const upstreamRequestId = extractUpstreamRequestId(response.headers);
	let parsed: unknown = null;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		parsed = null;
	}
	if (!response.ok) {
		const failed = fail(response.status, upstreamErrorMessage(parsed, response.status), meta);
		return { ...failed, upstreamRequestId };
	}
	const clientBody = geminiImageResponseToOpenAi(parsed);
	if (clientBody.data.length === 0) {
		const failed = fail(502, geminiImageFailureMessage(parsed), meta);
		return { ...failed, upstreamRequestId };
	}
	meta.parsedBody = clientBody;
	meta.imageCount = clientBody.data.length;
	meta.imageUsage = geminiImageUsageFromResponse(parsed);
	return {
		response: new Response(JSON.stringify(clientBody), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		}),
		usagePromise: Promise.resolve(EMPTY_USAGE),
		upstreamRequestId,
		meta,
	};
}
