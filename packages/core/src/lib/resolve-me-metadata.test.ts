import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveMeMetadata } from './resolve-me-metadata';

describe('resolveMeMetadata', () => {
	it('returns null when both sources are empty', () => {
		assert.equal(resolveMeMetadata(null, null), null);
		assert.equal(resolveMeMetadata('{}', '{}'), null);
	});

	it('falls back to key metadata when user metadata is empty', () => {
		assert.deepEqual(resolveMeMetadata(null, '{"plan_id":"pro"}'), { plan_id: 'pro' });
	});

	it('prefers user metadata over key on conflicts', () => {
		assert.deepEqual(
			resolveMeMetadata(
				'{"plan_id":"max","subscription_status":"active"}',
				'{"plan_id":"free","signup_bonus":10}'
			)
		, { plan_id: 'max', subscription_status: 'active', signup_bonus: 10 });
	});

	it('merges key-only fields when user has partial metadata', () => {
		assert.deepEqual(resolveMeMetadata('{"subscription_status":"active"}', '{"plan_id":"lite"}'), {
			plan_id: 'lite',
			subscription_status: 'active',
		});
	});
});
