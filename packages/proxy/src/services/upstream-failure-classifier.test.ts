import { describe, expect, it } from 'vitest';
import {
	classifyUpstreamFetchFailure,
	classifyUpstreamHttpFailure,
} from './upstream-failure-classifier';

describe('upstream-failure-classifier', () => {
	it('retries on 429 with rate_limit circuit kind', () => {
		expect(classifyUpstreamHttpFailure(429)).toEqual({ action: 'retry_key', failureKind: 'rate_limit' });
	});

	it('retries on ordinary 5xx with server circuit kind', () => {
		expect(classifyUpstreamHttpFailure(500)).toEqual({ action: 'retry_key', failureKind: 'server' });
		expect(classifyUpstreamHttpFailure(503)).toEqual({ action: 'retry_key', failureKind: 'server' });
	});

	it('retries 524 without cross-request circuit kind', () => {
		expect(classifyUpstreamHttpFailure(524)).toEqual({ action: 'retry_key' });
	});

	it('retries 401/403 with alert flag and auth kind', () => {
		expect(classifyUpstreamHttpFailure(401)).toEqual({
			action: 'retry_key',
			alertOnKeySwitch: true,
			failureKind: 'auth',
		});
		expect(classifyUpstreamHttpFailure(403)).toEqual({
			action: 'retry_key',
			alertOnKeySwitch: true,
			failureKind: 'auth',
		});
	});

	it('fails immediately on client errors', () => {
		expect(classifyUpstreamHttpFailure(400).action).toBe('fail_immediately');
		expect(classifyUpstreamHttpFailure(404).action).toBe('fail_immediately');
	});

	it('classifies fetch failures as retry_key without circuit kind', () => {
		expect(classifyUpstreamFetchFailure()).toEqual({ action: 'retry_key' });
	});
});
