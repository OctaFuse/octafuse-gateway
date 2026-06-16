import { describe, expect, it } from 'vitest';
import { fingerprintProviderApiKey, maskProviderApiKeyForAdmin } from '../db/provider-key-utils';

describe('provider-key-utils', () => {
	it('fingerprintProviderApiKey masks short keys', () => {
		expect(fingerprintProviderApiKey('abc')).toBe('***');
		expect(fingerprintProviderApiKey('sk-1234567890')).toBe('…7890');
	});

	it('maskProviderApiKeyForAdmin shows prefix and suffix', () => {
		expect(maskProviderApiKeyForAdmin('sk-1234567890abcdef')).toBe('sk-…cdef');
		expect(maskProviderApiKeyForAdmin('')).toBe('(empty)');
	});
});
