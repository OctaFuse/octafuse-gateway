import { describe, expect, it } from 'vitest';
import {
	normalizeProviderKeyLimitConfigInput,
	parseProviderKeyLimitConfig,
} from './provider-key-limit-config';

describe('parseProviderKeyLimitConfig', () => {
	it('parses a full config', () => {
		expect(parseProviderKeyLimitConfig('{"rpm":500,"tpm":200000,"max_concurrency":32}')).toEqual({
			rpm: 500,
			tpm: 200_000,
			maxConcurrency: 32,
		});
	});

	it('supports partial dimensions and defaults the rest to null', () => {
		expect(parseProviderKeyLimitConfig('{"rpm":10}')).toEqual({ rpm: 10, tpm: null, maxConcurrency: null });
	});

	it('ignores unknown fields (forward compatible)', () => {
		expect(parseProviderKeyLimitConfig('{"rpm":10,"burst":99}')).toEqual({
			rpm: 10,
			tpm: null,
			maxConcurrency: null,
		});
	});

	it('returns null for empty / invalid / no-effective-field inputs', () => {
		expect(parseProviderKeyLimitConfig(null)).toBeNull();
		expect(parseProviderKeyLimitConfig('')).toBeNull();
		expect(parseProviderKeyLimitConfig('not json')).toBeNull();
		expect(parseProviderKeyLimitConfig('[1,2]')).toBeNull();
		expect(parseProviderKeyLimitConfig('{"rpm":0}')).toBeNull();
		expect(parseProviderKeyLimitConfig('{"rpm":-5}')).toBeNull();
		expect(parseProviderKeyLimitConfig('{"rpm":"10"}')).toBeNull();
	});

	it('floors fractional values', () => {
		expect(parseProviderKeyLimitConfig('{"rpm":10.9}')).toEqual({ rpm: 10, tpm: null, maxConcurrency: null });
	});
});

describe('normalizeProviderKeyLimitConfigInput', () => {
	it('returns null for empty input (clear config)', () => {
		expect(normalizeProviderKeyLimitConfigInput(null)).toBeNull();
		expect(normalizeProviderKeyLimitConfigInput('')).toBeNull();
		expect(normalizeProviderKeyLimitConfigInput('   ')).toBeNull();
	});

	it('normalizes to only known fields', () => {
		expect(normalizeProviderKeyLimitConfigInput('{"rpm":500,"unknown":1}')).toBe('{"rpm":500}');
	});

	it('throws for invalid JSON, non-objects, and configs without effective fields', () => {
		expect(() => normalizeProviderKeyLimitConfigInput('nope')).toThrow(/valid JSON/);
		expect(() => normalizeProviderKeyLimitConfigInput('[1]')).toThrow(/JSON object/);
		expect(() => normalizeProviderKeyLimitConfigInput('{"rpm":0}')).toThrow(/at least one/);
	});
});
