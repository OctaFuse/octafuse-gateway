import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	classifyUpstreamFetchFailure,
	classifyUpstreamHttpFailure,
} from './upstream-failure-classifier';

describe('upstream-failure-classifier', () => {
	it('retries on 429 with rate_limit circuit kind', () => {
		assert.deepEqual(classifyUpstreamHttpFailure(429), { action: 'retry_key', failureKind: 'rate_limit' });
	});

	it('retries on ordinary 5xx with server circuit kind', () => {
		assert.deepEqual(classifyUpstreamHttpFailure(500), { action: 'retry_key', failureKind: 'server' });
		assert.deepEqual(classifyUpstreamHttpFailure(503), { action: 'retry_key', failureKind: 'server' });
	});

	it('retries 524 without cross-request circuit kind', () => {
		assert.deepEqual(classifyUpstreamHttpFailure(524), { action: 'retry_key' });
	});

	it('retries 401/402/403 with alert flag and auth kind', () => {
		assert.deepEqual(classifyUpstreamHttpFailure(402), {
			action: 'retry_key',
			alertOnKeySwitch: true,
			failureKind: 'auth',
		});
		assert.deepEqual(classifyUpstreamHttpFailure(401), {
			action: 'retry_key',
			alertOnKeySwitch: true,
			failureKind: 'auth',
		});
		assert.deepEqual(classifyUpstreamHttpFailure(403), {
			action: 'retry_key',
			alertOnKeySwitch: true,
			failureKind: 'auth',
		});
	});

	it('fails immediately on client errors', () => {
		assert.equal(classifyUpstreamHttpFailure(400).action, 'fail_immediately');
		assert.equal(classifyUpstreamHttpFailure(404).action, 'fail_immediately');
	});

	it('classifies fetch failures as retry_key without circuit kind', () => {
		assert.deepEqual(classifyUpstreamFetchFailure(), { action: 'retry_key' });
	});
});
