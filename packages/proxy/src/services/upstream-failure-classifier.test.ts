import { describe, expect, it } from 'vitest';
import {
	classifyUpstreamFetchFailure,
	classifyUpstreamHttpFailure,
} from './upstream-failure-classifier';

describe('upstream-failure-classifier', () => {
	it('retries on 429 and 5xx', () => {
		expect(classifyUpstreamHttpFailure(429).action).toBe('retry_key');
		expect(classifyUpstreamHttpFailure(500).action).toBe('retry_key');
		expect(classifyUpstreamHttpFailure(503).action).toBe('retry_key');
	});

	it('retries 401/403 with alert flag', () => {
		expect(classifyUpstreamHttpFailure(401)).toEqual({ action: 'retry_key', alertOnKeySwitch: true });
		expect(classifyUpstreamHttpFailure(403)).toEqual({ action: 'retry_key', alertOnKeySwitch: true });
	});

	it('fails immediately on client errors', () => {
		expect(classifyUpstreamHttpFailure(400).action).toBe('fail_immediately');
		expect(classifyUpstreamHttpFailure(404).action).toBe('fail_immediately');
	});

	it('classifies fetch failures as retry_key', () => {
		expect(classifyUpstreamFetchFailure().action).toBe('retry_key');
	});
});
