import { describe, expect, it } from 'vitest';
import { resolveMeMetadata } from './resolve-me-metadata';

describe('resolveMeMetadata', () => {
	it('returns null when both sources are empty', () => {
		expect(resolveMeMetadata(null, null)).toBeNull();
		expect(resolveMeMetadata('{}', '{}')).toBeNull();
	});

	it('falls back to key metadata when user metadata is empty', () => {
		expect(resolveMeMetadata(null, '{"plan_id":"pro"}')).toEqual({ plan_id: 'pro' });
	});

	it('prefers user metadata over key on conflicts', () => {
		expect(
			resolveMeMetadata(
				'{"plan_id":"max","subscription_status":"active"}',
				'{"plan_id":"free","signup_bonus":10}'
			)
		).toEqual({ plan_id: 'max', subscription_status: 'active', signup_bonus: 10 });
	});

	it('merges key-only fields when user has partial metadata', () => {
		expect(resolveMeMetadata('{"subscription_status":"active"}', '{"plan_id":"lite"}')).toEqual({
			plan_id: 'lite',
			subscription_status: 'active',
		});
	});
});
