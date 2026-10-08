/**
 * 火山方舟 / BytePlus `POST {base}/images/generations`。
 * 原生透传和 OpenAI 转换适配器共用鉴权、超时和客户端取消。
 */
import { applyRouteExtraHeaders, resolveProviderUpstreamSecret, resolveUpstreamEndpoint } from '@octafuse/core';
import type { RouteResult } from '../model-router';
import type { RequestTimingAttempt, RequestTimingCollector } from '../request-timing';
import { IMAGE_GENERATION_TIMEOUT_MS } from './openai-images-driver';
import { extractUpstreamRequestId } from './upstream-request-id';

export type VolcengineImagesFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class VolcengineImagesUpstreamError extends Error {
	readonly status: number;
	readonly abortReason?: 'client_abort' | 'gateway_timeout';
	constructor(status: number, message: string, abortReason?: 'client_abort' | 'gateway_timeout') {
		super(message);
		this.name = 'VolcengineImagesUpstreamError';
		this.status = status;
		this.abortReason = abortReason;
	}
}

export async function postVolcengineImages(input: {
	route: RouteResult;
	body: Record<string, unknown>;
	requestSignal?: AbortSignal;
	timing?: RequestTimingCollector | null;
	attempt?: RequestTimingAttempt;
	fetchImpl?: VolcengineImagesFetch;
	timeoutMs?: number;
}): Promise<{ response: Response; upstreamRequestId: string | null }> {
	const fetchImpl = input.fetchImpl ?? fetch;
	const timeoutMs = input.timeoutMs ?? IMAGE_GENERATION_TIMEOUT_MS;
	const { secret } = await resolveProviderUpstreamSecret(input.route.providerApiKey);
	const url = resolveUpstreamEndpoint('volcengine', 'images.generations', input.route.providerEndpoints, {
		providerId: input.route.providerId,
	});
	const timeoutController = new AbortController();
	const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
	const onClientAbort = () => timeoutController.abort();
	input.requestSignal?.addEventListener('abort', onClientAbort, { once: true });
	try {
		const response = await fetchImpl(url, {
			method: 'POST',
			headers: applyRouteExtraHeaders(
				{
					Authorization: `Bearer ${secret}`,
					'Content-Type': 'application/json',
				},
				input.route.customParams,
			),
			body: JSON.stringify(input.body),
			signal: timeoutController.signal,
		});
		input.timing?.markAttemptHeaders(input.attempt, response.status);
		return {
			response,
			upstreamRequestId: extractUpstreamRequestId(response.headers),
		};
	} catch (error) {
		const clientAborted = input.requestSignal?.aborted === true;
		const timedOut = timeoutController.signal.aborted && !clientAborted;
		const message = timedOut
			? `Volcengine image generation timed out after ${timeoutMs}ms`
			: clientAborted
				? 'Volcengine image generation was cancelled by the client'
				: `Volcengine image generation failed: ${error instanceof Error ? error.message : String(error)}`;
		throw new VolcengineImagesUpstreamError(
			timedOut ? 504 : clientAborted ? 499 : 502,
			message,
			clientAborted ? 'client_abort' : timedOut ? 'gateway_timeout' : undefined,
		);
	} finally {
		clearTimeout(timer);
		input.requestSignal?.removeEventListener('abort', onClientAbort);
	}
}
