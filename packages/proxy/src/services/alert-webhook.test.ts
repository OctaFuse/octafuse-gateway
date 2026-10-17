import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
		occurredAt: '2026-03-16T12:13:21.580Z',
		...overrides,
	};
}

describe('classifyGatewayErrorAlert', () => {
	it('classifies HTTP 524 as upstream_timeout', () => {
		const meta = classifyGatewayErrorAlert(baseCtx());
		assert.equal(meta.category, 'upstream_timeout');
		assert.equal(meta.label, '上游超时');
		assert.equal(meta.priority, 'P1');
	});

	it('classifies stream usage timeout as upstream_timeout', () => {
		const meta = classifyGatewayErrorAlert(
			baseCtx({ errorMessage: 'Stream usage timeout (no usage within limit)', latencyMs: 5000 })
		);
		assert.equal(meta.category, 'upstream_timeout');
	});

	it('classifies long latency without explicit timeout as upstream_timeout', () => {
		const meta = classifyGatewayErrorAlert(
			baseCtx({ errorMessage: 'HTTP 502: bad gateway', latencyMs: 130_000 })
		);
		assert.equal(meta.category, 'upstream_timeout');
	});

	it('classifies HTTP 401/403 as provider_auth', () => {
		assert.equal(
			classifyGatewayErrorAlert(baseCtx({ errorMessage: 'HTTP 401: invalid api key', latencyMs: 200 })).category
		, 'provider_auth');
		assert.equal(
			classifyGatewayErrorAlert(baseCtx({ errorMessage: 'HTTP 403: permission denied', latencyMs: 200 })).category
		, 'provider_auth');
	});

	it('classifies HTTP 429 as provider_rate_limit', () => {
		const meta = classifyGatewayErrorAlert(baseCtx({ errorMessage: 'HTTP 429: rate limit exceeded', latencyMs: 200 }));
		assert.equal(meta.category, 'provider_rate_limit');
	});

	it('classifies HTTP 5xx (non-524) as provider_server_error', () => {
		const meta = classifyGatewayErrorAlert(baseCtx({ errorMessage: 'HTTP 503: service unavailable', latencyMs: 800 }));
		assert.equal(meta.category, 'provider_server_error');
	});

	it('classifies HTTP 400 safety blocks as sensitive_content', () => {
		assert.equal(
			classifyGatewayErrorAlert(
				baseCtx({
					errorMessage:
						'HTTP 400: System detected potentially unsafe or sensitive content in input or generation. Please avoid using prompts that may generate sensitive content. Thank you for your cooperation.',
					latencyMs: 200,
				})
			).category
		, 'sensitive_content');
		assert.equal(
			classifyGatewayErrorAlert(
				baseCtx({
					errorMessage:
						'HTTP 400: <400> InternalError.Algo.DataInspectionFailed: Input text data may contain inappropriate content.',
					latencyMs: 200,
				})
			).category
		, 'sensitive_content');
		assert.equal(
			classifyGatewayErrorAlert(
				baseCtx({
					errorMessage:
						'HTTP 400: 系统检测到输入或生成内容可能包含不安全或敏感内容，请您避免输入易产生敏感内容的提示词。',
					latencyMs: 200,
				})
			).category
		, 'sensitive_content');
	});

	it('classifies non-HTTP sensitive signals as sensitive_content', () => {
		assert.equal(
			classifyGatewayErrorAlert(
				baseCtx({ errorMessage: 'Blocked by safety filter', latencyMs: 200 })
			).category
		, 'sensitive_content');
	});

	it('classifies HTTP 400/404/422 as client_or_model_error', () => {
		assert.equal(
			classifyGatewayErrorAlert(baseCtx({ errorMessage: 'HTTP 400: bad request', latencyMs: 100 })).category
		, 'client_or_model_error');
		assert.equal(
			classifyGatewayErrorAlert(baseCtx({ errorMessage: 'HTTP 404: model not found', latencyMs: 100 })).category
		, 'client_or_model_error');
	});

	it('classifies route config messages as route_config_error', () => {
		assert.equal(
			classifyGatewayErrorAlert(baseCtx({ errorMessage: 'No routes configured', latencyMs: 10 })).category
		, 'route_config_error');
		assert.equal(
			classifyGatewayErrorAlert(baseCtx({ errorMessage: 'No available route', latencyMs: 10 })).category
		, 'route_config_error');
		assert.equal(
			classifyGatewayErrorAlert(baseCtx({ errorMessage: 'HTTP 404: No available route', latencyMs: 10 })).category
		, 'route_config_error');
	});

	it('falls back to unknown_error', () => {
		const meta = classifyGatewayErrorAlert(baseCtx({ errorMessage: 'something unexpected', latencyMs: 50 }));
		assert.equal(meta.category, 'unknown_error');
	});
});

