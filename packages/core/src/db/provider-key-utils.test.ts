import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fingerprintProviderApiKey, maskProviderApiKeyForAdmin } from '../db/provider-key-utils';

describe('provider-key-utils', () => {
	it('fingerprintProviderApiKey masks short keys', () => {
		assert.equal(fingerprintProviderApiKey('abc'), '***');
		assert.equal(fingerprintProviderApiKey('sk-1234567890'), '…7890');
	});

	it('maskProviderApiKeyForAdmin shows prefix and suffix', () => {
		assert.equal(maskProviderApiKeyForAdmin('sk-1234567890abcdef'), 'sk-…cdef');
		assert.equal(maskProviderApiKeyForAdmin(''), '(empty)');
	});
});
