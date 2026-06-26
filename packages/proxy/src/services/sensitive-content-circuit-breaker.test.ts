import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	buildSensitiveContentCircuitOpenResponse,
	getSensitiveContentCircuitOpen,
	isSensitiveUpstreamResponse,
	recordSensitiveContentCircuitTrigger,
	resetSensitiveContentCircuitStateForTests,
	SENSITIVE_CONTENT_CIRCUIT_BREAKER_MS,
} from './sensitive-content-circuit-breaker';

describe('sensitive-content-circuit-breaker', () => {
	afterEach(() => {
		resetSensitiveContentCircuitStateForTests();
		vi.useRealTimers();
	});

	it('opens circuit for user+model and blocks until expiry', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-27T03:00:00.000Z'));

		recordSensitiveContentCircuitTrigger('user-1', 'glm-5.2', 'HTTP 400: sensitive content');
		const open = getSensitiveContentCircuitOpen('user-1', 'glm-5.2');
		expect(open).not.toBeNull();
		expect(open!.retryAfterSeconds).toBe(180);

		vi.advanceTimersByTime(SENSITIVE_CONTENT_CIRCUIT_BREAKER_MS - 1);
		expect(getSensitiveContentCircuitOpen('user-1', 'glm-5.2')).not.toBeNull();

		vi.advanceTimersByTime(1);
		expect(getSensitiveContentCircuitOpen('user-1', 'glm-5.2')).toBeNull();
	});

	it('scopes circuit by model id', () => {
		recordSensitiveContentCircuitTrigger('user-1', 'glm-5.2');
		expect(getSensitiveContentCircuitOpen('user-1', 'glm-5.2')).not.toBeNull();
		expect(getSensitiveContentCircuitOpen('user-1', 'gpt-4.1')).toBeNull();
	});

	it('builds 429 response with Retry-After', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-27T03:00:00.000Z'));
		const info = recordSensitiveContentCircuitTrigger('user-1', 'glm-5.2');
		const res = buildSensitiveContentCircuitOpenResponse(info);
		expect(res.status).toBe(429);
		expect(res.headers.get('Retry-After')).toBe(String(info.retryAfterSeconds));
		const body = (await res.json()) as { error: { code: string; retry_after_seconds: number } };
		expect(body.error.code).toBe('sensitive_content_circuit_open');
		expect(body.error.retry_after_seconds).toBe(info.retryAfterSeconds);
	});

	it('detects sensitive upstream responses from formatted HTTP errors', () => {
		expect(
			isSensitiveUpstreamResponse(
				400,
				'application/json',
				JSON.stringify({
					error: {
						message:
							'系统检测到输入或生成内容可能包含不安全或敏感内容，请您避免输入易产生敏感内容的提示词。',
					},
				})
			)
		).toBe(true);
		expect(
			isSensitiveUpstreamResponse(400, 'application/json', JSON.stringify({ error: { message: 'bad request' } }))
		).toBe(false);
	});
});