describe('buildGatewayErrorAlertSummary', () => {
	it('includes structured sections and key identifiers', () => {
		const text = buildGatewayErrorAlertSummary(baseCtx());
		assert.ok(text.includes('[Gateway] - [上游超时] - [P1]'));
		assert.ok(text.includes('模型: Gemini 3.1 Pro Preview'));
		assert.ok(text.includes('摘要: HTTP 524'));
		assert.ok(text.includes('125.7s'));
		assert.ok(text.includes('selina.melville@gmail.com'));
		assert.ok(text.includes('route=default'));
		assert.ok(text.includes('gemini → gemini'));
		assert.ok(text.includes('供应商: Google Vertex · gemini-3.1-pro-preview · default (...alVg) · '));
		assert.ok(text.includes('建议:'));
		assert.ok(!text.includes('定位:'));
		assert.ok(!text.includes('request_log_id='));
		assert.ok(text.includes('原始错误: HTTP 524: error code: 524'));
		assert.ok(text.includes('发生时间: 2026/03/16 20:13:21 (UTC+8)'));

		const originalIdx = text.indexOf('原始错误:');
		const suggestionIdx = text.indexOf('建议:');
		const occurredIdx = text.indexOf('发生时间:');
		assert.ok(originalIdx < suggestionIdx);
		assert.ok(suggestionIdx < occurredIdx);
	});

	it('falls back to modelId and providerId when display names missing', () => {
		const text = buildGatewayErrorAlertSummary(
			baseCtx({ modelName: null, providerName: null })
		);
		assert.ok(text.includes('[Gateway] - [上游超时] - [P1]'));
		assert.ok(text.includes('模型: gemini-3.1-pro-preview'));
		assert.ok(text.includes(
			'供应商: e563b43c-62a8-43fb-be5b-a52888bca550 · gemini-3.1-pro-preview · default (...alVg) · '
		));
	});

	it('formats client_or_model_error alert like production example', () => {
		const text = buildGatewayErrorAlertSummary(
			baseCtx({
				modelId: 'glm-5.2',
				modelName: 'GLM-5.2',
				userEmail: '453991510@qq.com',
				providerName: 'ZAI Coding Plan - Lite',
				providerModelName: 'glm-5.2',
				requestProtocol: 'openai',
				upstreamProtocol: 'openai',
				errorMessage:
					'HTTP 400: System detected potentially unsafe or sensitive content in input or generation. Please avoid using prompts that may generate sensitive content. Thank you for your cooperation.',
				latencyMs: 5600,
				providerKeyLabel: 'default',
				providerKeyFingerprint: '…kGxz',
			})
		);
		assert.ok(text.includes('[Gateway] - [敏感内容拦截] - [P3]'));
		assert.ok(text.includes('模型: GLM-5.2'));
		assert.ok(text.includes('摘要: HTTP 400，耗时 5.6s，上游内容安全策略拦截'));
		assert.ok(text.includes('影响: 453991510@qq.com · route=default · openai → openai'));
		assert.ok(text.includes('供应商: ZAI Coding Plan - Lite · glm-5.2 · default (…kGxz) · '));
	});

	it('includes circuit measures when circuit events are present', () => {
		const text = buildGatewayErrorAlertSummary(
			baseCtx({
				errorMessage: 'HTTP 429: rate limit exceeded',
				latencyMs: 200,
				circuitEvents: [
					{
						kind: 'provider',
						providerId: 'key-1',
						providerName: 'solo0625',
						keyFingerprint: '...alVg',
						failureKind: 'rate_limit',
						openUntil: Date.parse('2026-03-16T12:35:00.000Z'),
						cooldownMs: 60_000,
						openedOrExtended: true,
					},
				],
			})
		);
		assert.ok(text.includes('熔断措施:'));
		assert.ok(text.includes(
			'provider providerId=key-1 name=solo0625 fingerprint=...alVg reason=rate_limit'
		));
		assert.ok(text.includes('持续 60s'));
		assert.ok(text.includes('恢复时间'));
	});

	it('includes user_model circuit measures for sensitive content breaker', () => {
		const text = buildGatewayErrorAlertSummary(
			baseCtx({
				errorMessage: 'HTTP 400: sensitive content blocked',
				latencyMs: 200,
				circuitEvents: [
					{
						kind: 'user_model',
						userId: 'user-1',
						modelId: 'glm-5.2',
						reason: 'sensitive_content',
						openUntil: Date.parse('2026-03-16T12:35:00.000Z'),
						cooldownMs: 180_000,
					},
				],
			})
		);
		assert.ok(text.includes('user_model user=user-1 model=glm-5.2 reason=敏感内容'));
		assert.ok(text.includes('持续 180s'));
	});
});
