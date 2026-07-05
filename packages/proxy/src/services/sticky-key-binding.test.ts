import { beforeEach, describe, expect, it } from 'vitest';
import {
	getStickyBinding,
	resetStickyBindingStateForTests,
	setStickyBinding,
} from './sticky-key-binding';

beforeEach(() => {
	resetStickyBindingStateForTests();
});

describe('sticky key binding', () => {
	it('stores and returns a binding before the TTL expires', () => {
		const t0 = 1_000_000;
		setStickyBinding('u1', 'gpt-x', 'default', 'openai', { providerId: 'p1', keyId: 'k1' }, 600, t0);
		expect(getStickyBinding('u1', 'gpt-x', 'default', 'openai', t0 + 599_000)).toEqual({
			providerId: 'p1',
			keyId: 'k1',
		});
	});

	it('expires after the idle TTL', () => {
		const t0 = 1_000_000;
		setStickyBinding('u1', 'gpt-x', 'default', 'openai', { providerId: 'p1', keyId: 'k1' }, 600, t0);
		expect(getStickyBinding('u1', 'gpt-x', 'default', 'openai', t0 + 600_000)).toBeNull();
	});

	it('refreshes the TTL when re-set after a successful request', () => {
		const t0 = 1_000_000;
		setStickyBinding('u1', 'gpt-x', 'default', 'openai', { providerId: 'p1', keyId: 'k1' }, 600, t0);
		setStickyBinding('u1', 'gpt-x', 'default', 'openai', { providerId: 'p1', keyId: 'k1' }, 600, t0 + 500_000);
		expect(getStickyBinding('u1', 'gpt-x', 'default', 'openai', t0 + 900_000)).toEqual({
			providerId: 'p1',
			keyId: 'k1',
		});
	});

	it('isolates bindings across user, model, group and protocol dimensions', () => {
		const t0 = 1_000_000;
		setStickyBinding('u1', 'gpt-x', 'default', 'openai', { providerId: 'p1', keyId: 'k1' }, 600, t0);
		expect(getStickyBinding('u2', 'gpt-x', 'default', 'openai', t0)).toBeNull();
		expect(getStickyBinding('u1', 'gpt-y', 'default', 'openai', t0)).toBeNull();
		expect(getStickyBinding('u1', 'gpt-x', 'free', 'openai', t0)).toBeNull();
		expect(getStickyBinding('u1', 'gpt-x', 'default', 'anthropic', t0)).toBeNull();
	});

	it('normalizes group and protocol case', () => {
		const t0 = 1_000_000;
		setStickyBinding('u1', 'gpt-x', 'Default', 'OpenAI', { providerId: 'p1', keyId: 'k1' }, 600, t0);
		expect(getStickyBinding('u1', 'gpt-x', 'default', 'openai', t0)).toEqual({
			providerId: 'p1',
			keyId: 'k1',
		});
	});

	it('overwrites an existing binding for the same dimensions', () => {
		const t0 = 1_000_000;
		setStickyBinding('u1', 'gpt-x', 'default', 'openai', { providerId: 'p1', keyId: 'k1' }, 600, t0);
		setStickyBinding('u1', 'gpt-x', 'default', 'openai', { providerId: 'p2', keyId: 'k2' }, 600, t0 + 1_000);
		expect(getStickyBinding('u1', 'gpt-x', 'default', 'openai', t0 + 2_000)).toEqual({
			providerId: 'p2',
			keyId: 'k2',
		});
	});
});
