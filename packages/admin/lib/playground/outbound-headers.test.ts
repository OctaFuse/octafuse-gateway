import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	decodePlaygroundRequestHeadersHeader,
	encodePlaygroundRequestHeadersHeader,
	redactPlaygroundOutboundHeaderValue,
	redactPlaygroundOutboundHeaders,
} from './outbound-headers';

describe('playground outbound headers', () => {
	it('redacts Authorization, x-api-key, and x-goog-api-key', () => {
		assert.equal(
			redactPlaygroundOutboundHeaderValue('Authorization', 'Bearer sk-abcdefghijklmnop'),
			'Bearer sk-abcd…mnop',
		);
		assert.equal(redactPlaygroundOutboundHeaderValue('x-api-key', 'sk-anthropic-secret-key'), 'sk-anth…-key');
		assert.equal(redactPlaygroundOutboundHeaderValue('X-Goog-Api-Key', 'AIzaSySecretValue'), 'AIzaSyS…alue');
		assert.equal(redactPlaygroundOutboundHeaderValue('Content-Type', 'application/json'), 'application/json');
	});

	it('round-trips redacted headers through the playground response header', () => {
		const encoded = encodePlaygroundRequestHeadersHeader(
			redactPlaygroundOutboundHeaders({
				'Content-Type': 'application/json',
				Authorization: 'Bearer sk-abcdefghijklmnop',
				x: '1',
			}),
		);
		const res = new Response(null, {
			headers: { 'x-playground-request-headers': encoded },
		});
		assert.deepEqual(decodePlaygroundRequestHeadersHeader(res), {
			'Content-Type': 'application/json',
			Authorization: 'Bearer sk-abcd…mnop',
			x: '1',
		});
	});

	it('redactPlaygroundOutboundHeaders keeps non-secret keys intact', () => {
		assert.deepEqual(
			redactPlaygroundOutboundHeaders({
				'anthropic-version': '2023-06-01',
				'x-api-key': 'short',
			}),
			{
				'anthropic-version': '2023-06-01',
				'x-api-key': '••••••••',
			},
		);
	});
});
