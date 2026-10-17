import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractUpstreamRequestId, normalizeUpstreamId, resolveGeminiLoggedRequestId } from './upstream-request-id';

describe('extractUpstreamRequestId', () => {
	it('prefers x-request-id over other headers', () => {
		const headers = new Headers({
			'x-request-id': 'req_openai_123',
			'request-id': 'req_anthropic_456',
		});
		assert.equal(extractUpstreamRequestId(headers), 'req_openai_123');
	});

	it('falls back to request-id and x-goog-request-id', () => {
		assert.equal(extractUpstreamRequestId(new Headers({ 'request-id': 'req_abc' })), 'req_abc');
		assert.equal(extractUpstreamRequestId(new Headers({ 'x-goog-request-id': 'goog_xyz' })), 'goog_xyz');
	});

	it('captures vendor/CDN fallback headers (Bedrock, Azure, Wangsu, Qiniu)', () => {
		assert.equal(extractUpstreamRequestId(new Headers({ 'x-amzn-requestid': 'amzn_1' })), 'amzn_1');
		assert.equal(extractUpstreamRequestId(new Headers({ 'x-ms-request-id': 'ms_1' })), 'ms_1');
		assert.equal(
			extractUpstreamRequestId(new Headers({ 'x-ws-request-id': '6a4654e1_PS-SHA_45108-42805' }))
		, '6a4654e1_PS-SHA_45108-42805');
		assert.equal(
			extractUpstreamRequestId(new Headers({ 'http_x_reqid': 'chatptvtx-2d9b7da15a764f169bfc8459bdfec300' }))
		, 'chatptvtx-2d9b7da15a764f169bfc8459bdfec300');
	});

	it('parses x-cloud-trace-context trace id segment', () => {
		assert.equal(
			extractUpstreamRequestId(
				new Headers({ 'x-cloud-trace-context': 'abc123def456/0123456789;o=1' })
			)
		, 'abc123def456');
	});

	it('prefers standard provider headers over vendor/CDN fallbacks', () => {
		const headers = new Headers({
			'x-ws-request-id': 'ws_cdn_trace',
			'request-id': 'req_real',
		});
		assert.equal(extractUpstreamRequestId(headers), 'req_real');
	});

	it('returns null when no trace headers are present', () => {
		assert.equal(extractUpstreamRequestId(new Headers({ 'content-type': 'application/json' })), null);
	});

	it('trims and truncates long values', () => {
		const long = 'a'.repeat(250);
		assert.equal(extractUpstreamRequestId(new Headers({ 'x-request-id': `  ${long}  ` })).length, 200);
	});
});

describe('normalizeUpstreamId', () => {
	it('trims and returns non-empty strings', () => {
		assert.equal(normalizeUpstreamId('  msg_bdrk_017Sviuyg  '), 'msg_bdrk_017Sviuyg');
		assert.equal(normalizeUpstreamId('chatcmpl-abc'), 'chatcmpl-abc');
	});

	it('returns null for empty / non-string values', () => {
		assert.equal(normalizeUpstreamId(''), null);
		assert.equal(normalizeUpstreamId('   '), null);
		assert.equal(normalizeUpstreamId(undefined), null);
		assert.equal(normalizeUpstreamId(null), null);
		assert.equal(normalizeUpstreamId(123), null);
	});

	it('truncates values longer than 200 chars', () => {
		assert.equal(normalizeUpstreamId('a'.repeat(250)).length, 200);
	});
});

describe('resolveGeminiLoggedRequestId', () => {
	it('prefers header request id over body request id', () => {
		assert.equal(
			resolveGeminiLoggedRequestId({
				headerRequestId: 'req_header',
				bodyRequestId: 'req_body',
			})
		, 'req_header');
	});

	it('falls back to body request id only', () => {
		assert.equal(
			resolveGeminiLoggedRequestId({
				headerRequestId: null,
				bodyRequestId: 'req_body',
			})
		, 'req_body');
	});

	it('returns null when neither header nor body request id exists (Vertex Express)', () => {
		assert.equal(
			resolveGeminiLoggedRequestId({
				headerRequestId: null,
				bodyRequestId: null,
			})
		, null);
	});
});
