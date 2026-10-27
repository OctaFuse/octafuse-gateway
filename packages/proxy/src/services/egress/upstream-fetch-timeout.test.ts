import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { fetchUntilHeaders } from './upstream-fetch-timeout';

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('fetchUntilHeaders', () => {
	it('passes straight through when no timeout is configured', async () => {
		let seenInit: RequestInit | undefined;
		globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
			seenInit = init;
			return new Response('ok');
		}) as typeof fetch;
		const response = await fetchUntilHeaders('https://u.test', { method: 'POST' });
		assert.equal(await response.text(), 'ok');
		assert.equal(seenInit?.signal, undefined);
	});

	it('rejects with a headers-timeout error when the upstream never answers', async () => {
		globalThis.fetch = ((_url: unknown, init?: RequestInit) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
			})) as typeof fetch;
		await assert.rejects(
			fetchUntilHeaders('https://u.test', { method: 'POST' }, 20),
			/Upstream response headers timeout after 20ms/
		);
	});

	it('does not abort the body after headers have arrived', async () => {
		let signal: AbortSignal | undefined;
		globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
			signal = init?.signal ?? undefined;
			return new Response('streaming');
		}) as typeof fetch;
		const response = await fetchUntilHeaders('https://u.test', { method: 'POST' }, 20);
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.equal(signal?.aborted, false);
		assert.equal(await response.text(), 'streaming');
	});

	it('rethrows non-timeout fetch errors unchanged', async () => {
		globalThis.fetch = (async () => {
			throw new Error('connect ECONNREFUSED');
		}) as typeof fetch;
		await assert.rejects(
			fetchUntilHeaders('https://u.test', { method: 'POST' }, 1000),
			/connect ECONNREFUSED/
		);
	});
});
