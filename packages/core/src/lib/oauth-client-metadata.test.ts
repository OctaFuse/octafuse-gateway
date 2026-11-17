import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	OAUTH_CIMD_MAX_BYTES,
	clientIdMetadataUrlProblem,
	fetchClientIdMetadataDocument,
	isClientIdMetadataFresh,
	parseClientIdMetadataDocument,
} from './oauth-client-metadata';

const URL_ID = 'https://client.example.com/oauth/metadata.json';
const doc = (over: Record<string, unknown> = {}) => ({
	client_id: URL_ID,
	client_name: 'Example Agent',
	redirect_uris: ['http://127.0.0.1/callback'],
	...over,
});

describe('client id metadata URL rules', () => {
	it('accepts public https URLs with a path', () => {
		assert.equal(clientIdMetadataUrlProblem(URL_ID), null);
	});
	it('rejects URLs that could reach internal hosts or are not canonical', () => {
		for (const bad of [
			'http://client.example.com/m.json',
			'https://client.example.com',
			'https://client.example.com/',
			'https://127.0.0.1/m.json',
			'https://[::1]/m.json',
			'https://localhost/m.json',
			'https://intranet/m.json',
			'https://db.internal/m.json',
			'https://printer.local/m.json',
			'https://client.example.com:8443/m.json',
			'https://u:p@client.example.com/m.json',
			'https://CLIENT.example.com/m.json',
			`https://client.example.com/${'a'.repeat(300)}`,
		]) {
			assert.notEqual(clientIdMetadataUrlProblem(bad), null, bad);
		}
	});
});

describe('client id metadata documents', () => {
	it('parses a valid public client document', () => {
		const result = parseClientIdMetadataDocument(URL_ID, doc());
		assert.equal(result.ok, true);
		assert.deepEqual(result.ok && result.metadata, {
			clientId: URL_ID,
			clientName: 'Example Agent',
			redirectUris: ['http://127.0.0.1/callback'],
		});
		const unnamed = parseClientIdMetadataDocument(URL_ID, doc({ client_name: undefined }));
		assert.equal(unnamed.ok && unnamed.metadata.clientName, 'client.example.com');
	});
	it('rejects mismatched ids, secrets, confidential methods and bad callbacks', () => {
		assert.equal(parseClientIdMetadataDocument(URL_ID, doc({ client_id: 'https://other.example/m.json' })).ok, false);
		assert.equal(parseClientIdMetadataDocument(URL_ID, doc({ client_secret: 'x' })).ok, false);
		assert.equal(parseClientIdMetadataDocument(URL_ID, doc({ token_endpoint_auth_method: 'private_key_jwt' })).ok, false);
		assert.equal(parseClientIdMetadataDocument(URL_ID, doc({ redirect_uris: [] })).ok, false);
		assert.equal(parseClientIdMetadataDocument(URL_ID, doc({ redirect_uris: ['javascript:alert(1)'] })).ok, false);
		assert.equal(parseClientIdMetadataDocument(URL_ID, []).ok, false);
	});
	it('fetches without following redirects and enforces size limits', async () => {
		let seen: RequestInit | undefined;
		const ok = await fetchClientIdMetadataDocument(URL_ID, (async (_url: string, init?: RequestInit) => {
			seen = init;
			return new Response(JSON.stringify(doc()), { status: 200, headers: { 'content-type': 'application/json' } });
		}) as typeof fetch);
		assert.equal(ok.ok, true);
		assert.equal(seen?.redirect, 'manual');

		const redirected = await fetchClientIdMetadataDocument(URL_ID, (async () =>
			new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })) as typeof fetch);
		assert.equal(redirected.ok, false);

		const huge = await fetchClientIdMetadataDocument(URL_ID, (async () =>
			new Response('x'.repeat(OAUTH_CIMD_MAX_BYTES + 1), { status: 200 })) as typeof fetch);
		assert.equal(huge.ok, false);

		const failing = await fetchClientIdMetadataDocument(URL_ID, (async () => {
			throw new Error('network');
		}) as typeof fetch);
		assert.equal(failing.ok, false);

		let called = false;
		const blocked = await fetchClientIdMetadataDocument('https://127.0.0.1/m.json', (async () => {
			called = true;
			return new Response('{}');
		}) as typeof fetch);
		assert.equal(blocked.ok, false);
		assert.equal(called, false);
	});
	it('reports freshness against the refresh window', () => {
		const now = Date.parse('2026-11-01T01:00:00.000Z');
		assert.equal(isClientIdMetadataFresh('2026-11-01T00:30:00.000Z', now), true);
		assert.equal(isClientIdMetadataFresh('2026-10-31T23:00:00.000Z', now), false);
		assert.equal(isClientIdMetadataFresh(null, now), false);
	});
});
