/**
 * 双层 failover：外层 provider 优先级，内层 key pool。
 */
import type { GatewayRepositories, UpstreamProtocol } from '@octafuse/core';
import { fingerprintProviderApiKey } from '@octafuse/core';
import type { ActiveProviderApiKeyRow } from '@octafuse/core';
import type { RouteResult } from './model-router';
import type { UsageFromStream } from './proxy';
import { EMPTY_USAGE } from './proxy';
import { markProviderKeyCooldown, selectProviderKeysForAttempt } from './provider-key-scheduler';
import {
	classifyUpstreamHttpFailure,
	type UpstreamFailureClassification,
} from './upstream-failure-classifier';

export type ProxyDispatchResult = {
	response: Response;
	usagePromise: Promise<UsageFromStream>;
};

export type ProxyFailoverResult = {
	response: Response;
	usagePromise: Promise<UsageFromStream>;
	chosenRoute: RouteResult;
};

type DispatchFn = (route: RouteResult, requestSignal?: AbortSignal) => Promise<ProxyDispatchResult>;

function emptyRoute(protocol: UpstreamProtocol): RouteResult {
	return {
		providerId: '',
		providerName: '',
		providerModelName: '',
		upstreamProtocol: protocol,
		baseUrl: '',
		providerApiKey: '',
		priceOverrideRaw: null,
		routeMeteredProfileJson: null,
		routeChargedProfileJson: null,
		customParams: null,
		routeGroup: 'default',
		providerKeyId: null,
		providerKeyLabel: null,
		providerKeyFingerprint: null,
	};
}

function routeWithKey(base: RouteResult, key: ActiveProviderApiKeyRow): RouteResult {
	return {
		...base,
		providerApiKey: key.api_key,
		providerKeyId: key.id,
		providerKeyLabel: key.label,
		providerKeyFingerprint: fingerprintProviderApiKey(key.api_key),
	};
}

async function loadKeysForProvider(
	repos: GatewayRepositories,
	providerId: string
): Promise<ActiveProviderApiKeyRow[]> {
	return repos.providerKeys.getActiveProviderKeys(providerId);
}

function logKeySwitchAlert(route: RouteResult, classification: UpstreamFailureClassification, status?: number): void {
	if (!classification.alertOnKeySwitch) return;
	console.warn(
		`[Gateway Proxy] provider key auth issue, trying next key providerId=${route.providerId} keyId=${route.providerKeyId} status=${status ?? 'fetch_error'}`
	);
}

/**
 * 按 provider 优先级 + key pool 调度上游请求。
 */
export async function failoverDispatchWithKeyPool(
	repos: GatewayRepositories,
	routes: RouteResult[],
	expectedProtocol: UpstreamProtocol,
	dispatch: DispatchFn,
	requestSignal?: AbortSignal
): Promise<ProxyFailoverResult> {
	if (routes.length === 0) {
		return {
			response: new Response(JSON.stringify({ error: 'No routes configured' }), {
				status: 502,
				headers: { 'Content-Type': 'application/json' },
			}),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			chosenRoute: emptyRoute(expectedProtocol),
		};
	}

	let lastResponse: Response | null = null;
	let lastRoute: RouteResult = routes[0]!;

	for (const route of routes) {
		if (route.upstreamProtocol !== expectedProtocol) {
			console.warn(
				`[Gateway Proxy] unsupported protocol, skipping providerId=${route.providerId} protocol=${route.upstreamProtocol}`
			);
			continue;
		}

		const keys = selectProviderKeysForAttempt(await loadKeysForProvider(repos, route.providerId));
		if (keys.length === 0) {
			console.warn(`[Gateway Proxy] no active keys for providerId=${route.providerId}`);
			continue;
		}

		for (const key of keys) {
			const attemptRoute = routeWithKey(route, key);
			console.log(
				`[Gateway Proxy] calling provider providerId=${route.providerId} keyId=${key.id} model=${route.providerModelName}`
			);

			let response: Response;
			let usagePromise: Promise<UsageFromStream>;
			try {
				const dispatched = await dispatch(attemptRoute, requestSignal);
				response = dispatched.response;
				usagePromise = dispatched.usagePromise;
			} catch (err) {
				console.warn(
					`[Gateway Proxy] fetch failed providerId=${route.providerId} keyId=${key.id} error=${err instanceof Error ? err.message : String(err)}`
				);
				markProviderKeyCooldown(key.id);
				lastResponse = new Response(JSON.stringify({ error: 'Upstream request failed' }), {
					status: 502,
					headers: { 'Content-Type': 'application/json' },
				});
				lastRoute = attemptRoute;
				continue;
			}

			lastResponse = response;
			lastRoute = attemptRoute;

			if (response.ok) {
				return { response, usagePromise, chosenRoute: attemptRoute };
			}

			const classification = classifyUpstreamHttpFailure(response.status);
			logKeySwitchAlert(attemptRoute, classification, response.status);

			if (classification.action === 'fail_immediately') {
				return {
					response,
					usagePromise: Promise.resolve(EMPTY_USAGE),
					chosenRoute: attemptRoute,
				};
			}

			markProviderKeyCooldown(key.id);
			console.warn(
				`[Gateway Proxy] provider key non-OK, trying next key providerId=${route.providerId} keyId=${key.id} status=${response.status}`
			);
		}

		console.warn(
			`[Gateway Proxy] all keys failed for providerId=${route.providerId}, trying next provider`
		);
	}

	if (!lastResponse) {
		return {
			response: new Response(JSON.stringify({ error: 'No supported upstream protocol route available' }), {
				status: 502,
				headers: { 'Content-Type': 'application/json' },
			}),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			chosenRoute: lastRoute,
		};
	}

	return {
		response: lastResponse,
		usagePromise: Promise.resolve(EMPTY_USAGE),
		chosenRoute: lastRoute,
	};
}
