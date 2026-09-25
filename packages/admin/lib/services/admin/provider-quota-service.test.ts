import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GatewayRepositories, ProviderRow } from '@octafuse/core';
import { PROVIDER_IMPORT_PENDING_API_KEY } from '@octafuse/core/db/provider-key-utils';
import { AdminServiceError } from './errors';
import { getProviderQuotaService } from './provider-quota-service';

function repositories(provider: ProviderRow | null): GatewayRepositories {
	return {
		providers: {
			getProviderById: async () => provider,
		},
	} as unknown as GatewayRepositories;
}

function provider(overrides: Partial<ProviderRow> = {}): ProviderRow {
	return {
		id: 'deepseek-1',
		name: 'main',
		kind: 'DeepSeek',
		api_key: 'sk-live',
		endpoints: JSON.stringify({
			openai: { endpoints: { chat: 'https://evil.example/chat/completions' } },
		}),
		description: null,
		created_at: '2026-01-01 00:00:00',
		...overrides,
	};
}

describe('getProviderQuotaService', () => {
	it('queries the adapter origin when saved endpoints are on another host', async () => {
		const urls: string[] = [];
		const fetchImpl: typeof fetch = async (input, init) => {
			urls.push(String(input));
			const headers = new Headers(init?.headers);
			assert.equal(headers.get('authorization'), 'Bearer sk-live');
			return Response.json({
				is_available: true,
				balance_infos: [{ currency: 'CNY', total_balance: '9.99', granted_balance: '0', topped_up_balance: '9.99' }],
			});
		};
		const snapshot = await getProviderQuotaService(repositories(provider()), 'deepseek-1', {
			fetchImpl,
			now: () => new Date('2026-09-25T05:00:00.000Z'),
		});
		assert.equal(urls[0], 'https://api.deepseek.com/user/balance');
		assert.equal(snapshot.adapter, 'deepseek');
		assert.equal(snapshot.state, 'ok');
		assert.equal(snapshot.balances[0]?.total, 9.99);
	});

	it('rejects an unsupported kind and a pending key before calling upstream', async () => {
		const fetchImpl: typeof fetch = async () => {
			throw new Error('should not fetch');
		};
		await assert.rejects(
			() =>
				getProviderQuotaService(repositories(provider({ kind: '__custom__' })), 'deepseek-1', { fetchImpl }),
			(error: unknown) => {
				assert.ok(error instanceof AdminServiceError);
				assert.equal(error.status, 400);
				assert.equal(error.message, 'Provider kind does not support quota query');
				return true;
			},
		);
		await assert.rejects(
			() =>
				getProviderQuotaService(
					repositories(provider({ api_key: PROVIDER_IMPORT_PENDING_API_KEY })),
					'deepseek-1',
					{ fetchImpl },
				),
			(error: unknown) => {
				assert.ok(error instanceof AdminServiceError);
				assert.equal(error.status, 400);
				assert.equal(error.message, 'Provider API key is not configured');
				return true;
			},
		);
	});

	it('maps an upstream timeout to 504', async () => {
		const fetchImpl: typeof fetch = async () => {
			const error = new Error('The operation was aborted due to timeout');
			error.name = 'TimeoutError';
			throw error;
		};
		await assert.rejects(
			() => getProviderQuotaService(repositories(provider()), 'deepseek-1', { fetchImpl }),
			(error: unknown) => {
				assert.ok(error instanceof AdminServiceError);
				assert.equal(error.status, 504);
				assert.equal(error.message, 'Upstream quota request timed out');
				return true;
			},
		);
	});

	it('hides the upstream body and reports the status code', async () => {
		const fetchImpl: typeof fetch = async () =>
			Response.json({ error: 'invalid key sk-live' }, { status: 401 });
		await assert.rejects(
			() => getProviderQuotaService(repositories(provider()), 'deepseek-1', { fetchImpl }),
			(error: unknown) => {
				assert.ok(error instanceof AdminServiceError);
				assert.equal(error.status, 502);
				assert.equal(error.message, 'Upstream quota request failed (401)');
				assert.equal(error.message.includes('sk-live'), false);
				return true;
			},
		);
	});
});
