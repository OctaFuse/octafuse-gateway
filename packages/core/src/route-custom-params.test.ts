import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	applyRouteExtraHeaders,
	composeRouteCustomParamsEnvelope,
	isRouteCustomParamsForceOverride,
	mergeRouteRequestBody,
	mergeUpstreamHeaders,
	normalizeRouteCustomParamsForStorage,
	overlayClientHeadersOnRouteCustomParams,
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

	it('reads envelope body, headers, and per-side force_override', () => {
		const split = splitRouteCustomParams({
			headers: { 'X-Title': 'My App' },
			body: { temperature: 0.7, stream: true },
			force_override: { body: true },
		});
		assert.deepEqual(split.body, { temperature: 0.7, stream: true });
		assert.deepEqual(split.extraHeaders, { 'X-Title': 'My App' });
		assert.equal(split.forceOverrideHeaders, false);
		assert.equal(split.forceOverrideBody, true);
	});

	it('treats old flat objects as body plus headers with force override off', () => {
		const split = splitRouteCustomParams({
			temperature: 0.7,
			headers: { 'X-Title': 'A' },
		});
		assert.deepEqual(split.body, { temperature: 0.7 });
		assert.deepEqual(split.extraHeaders, { 'X-Title': 'A' });
		assert.equal(split.forceOverrideHeaders, false);
		assert.equal(split.forceOverrideBody, false);
	});

	it('accepts headers-only and body-only envelopes', () => {
		assert.deepEqual(splitRouteCustomParams({ headers: { Accept: 'application/json' } }).extraHeaders, {
			Accept: 'application/json',
		});
		assert.deepEqual(splitRouteCustomParams({ body: { max_tokens: 1024 } }).body, { max_tokens: 1024 });
	});

	it('treats a non-object body as legacy rather than envelope', () => {
		const split = splitRouteCustomParams({ body: 'not-object', temperature: 0.1 });
		assert.deepEqual(split.body, { body: 'not-object', temperature: 0.1 });
		assert.equal(split.forceOverrideBody, false);
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

describe('overlayClientHeadersOnRouteCustomParams', () => {
	const customParams = {
		temperature: 0.7,
		headers: {
			'HTTP-Referer': 'https://route.example',
			'X-Title': 'Route App',
		},
	};

	it('lets client same-name headers win when force override is off', () => {
		const resolved = overlayClientHeadersOnRouteCustomParams(customParams, {
			clientHeaders: { 'http-referer': 'https://client.example', 'X-Other': 'ignored' },
		});
		assert.deepEqual(resolved?.headers, {
			'HTTP-Referer': 'https://client.example',
			'X-Title': 'Route App',
		});
		assert.equal(resolved?.temperature, 0.7);
	});

	it('keeps route header values when envelope force_override.headers is on', () => {
		const customParams = {
			headers: { 'HTTP-Referer': 'https://route.example' },
			force_override: { headers: true },
		};
		const resolved = overlayClientHeadersOnRouteCustomParams(customParams, {
			clientHeaders: { 'HTTP-Referer': 'https://client.example' },
		});
		assert.equal(resolved, customParams);
	});

	it('keeps route header values when forceOverride option is on', () => {
		const resolved = overlayClientHeadersOnRouteCustomParams(customParams, {
			forceOverride: true,
			clientHeaders: { 'HTTP-Referer': 'https://client.example' },
		});
		assert.equal(resolved, customParams);
	});

	it('does not forward client-only header names', () => {
		const resolved = overlayClientHeadersOnRouteCustomParams(customParams, {
			clientHeaders: { 'X-Client-Only': 'nope' },
		});
		assert.equal(resolved, customParams);
	});

	it('does not copy unlisted or protected client headers', () => {
		const resolved = overlayClientHeadersOnRouteCustomParams(
			{ headers: { 'X-Title': 'Route' } },
			{ clientHeaders: { Authorization: 'Bearer stolen', 'X-Client-Only': 'nope', 'X-Title': 'Client' } },
		);
		assert.deepEqual(resolved?.headers, { 'X-Title': 'Client' });
	});

	it('applies client overlay through applyRouteExtraHeaders', () => {
		const merged = applyRouteExtraHeaders(
			{ Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
			customParams,
			{ clientHeaders: new Headers({ 'HTTP-Referer': 'https://client.example' }) },
		);
		assert.equal(merged['HTTP-Referer'], 'https://client.example');
		assert.equal(merged['X-Title'], 'Route App');
		assert.equal(merged.Authorization, 'Bearer secret');
	});
});

describe('mergeRouteRequestBody', () => {
	it('lets client fields win by default and strips headers from the body', () => {
		const body = mergeRouteRequestBody(
			{
				temperature: 0.7,
				max_tokens: 1024,
				headers: { 'HTTP-Referer': 'https://example.com' },
			},
			{ messages: [], temperature: 0.2 },
		);
		assert.equal(body.temperature, 0.2);
		assert.equal(body.max_tokens, 1024);
		assert.deepEqual(body.messages, []);
		assert.equal(body.headers, undefined);
	});

	it('lets route fields win when envelope force_override.body is on', () => {
		const body = mergeRouteRequestBody(
			{ body: { temperature: 0.7, max_tokens: 32000 }, force_override: { body: true } },
			{ messages: [], temperature: 0.2, max_tokens: 8000 },
		);
		assert.equal(body.temperature, 0.7);
		assert.equal(body.max_tokens, 32000);
		assert.deepEqual(body.messages, []);
	});

	it('lets route fields win when forceOverride option is on', () => {
		const body = mergeRouteRequestBody(
			{ temperature: 0.7, max_tokens: 32000 },
			{ messages: [], temperature: 0.2, max_tokens: 8000 },
			{ forceOverride: true },
		);
		assert.equal(body.temperature, 0.7);
		assert.equal(body.max_tokens, 32000);
		assert.deepEqual(body.messages, []);
	});

	it('deep-merges nested objects with the winner overlaying specified keys', () => {
		const clientWins = mergeRouteRequestBody(
			{ thinking: { type: 'enabled', budget_tokens: 128 } },
			{ thinking: { type: 'disabled' } },
		);
		assert.deepEqual(clientWins.thinking, { type: 'disabled', budget_tokens: 128 });

		const routeWins = mergeRouteRequestBody(
			{ thinking: { type: 'enabled' }, max_tokens: 32000 },
			{ thinking: { type: 'disabled', budget_tokens: 1000 }, max_tokens: 8000 },
			{ forceOverride: true },
		);
		assert.deepEqual(routeWins.thinking, { type: 'enabled', budget_tokens: 1000 });
		assert.equal(routeWins.max_tokens, 32000);
	});

	it('replaces arrays as a whole using the winner', () => {
		const clientWins = mergeRouteRequestBody({ stop: ['a'] }, { stop: ['b', 'c'] });
		assert.deepEqual(clientWins.stop, ['b', 'c']);

		const routeWins = mergeRouteRequestBody({ stop: ['a'] }, { stop: ['b', 'c'] }, { forceOverride: true });
		assert.deepEqual(routeWins.stop, ['a']);
	});

	it('lets an explicit null from the winner replace the other side', () => {
		const clientWins = mergeRouteRequestBody({ max_tokens: 1024 }, { max_tokens: null });
		assert.equal(clientWins.max_tokens, null);

		const routeWins = mergeRouteRequestBody({ max_tokens: 32000 }, { max_tokens: null }, { forceOverride: true });
		assert.equal(routeWins.max_tokens, 32000);
	});
});

describe('isRouteCustomParamsForceOverride', () => {
	it('treats true and 1 as on, and missing values as off', () => {
		assert.equal(isRouteCustomParamsForceOverride(true), true);
		assert.equal(isRouteCustomParamsForceOverride(1), true);
		assert.equal(isRouteCustomParamsForceOverride('1'), true);
		assert.equal(isRouteCustomParamsForceOverride(false), false);
		assert.equal(isRouteCustomParamsForceOverride(0), false);
		assert.equal(isRouteCustomParamsForceOverride(null), false);
		assert.equal(isRouteCustomParamsForceOverride(undefined), false);
	});
});

describe('composeRouteCustomParamsEnvelope', () => {
	it('writes only true force_override sides and omits empty config', () => {
		assert.equal(composeRouteCustomParamsEnvelope({}), null);
		assert.deepEqual(
			composeRouteCustomParamsEnvelope({
				body: { temperature: 0.7 },
				extraHeaders: { 'X-Title': 'My App' },
				forceOverrideBody: true,
			}),
			{
				headers: { 'X-Title': 'My App' },
				body: { temperature: 0.7 },
				force_override: { body: true },
			},
		);
		assert.deepEqual(composeRouteCustomParamsEnvelope({ forceOverrideHeaders: true }), {
			force_override: { headers: true },
		});
	});

	it('normalizes old flat JSON into an envelope with force override off', () => {
		assert.deepEqual(
			normalizeRouteCustomParamsForStorage({
				temperature: 0.7,
				headers: { 'X-Title': 'A' },
			}),
			{
				headers: { 'X-Title': 'A' },
				body: { temperature: 0.7 },
			},
		);
	});
});
