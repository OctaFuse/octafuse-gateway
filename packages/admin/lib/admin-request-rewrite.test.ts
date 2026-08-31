import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StorageContext } from '@octafuse/core';
import { createAdminApp } from '@/lib/admin-app';
import type { AdminBindings } from '@/lib/admin-env';
import {
	isAccessKeysMutationSameOrigin,
	isSameOriginBrowserWrite,
	publicOriginOf,
	rewriteToInternalAdminPath,
} from '@/lib/admin-request-rewrite';

const consolePrincipal = { type: 'console' as const, id: 'console:admin', username: 'admin' };

function mockStorage(): StorageContext {
	return {
		repositories: {
			adminAccess: {
				listApiKeys: async () => [],
				insertApiKey: async () => {
					throw new Error('insertApiKey should not run when CSRF rejects');
				},
			},
		},
	} as unknown as StorageContext;
}

function sameOriginWrite(url: string, origin: string, extraHeaders?: HeadersInit): Request {
	return new Request(url, {
		method: 'POST',
		headers: { origin, 'content-type': 'application/json', ...extraHeaders },
		body: '{}',
	});
}

describe('publicOriginOf', () => {
	it('uses request URL when Host is absent', () => {
		assert.equal(publicOriginOf(new Request('http://localhost:8789/api/admin/access-keys')), 'http://localhost:8789');
	});

	it('prefers X-Forwarded-Host and X-Forwarded-Proto over the internal URL', () => {
		const request = new Request('http://127.0.0.1:8789/api/admin/access-keys', {
			headers: {
				host: '127.0.0.1:8789',
				'x-forwarded-host': 'admin.example.test, 127.0.0.1:8789',
				'x-forwarded-proto': 'https, http',
			},
		});
		assert.equal(publicOriginOf(request), 'https://admin.example.test');
	});
});

describe('isSameOriginBrowserWrite', () => {
	it('accepts a matching Origin', () => {
		assert.equal(
			isSameOriginBrowserWrite(sameOriginWrite('http://localhost:8789/api/admin/access-keys', 'http://localhost:8789')),
			true,
		);
	});

	it('rejects a missing Origin', () => {
		assert.equal(
			isSameOriginBrowserWrite(new Request('http://localhost:8789/api/admin/access-keys', { method: 'POST' })),
			false,
		);
	});

	it('rejects a cross-site Origin', () => {
		assert.equal(
			isSameOriginBrowserWrite(sameOriginWrite('http://localhost:8789/api/admin/access-keys', 'http://evil.test')),
			false,
		);
	});

	it('treats localhost and 127.0.0.1 as different origins', () => {
		assert.equal(
			isSameOriginBrowserWrite(sameOriginWrite('http://localhost:8789/api/admin/access-keys', 'http://127.0.0.1:8789')),
			false,
		);
	});

	it('aligns browser Origin with forwarded Host', () => {
		assert.equal(
			isSameOriginBrowserWrite(
				sameOriginWrite('http://127.0.0.1:8789/api/admin/access-keys', 'https://admin.example.test', {
					host: '127.0.0.1:8789',
					'x-forwarded-host': 'admin.example.test',
					'x-forwarded-proto': 'https',
				}),
			),
			true,
		);
	});

	it('matches Origin to Host when request.url origin differs (local Next / loopback)', () => {
		const request = sameOriginWrite('http://127.0.0.1:8789/api/admin/access-keys', 'http://localhost:8789', {
			host: 'localhost:8789',
		});
		assert.equal(new URL(request.url).origin, 'http://127.0.0.1:8789');
		assert.equal(publicOriginOf(request), 'http://localhost:8789');
		assert.equal(isSameOriginBrowserWrite(request), true);
	});
});

describe('rewriteToInternalAdminPath', () => {
	it('maps /api/admin/* onto /admin/*', () => {
		const rewritten = rewriteToInternalAdminPath(
			sameOriginWrite('http://localhost:8789/api/admin/access-keys', 'http://localhost:8789'),
		);
		assert.equal(new URL(rewritten.url).pathname, '/admin/access-keys');
	});

	it('keeps CSRF on the original request so rewrite cannot invalidate a same-origin write', () => {
		const original = sameOriginWrite('http://127.0.0.1:8789/api/admin/access-keys', 'http://localhost:8789', {
			host: 'localhost:8789',
		});
		const rewritten = rewriteToInternalAdminPath(original);
		assert.equal(new URL(rewritten.url).pathname, '/admin/access-keys');
		assert.equal(isSameOriginBrowserWrite(original), true);
		assert.equal(isAccessKeysMutationSameOrigin(rewritten, isSameOriginBrowserWrite(original)), true);
	});
});

describe('access-keys CSRF middleware', () => {
	const app = createAdminApp();
	const storage = mockStorage();

	async function postAccessKeys(bindings: AdminBindings, request: Request): Promise<{ status: number; message?: string }> {
		const response = await app.fetch(request, { ...bindings, STORAGE_CONTEXT: storage, ADMIN_PRINCIPAL: consolePrincipal });
		const body = await response.json() as { message?: string };
		return { status: response.status, message: body.message };
	}

	it('lets a console POST through when ADMIN_CSRF_SAME_ORIGIN is true even if Origin is absent', async () => {
		const stripped = new Request('http://localhost:8789/admin/access-keys', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}',
		});
		assert.equal(stripped.headers.get('origin'), null);
		const result = await postAccessKeys({ ADMIN_CSRF_SAME_ORIGIN: true }, stripped);
		assert.notEqual(result.message, 'Forbidden: invalid Origin');
		assert.equal(result.status, 400);
	});

	it('rejects when ADMIN_CSRF_SAME_ORIGIN is false', async () => {
		const rewritten = rewriteToInternalAdminPath(
			sameOriginWrite('http://localhost:8789/api/admin/access-keys', 'http://localhost:8789'),
		);
		const result = await postAccessKeys({ ADMIN_CSRF_SAME_ORIGIN: false }, rewritten);
		assert.equal(result.status, 403);
		assert.equal(result.message, 'Forbidden: invalid Origin');
	});

	it('falls back to the request Origin when the binding is omitted', async () => {
		const matching = sameOriginWrite('http://localhost:8789/admin/access-keys', 'http://localhost:8789');
		const ok = await postAccessKeys({}, matching);
		assert.notEqual(ok.message, 'Forbidden: invalid Origin');
		assert.equal(ok.status, 400);

		const missing = new Request('http://localhost:8789/admin/access-keys', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}',
		});
		const rejected = await postAccessKeys({}, missing);
		assert.equal(rejected.status, 403);
		assert.equal(rejected.message, 'Forbidden: invalid Origin');
	});

	it('does not Origin-check GET list', async () => {
		const response = await app.fetch(new Request('http://localhost:8789/admin/access-keys'), {
			STORAGE_CONTEXT: storage,
			ADMIN_PRINCIPAL: consolePrincipal,
		});
		const body = await response.json() as { success?: boolean; message?: string };
		assert.equal(response.status, 200);
		assert.equal(body.success, true);
	});
});
