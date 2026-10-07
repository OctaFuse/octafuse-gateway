/**
 * OpenAI `POST /v1/images/generations` → 火山方舟 / BytePlus 生图。
 * 只出非流式 JSON。流式走 `/v1/volcengine/images/generations` 透传。
 */
import {
	applyUpstreamExtraFields,
	detachUpstreamExtraFields,
	protectedUpstreamPathsForRoute,
	type ApplyUpstreamExtraFieldsResult,
} from '@octafuse/core/upstream-extra-fields';
import {
	VolcengineOpenAiClientError,
	buildVolcengineImageBodyFromOpenAi,
	firstVolcengineImageFailureMessage,
	volcengineImageResponseToOpenAi,
} from '@octafuse/core/volcengine-openai';
import { volcengineImageBillingSize } from '@octafuse/core/volcengine-native';
import type { RouteResult } from '../model-router';
import { EMPTY_USAGE } from '../proxy';
import type { ProxyDispatchMeta, ProxyDispatchResult } from '../failover-dispatch';
import type { RequestTimingAttempt, RequestTimingCollector } from '../request-timing';
import { postVolcengineImages, VolcengineImagesUpstreamError, type VolcengineImagesFetch } from './volcengine-images-post';

export type VolcengineOpenAiImageOptions = {
	fetchImpl?: VolcengineImagesFetch;
	timeoutMs?: number;
};

function asObject(value: unknown): Record<string, unknown> | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function jsonResponse(status: number, payload: unknown): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function fail(
	status: number,
	message: string,
	meta: ProxyDispatchMeta,
	abort?: ProxyDispatchMeta['imageAbortReason'],
): ProxyDispatchResult {
	const payload = { error: { message } };
	meta.parsedBody = payload;
	meta.imageCount = 0;
	if (abort) meta.imageAbortReason = abort;
	return {
		response: jsonResponse(status, payload),
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

export async function dispatchVolcengineOpenAiImage(
	route: RouteResult,
	body: Record<string, unknown>,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options: VolcengineOpenAiImageOptions = {},
): Promise<ProxyDispatchResult> {
	if (route.adapter !== 'volcengine-image' || route.upstreamOperation !== 'images.generations') {
		throw new Error(`Unsupported Volcengine image adapter: ${route.adapter}`);
	}
	const meta: ProxyDispatchMeta = { imageUsage: null, parsedBody: null, imageBillingSize: null, imageCount: null };
	let upstreamBody: Record<string, unknown>;
	let restoredUpstreamPaths: string[] = [];
	try {
		const detached = detachUpstreamExtraFields(body);
		const built = buildVolcengineImageBodyFromOpenAi(route.providerModelName, detached.body);
		const applied: ApplyUpstreamExtraFieldsResult = applyUpstreamExtraFields({
			built,
			customParams: route.customParams,
			extras: detached.extras,
			protectedPaths: protectedUpstreamPathsForRoute(route),
		});
		upstreamBody = applied.body;
		upstreamBody.model = route.providerModelName;
		restoredUpstreamPaths = applied.restoredPaths;
	} catch (error) {
		if (error instanceof VolcengineOpenAiClientError) return fail(400, error.message, meta);
		if (error instanceof Error && error.name === 'UpstreamExtraFieldsError') return fail(400, error.message, meta);
		throw error;
	}

	let posted: Awaited<ReturnType<typeof postVolcengineImages>>;
	try {
		posted = await postVolcengineImages({
			route,
			body: upstreamBody,
			requestSignal,
			timing,
			attempt,
			fetchImpl: options.fetchImpl,
			timeoutMs: options.timeoutMs,
		});
	} catch (error) {
		if (error instanceof VolcengineImagesUpstreamError) {
			return fail(error.status, error.message, meta, error.abortReason);
		}
		throw error;
	}

	const text = await posted.response.text();
	timing?.markStreamComplete();
	let parsed: unknown = null;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		parsed = null;
	}
	if (!posted.response.ok) {
		const failed = fail(posted.response.status, upstreamErrorMessage(parsed, posted.response.status), meta);
		return { ...failed, upstreamRequestId: posted.upstreamRequestId };
	}
	const clientBody = volcengineImageResponseToOpenAi(parsed);
	if (clientBody.data.length === 0) {
		const failed = fail(
			502,
			firstVolcengineImageFailureMessage(parsed) ?? 'Volcengine image generation returned no image',
			meta,
		);
		return { ...failed, upstreamRequestId: posted.upstreamRequestId };
	}
	meta.parsedBody = clientBody;
	meta.imageCount = clientBody.data.length;
	meta.imageBillingSize = volcengineImageBillingSize(upstreamBody.size);
	meta.restoredUpstreamPaths = restoredUpstreamPaths;
	return {
		response: jsonResponse(200, clientBody),
		usagePromise: Promise.resolve(EMPTY_USAGE),
		upstreamRequestId: posted.upstreamRequestId,
		meta,
	};
}
