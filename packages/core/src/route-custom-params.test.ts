import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	applyRouteExtraHeaders,
	mergeUpstreamHeaders,
	ROUTE_CUSTOM_PARAMS_HEADERS_KEY,
	splitRouteCustomParams,
	validateRouteCustomParamsHeaders,
} from './route-custom-params';

describe('splitRouteCustomParams', () => {
	it('strips headers from body and keeps other keys', () => {
		const split = splitRouteCustomParams({
			temperature: 0.7,
			[ROUTE_CUSTOM_PARAMS_HEADERS_KEY]: {
				'HTTP-Referer': 'https://example.com',
				'X-Title': 'My App',
				retries: 2,
			},
		});
		assert.deepEqual(split.body, { temperature: 0.7 });
		assert.deepEqual(split.extraHeaders, {
			'HTTP-Referer': 'https://example.com',
			'X-Title': 'My App',
			retries: '2',
		});
	});

	it('ignores invalid headers objects at runtime', () => {
		const split = splitRouteCustomParams({
			temperature: 0.2,
			headers: 'nope',
		});
		assert.deepEqual(split.body, { temperature: 0.2 });
		assert.deepEqual(split.extraHeaders, {});
	});

	it('skips protected and invalid names at runtime', () => {
		const split = splitRouteCustomParams({
			headers: {
				Authorization: 'Bearer stolen',
				'Bad Name': 'x',
				Accept: 'application/json',
			},
		});
		assert.deepEqual(split.extraHeaders, { Accept: 'application/json' });
	});
});

describe('validateRouteCustomParamsHeaders', () => {
	it('accepts missing headers', () => {
		assert.equal(validateRouteCustomParamsHeaders({ temperature: 0.1 }).ok, true);
		assert.equal(validateRouteCustomParamsHeaders(null).ok, true);
	});

	it('rejects non-object headers', () => {
		const result = validateRouteCustomParamsHeaders({ headers: [] });
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.message, /must be an object/);
	});

	it('rejects protected header names', () => {
		const result = validateRouteCustomParamsHeaders({
			headers: { Authorization: 'Bearer x' },
		});
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.message, /protected header/);
	});

	it('rejects non-string values', () => {
		const result = validateRouteCustomParamsHeaders({
			headers: { 'X-Title': { nested: true } },
		});
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.message, /must be a string/);
	});
});

describe('mergeUpstreamHeaders', () => {
	it('lets extra override non-protected driver headers', () => {
		const merged = mergeUpstreamHeaders(
			{
				'Content-Type': 'application/json',
				Authorization: 'Bearer secret',
				'anthropic-version': '2023-06-01',
			},
			{ 'anthropic-version': '2024-01-01', 'HTTP-Referer': 'https://app.example' },
		);
		assert.equal(merged['anthropic-version'], '2024-01-01');
		assert.equal(merged['HTTP-Referer'], 'https://app.example');
		assert.equal(merged.Authorization, 'Bearer secret');
		assert.equal(merged['Content-Type'], 'application/json');
	});

	it('keeps driver Authorization even if extra tries Authorization casing', () => {
		const merged = applyRouteExtraHeaders(
			{
				Authorization: 'Bearer secret',
				'Content-Type': 'application/json',
			},
			{ headers: { authorization: 'Bearer other', 'X-Title': 'App' } },
		);
		assert.equal(merged.Authorization, 'Bearer secret');
		assert.equal(merged['X-Title'], 'App');
		assert.equal(merged.authorization, undefined);
	});
});
