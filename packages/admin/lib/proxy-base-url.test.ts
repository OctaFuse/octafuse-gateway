import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProxyConnectionProvider, useProxyBaseUrl } from '../components/proxy-connection-provider';
import {
	LEGACY_PROXY_URL_STORAGE,
	PROXY_BASE_URL_STORAGE,
	normalizeProxyBaseUrl,
	readProxyUrlOverride,
	resolveProxyBaseUrl,
} from './proxy-base-url';

test('public Proxy URLs preserve prefixes but reject credentials and scoped endpoints', () => {
	assert.equal(normalizeProxyBaseUrl(' https://gateway.example/prefix/// '), 'https://gateway.example/prefix');
	for (const value of [
		'',
		'invalid',
		'/proxy',
		'ftp://gateway.example',
		'https://user:key@gateway.example',
		'https://gateway.example?key=secret',
		'https://gateway.example#hash',
		'https://gateway.example/v1',
		'https://gateway.example/v1/tools/web-search',
		'https://gateway.example/prefix/mcp/service',
	]) {
		assert.equal(normalizeProxyBaseUrl(value), null, value);
	}
});

test('browser overrides take priority over deployment config and only loopback Admins infer a local Proxy', () => {
	assert.deepEqual(
		resolveProxyBaseUrl({
			override: 'https://override.example/path/',
			deployment: 'https://deploy.example',
			origin: 'http://localhost:8789',
		}),
		{ url: 'https://override.example/path', source: 'browser' }
	);
	assert.deepEqual(
		resolveProxyBaseUrl({ deployment: 'https://deploy.example/prefix/', origin: 'http://localhost:8789' }),
		{ url: 'https://deploy.example/prefix', source: 'deployment' }
	);
	assert.deepEqual(
		resolveProxyBaseUrl({ override: 'https://user:key@example.com', deployment: 'https://deploy.example' }),
		{ url: 'https://deploy.example', source: 'deployment' }
	);
	for (const host of ['localhost', '127.0.0.1', '[::1]']) {
		assert.deepEqual(resolveProxyBaseUrl({ origin: `http://${host}:8789` }), {
			url: `http://${host}:8787`,
			source: 'local',
		});
	}
	for (const origin of [undefined, 'https://admin.example', 'file:///tmp/page.html', 'ftp://localhost']) {
		assert.deepEqual(resolveProxyBaseUrl({ origin }), { url: '', source: 'unset' });
	}
	assert.deepEqual(
		resolveProxyBaseUrl({ deployment: 'https://user:key@gateway.example', origin: 'https://admin.example' }),
		{ url: '', source: 'unset' }
	);
});

test('legacy browser preferences are reused until a shared address is saved and invalid values are skipped', () => {
	const data = new Map<string, string>();
	const storage = { getItem: (key: string) => data.get(key) ?? null };
	assert.equal(readProxyUrlOverride(storage), '');
	data.set(LEGACY_PROXY_URL_STORAGE[1], 'https://simulator.example/prefix/');
	assert.equal(readProxyUrlOverride(storage), 'https://simulator.example/prefix');
	data.set(LEGACY_PROXY_URL_STORAGE[0], 'https://tools.example');
	assert.equal(readProxyUrlOverride(storage), 'https://tools.example');
	data.set(PROXY_BASE_URL_STORAGE, 'https://shared.example');
	assert.equal(readProxyUrlOverride(storage), 'https://shared.example');
	data.set(PROXY_BASE_URL_STORAGE, 'https://shared.example/v1');
	assert.equal(readProxyUrlOverride(storage), 'https://tools.example');
	for (const key of [PROXY_BASE_URL_STORAGE, ...LEGACY_PROXY_URL_STORAGE]) data.delete(key);
	assert.equal(readProxyUrlOverride(storage), '');
});

test('shared Proxy address source labels are available in all four locales', () => {
	for (const locale of ['en', 'zh', 'ja', 'ko']) {
		const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
		assert.deepEqual(Object.keys(messages.proxyConnection.source), ['browser', 'deployment', 'local', 'unset']);
		assert.equal(typeof messages.proxyConnection.reset, 'string');
	}
});

test('server rendering uses deployment defaults without browser storage or cross-render state', () => {
	function Address() {
		const connection = useProxyBaseUrl();
		return createElement('output', { 'data-source': connection.source }, connection.url);
	}
	for (const defaultUrl of ['https://first.example/prefix', 'https://second.example']) {
		const html = renderToStaticMarkup(createElement(ProxyConnectionProvider, { defaultUrl }, createElement(Address)));
		assert.equal(html, `<output data-source="deployment">${defaultUrl}</output>`);
	}
	const invalid = renderToStaticMarkup(
		createElement(
			ProxyConnectionProvider,
			{ defaultUrl: 'https://user:private-pass@example.com' },
			createElement(Address)
		)
	);
	assert.equal(invalid, '<output data-source="unset"></output>');
});
