import { describe, expect, it } from 'vitest';
import {
	STICKY_DEFAULT_SHORT_WAIT_MS,
	STICKY_DEFAULT_TTL_SECONDS,
	normalizeModelStickyConfigInput,
	parseModelStickyConfig,
	resolveStickyRouteRule,
} from './model-sticky-config';

describe('parseModelStickyConfig', () => {
	it('returns null for empty / invalid / rule-less configs', () => {
		expect(parseModelStickyConfig(null)).toBeNull();
		expect(parseModelStickyConfig('')).toBeNull();
		expect(parseModelStickyConfig('not json')).toBeNull();
		expect(parseModelStickyConfig('{"ttl_seconds":600}')).toBeNull();
		expect(parseModelStickyConfig('{"rules":{}}')).toBeNull();
	});

	it('parses rules with top-level defaults', () => {
		const config = parseModelStickyConfig(
			'{"ttl_seconds":300,"short_wait_ms":2000,"rules":{"openai:default":{"enabled":true}}}'
		);
		expect(config).not.toBeNull();
		expect(config!.ttlSeconds).toBe(300);
		expect(config!.shortWaitMs).toBe(2000);
		expect(config!.rules.get('openai:default')).toEqual({ enabled: true, ttlSeconds: null, shortWaitMs: null });
	});

	it('falls back to code defaults when top-level values are missing', () => {
		const config = parseModelStickyConfig('{"rules":{"openai:default":{"enabled":true}}}');
		expect(config!.ttlSeconds).toBe(STICKY_DEFAULT_TTL_SECONDS);
		expect(config!.shortWaitMs).toBe(STICKY_DEFAULT_SHORT_WAIT_MS);
	});

	it('normalizes rule keys to lowercase and skips malformed keys', () => {
		const config = parseModelStickyConfig(
			'{"rules":{"OpenAI:Default":{"enabled":true},"nocolon":{"enabled":true}}}'
		);
		expect(config!.rules.has('openai:default')).toBe(true);
		expect(config!.rules.size).toBe(1);
	});
});

describe('resolveStickyRouteRule', () => {
	const raw = JSON.stringify({
		ttl_seconds: 300,
		rules: {
			'openai:default': { enabled: true },
			'openai:free': { enabled: true, ttl_seconds: 120, short_wait_ms: 1000 },
			'anthropic:default': { enabled: false },
		},
	});

	it('resolves an enabled rule with merged defaults', () => {
		expect(resolveStickyRouteRule(raw, 'openai', 'default')).toEqual({
			ttlSeconds: 300,
			shortWaitMs: STICKY_DEFAULT_SHORT_WAIT_MS,
		});
	});

	it('lets per-rule overrides win over top-level defaults', () => {
		expect(resolveStickyRouteRule(raw, 'openai', 'free')).toEqual({ ttlSeconds: 120, shortWaitMs: 1000 });
	});

	it('matches protocol and group case-insensitively', () => {
		expect(resolveStickyRouteRule(raw, 'OpenAI', 'DEFAULT')).not.toBeNull();
	});

	it('returns null for disabled or missing rules and null configs', () => {
		expect(resolveStickyRouteRule(raw, 'anthropic', 'default')).toBeNull();
		expect(resolveStickyRouteRule(raw, 'gemini', 'default')).toBeNull();
		expect(resolveStickyRouteRule(null, 'openai', 'default')).toBeNull();
	});
});

describe('normalizeModelStickyConfigInput', () => {
	it('returns null for empty input (clear config = sticky off)', () => {
		expect(normalizeModelStickyConfigInput(null)).toBeNull();
		expect(normalizeModelStickyConfigInput('  ')).toBeNull();
	});

	it('normalizes keys and keeps only known rule fields', () => {
		const out = normalizeModelStickyConfigInput(
			'{"rules":{"OpenAI:Default":{"enabled":true,"ttl_seconds":120,"junk":1}},"ttl_seconds":300}'
		);
		expect(JSON.parse(out!)).toEqual({
			rules: { 'openai:default': { enabled: true, ttl_seconds: 120 } },
			ttl_seconds: 300,
		});
	});

	it('preserves explicit enabled=false rules', () => {
		const out = normalizeModelStickyConfigInput('{"rules":{"openai:default":{"enabled":false}}}');
		expect(JSON.parse(out!)).toEqual({ rules: { 'openai:default': { enabled: false } } });
	});

	it('throws for invalid JSON, malformed rule keys and empty rules', () => {
		expect(() => normalizeModelStickyConfigInput('nope')).toThrow(/valid JSON/);
		expect(() => normalizeModelStickyConfigInput('{"rules":{"bad":{"enabled":true}}}')).toThrow(
			/\{protocol\}:\{route_group\}/
		);
		expect(() => normalizeModelStickyConfigInput('{"rules":{}}')).toThrow(/at least one rule/);
	});
});
