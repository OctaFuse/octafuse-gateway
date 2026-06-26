import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatTokenCount } from './format-token-count';

describe('formatTokenCount', () => {
	it('numeric mode uses locale grouping', () => {
		assert.equal(formatTokenCount(1234567, 'numeric'), '1,234,567');
	});

	it('compact mode uses M for millions', () => {
		assert.equal(formatTokenCount(1_500_000, 'compact'), '1.5M');
		assert.equal(formatTokenCount(2_000_000, 'compact'), '2M');
	});

	it('compact mode uses B for billions', () => {
		assert.equal(formatTokenCount(2_500_000_000, 'compact'), '2.5B');
	});

	it('compact mode keeps sub-million values as plain numbers', () => {
		assert.equal(formatTokenCount(999_999, 'compact'), '999,999');
	});

	it('handles nullish values', () => {
		assert.equal(formatTokenCount(null, 'numeric'), '—');
		assert.equal(formatTokenCount(undefined, 'compact'), '—');
	});
});
