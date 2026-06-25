import { describe, expect, it } from 'vitest';
import {
	buildGatewayErrorAlertSummary,
	classifyGatewayErrorAlert,
	type GatewayErrorAlertContext,
} from './alert-webhook';

function baseCtx(overrides: Partial<GatewayErrorAlertContext> = {}): GatewayErrorAlertContext {
	return {
		requestLogId: '04327b16-810f-4a8b-ae95-66fe8079ce98',
		apiKeyId: '002691f8-7fd6-466f-aeef-65371a573c20',
		userEmail: 'selina.melville@gmail.com',
		modelId: 'gemini-3.1-pro-preview',
		modelName: 'Gemini 3.1 Pro Preview',
		providerId: 'e563b43c-62a8-43fb-be5b-a52888bca550',
		providerName: 'Google Vertex',
		providerModelName: 'gemini-3.1-pro-preview',
		routeGroup: 'default',
		requestProtocol: 'gemini',
		upstreamProtocol: 'gemini',
		errorMessage: 'HTTP 524: error code: 524',
		latencyMs: 125733,
		providerKeyId: '7ff25dbb-b439-40b2-84b1-ae9a2790742c',
		providerKeyLabel: 'solo0625',
		providerKeyFingerprint: '...alVg',
		...overrides,
	};
}

describe('classifyGatewayErrorAlert', () => {
	it('classifies HTTP 524 as upstream_timeout', () => {
		const meta = classifyGatewayErrorAlert(baseCtx());
		expect(meta.category).toBe('upstream_timeout');
		expect(meta.label).toBe('上游超时');
		expect(meta.priority).toBe('P1');
	});

	it('classifies stream usage timeout as upstream_timeout', () => {
		const meta = classifyGatewayErrorAlert(
			baseCtx({ errorMessage: 'Stream usage timeout (no usage within limit)', latencyMs: 5000 })
		);
		expect(meta.category).toBe('upstream_timeout');
	});

	it('classifies long latency without explicit timeout as upstream_timeout', () => {
		const meta = classifyGatewayErrorAlert(
			baseCtx({ errorMessage: 'HTTP 502: bad gateway', latencyMs: 130_000 })
		);
		expect(meta.category).toBe('upstream_timeout');
	});

	it('classifies HTTP 401/403 as provider_auth', () => {
		expect(
			classifyGatewayErrorAlert(baseCtx({ errorMessage: 'HTTP 401: invalid api key', latencyMs: 200 })).category
		).toBe('provider_auth');
		expect(
			classifyGatewayErrorAlert(baseCtx({ errorMessage: 'HTTP 403: permission denied', latencyMs: 200 })).category
		).toBe('provider_auth');
	});

	it('classifies HTTP 429 as provider_rate_limit', () => {
		const meta = classifyGatewayErrorAlert(baseCtx({ errorMessage: 'HTTP 429: rate limit exceeded', latencyMs: 200 }));
		expect(meta.category).toBe('provider_rate_limit');
	});

	it('classifies HTTP 5xx (non-524) as provider_server_error', () => {
		const meta = classifyGatewayErrorAlert(baseCtx({ errorMessage: 'HTTP 503: service unavailable', latencyMs: 800 }));
		expect(meta.category).toBe('provider_server_error');
	});

	it('classifies HTTP 400/404/422 as client_or_model_error', () => {
		expect(
			classifyGatewayErrorAlert(baseCtx({ errorMessage: 'HTTP 400: bad request', latencyMs: 100 })).category
		).toBe('client_or_model_error');
		expect(
			classifyGatewayErrorAlert(baseCtx({ errorMessage: 'HTTP 404: model not found', latencyMs: 100 })).category
		).toBe('client_or_model_error');
	});

	it('classifies route config messages as route_config_error', () => {
		const meta = classifyGatewayErrorAlert(
			baseCtx({ errorMessage: 'No routes configured', latencyMs: 10 })
		);
		expect(meta.category).toBe('route_config_error');
	});

	it('falls back to unknown_error', () => {
		const meta = classifyGatewayErrorAlert(baseCtx({ errorMessage: 'something unexpected', latencyMs: 50 }));
		expect(meta.category).toBe('unknown_error');
	});
});

describe('buildGatewayErrorAlertSummary', () => {
	it('includes structured sections and key identifiers', () => {
		const text = buildGatewayErrorAlertSummary(baseCtx());
		expect(text).toContain('[Gateway][上游超时][P1] Gemini 3.1 Pro Preview');
		expect(text).toContain('摘要: HTTP 524');
		expect(text).toContain('125.7s');
		expect(text).toContain('selina.melville@gmail.com');
		expect(text).toContain('route=default');
		expect(text).toContain('gemini → gemini');
		expect(text).toContain('solo0625 (...alVg)');
		expect(text).toContain('provider=Google Vertex');
		expect(text).toContain('建议:');
		expect(text).toContain('request_log_id=04327b16-810f-4a8b-ae95-66fe8079ce98');
		expect(text).toContain('原始错误: HTTP 524: error code: 524');
	});

	it('falls back to modelId and providerId when display names missing', () => {
		const text = buildGatewayErrorAlertSummary(
			baseCtx({ modelName: null, providerName: null })
		);
		expect(text).toContain('[Gateway][上游超时][P1] gemini-3.1-pro-preview');
		expect(text).toContain('provider=e563b43c-62a8-43fb-be5b-a52888bca550');
	});
});
