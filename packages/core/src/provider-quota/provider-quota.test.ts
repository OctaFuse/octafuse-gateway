import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deepinfraQuotaAdapter } from './adapters/deepinfra';
import { deepseekQuotaAdapter } from './adapters/deepseek';
import { zaiCodingPlanQuotaAdapter, zhipuCodingPlanQuotaAdapter } from './adapters/glm-coding-plan';
import { minimaxQuotaAdapter } from './adapters/minimax';
import { moonshotQuotaAdapter } from './adapters/moonshot';
import { novitaQuotaAdapter } from './adapters/novita';
import { opencodeGoQuotaAdapter } from './adapters/opencode-go';
import { openrouterQuotaAdapter } from './adapters/openrouter';
import { siliconflowInternationalQuotaAdapter, siliconflowQuotaAdapter } from './adapters/siliconflow';
import { stepfunQuotaAdapter } from './adapters/stepfun';
import { vercelQuotaAdapter } from './adapters/vercel';
import { resolveProviderQuotaOrigin } from './origin';
import { getProviderQuotaAdapter, listProviderQuotaKinds } from './registry';
import { deriveProviderQuotaState } from './state';
import { ProviderQuotaParseError, ProviderQuotaUpstreamError, type ProviderQuotaFetchContext } from './types';

const NOW = () => new Date('2026-09-25T05:00:00.000Z');

function jsonFetch(body: unknown, status = 200): { fetchImpl: typeof fetch; urls: string[] } {
	const urls: string[] = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		urls.push(String(input));
		assert.equal(init?.redirect, 'error');
		const headers = new Headers(init?.headers);
		assert.equal(headers.get('authorization')?.startsWith('Bearer '), true);
		return Response.json(body, { status });
	};
	return { fetchImpl, urls };
}

function ctx(fetchImpl: typeof fetch, origin: string): ProviderQuotaFetchContext {
	return { apiKey: 'sk-test', origin, fetchImpl, now: NOW };
}

describe('deriveProviderQuotaState', () => {
	it('treats a non-positive balance or a full window as exhausted', () => {
		assert.equal(deriveProviderQuotaState({ balances: [{ currency: 'CNY', total: 0 }], windows: [] }), 'exhausted');
		assert.equal(
			deriveProviderQuotaState({
				balances: [{ currency: 'USD', total: 1 }],
				windows: [],
				unavailable: true,
			}),
			'exhausted',
		);
		assert.equal(
			deriveProviderQuotaState({
				balances: [],
				windows: [{ id: 'key_limit', unit: 'currency', usedPercent: 100 }],
			}),
			'exhausted',
		);
	});

	it('treats a window at 90 percent as low and ignores a zero currency beside a positive one', () => {
		assert.equal(
			deriveProviderQuotaState({
				balances: [],
				windows: [{ id: 'key_limit', unit: 'currency', usedPercent: 90 }],
			}),
			'low',
		);
		assert.equal(
			deriveProviderQuotaState({
				balances: [
					{ currency: 'CNY', total: 0 },
					{ currency: 'USD', total: 3 },
				],
				windows: [],
			}),
			'ok',
		);
	});

	it('stays unknown when nothing usable was returned', () => {
		assert.equal(deriveProviderQuotaState({ balances: [], windows: [] }), 'unknown');
	});
});

describe('resolveProviderQuotaOrigin', () => {
	it('uses the first https URL on the adapter domain and ignores other hosts', () => {
		assert.equal(
			resolveProviderQuotaOrigin(
				{
					openai: {
						endpoints: {
							chat: 'https://evil.example/v1/chat/completions',
						},
						base: 'https://api.siliconflow.cn/v1',
					},
				},
				'https://api.siliconflow.cn',
			),
			'https://api.siliconflow.cn',
		);
		assert.equal(
			resolveProviderQuotaOrigin(
				JSON.stringify({
					openai: { endpoints: { chat: 'https://api.deepseek.com/chat/completions' } },
				}),
				'https://api.deepseek.com',
			),
			'https://api.deepseek.com',
		);
	});

	it('falls back when the saved endpoint is http or on another registrable domain', () => {
		assert.equal(
			resolveProviderQuotaOrigin(
				{ openai: { base: 'http://api.siliconflow.cn/v1' } },
				'https://api.siliconflow.cn',
			),
			'https://api.siliconflow.cn',
		);
		assert.equal(
			resolveProviderQuotaOrigin(
				{ openai: { base: 'https://api.siliconflow.com/v1' } },
				'https://api.siliconflow.cn',
			),
			'https://api.siliconflow.cn',
		);
		assert.equal(resolveProviderQuotaOrigin('not-json', 'https://openrouter.ai'), 'https://openrouter.ai');
	});
});

describe('provider quota adapters', () => {
	it('maps DeepSeek balance strings and an unavailable flag', async () => {
		const { fetchImpl, urls } = jsonFetch({
			is_available: false,
			balance_infos: [
				{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
			],
		});
		const snapshot = await deepseekQuotaAdapter.fetch(ctx(fetchImpl, 'https://api.deepseek.com'));
		assert.equal(urls[0], 'https://api.deepseek.com/user/balance');
		assert.equal(snapshot.state, 'exhausted');
		assert.equal(snapshot.checkedAt, '2026-09-25T05:00:00.000Z');
		assert.deepEqual(snapshot.balances, [{ currency: 'CNY', total: 110, granted: 10, paid: 100 }]);
	});

	it('maps Moonshot available, voucher, and cash balances in CNY', async () => {
		const { fetchImpl } = jsonFetch({
			code: 0,
			status: true,
			data: { available_balance: 49.58894, voucher_balance: 46.58893, cash_balance: 3.00001 },
		});
		const snapshot = await moonshotQuotaAdapter.fetch(ctx(fetchImpl, 'https://api.moonshot.cn'));
		assert.equal(snapshot.state, 'ok');
		assert.equal(snapshot.balances[0]?.currency, 'CNY');
		assert.equal(snapshot.balances[0]?.total, 49.58894);
		assert.equal(snapshot.balances[0]?.granted, 46.58893);
		assert.equal(snapshot.balances[0]?.paid, 3.00001);
	});

	it('uses USD when the Moonshot origin is the international host', async () => {
		const { fetchImpl } = jsonFetch({
			data: { available_balance: 1, voucher_balance: 0, cash_balance: 1 },
		});
		const snapshot = await moonshotQuotaAdapter.fetch(ctx(fetchImpl, 'https://api.moonshot.ai'));
		assert.equal(snapshot.balances[0]?.currency, 'USD');
	});

	it('rejects a Moonshot business failure without echoing the body', async () => {
		const { fetchImpl } = jsonFetch({ code: 1, status: false, message: 'sk-secret leaked' });
		await assert.rejects(
			() => moonshotQuotaAdapter.fetch(ctx(fetchImpl, 'https://api.moonshot.cn')),
			(error: unknown) => {
				assert.ok(error instanceof ProviderQuotaUpstreamError);
				assert.equal(error.message, 'Upstream quota request failed (200)');
				assert.equal(error.message.includes('sk-secret'), false);
				return true;
			},
		);
	});

	it('maps SiliconFlow gift and topped-up balances', async () => {
		const { fetchImpl, urls } = jsonFetch({
			code: 20000,
			status: true,
			data: { balance: '0.88', chargeBalance: '88.00', totalBalance: '88.88' },
		});
		const snapshot = await siliconflowQuotaAdapter.fetch(ctx(fetchImpl, 'https://api.siliconflow.cn'));
		assert.equal(urls[0], 'https://api.siliconflow.cn/v1/user/info');
		assert.deepEqual(snapshot.balances, [{ currency: 'CNY', total: 88.88, granted: 0.88, paid: 88 }]);
		const international = jsonFetch({
			code: 20000,
			data: { balance: '1.00', chargeBalance: '2.00', totalBalance: '3.00' },
		});
		const intl = await siliconflowInternationalQuotaAdapter.fetch(
			ctx(international.fetchImpl, 'https://api.siliconflow.com'),
		);
		assert.equal(intl.balances[0]?.currency, 'USD');
	});

	it('maps an OpenRouter key cap and leaves an unlimited key without a percent', async () => {
		const capped = jsonFetch({
			data: { limit: 100, limit_remaining: 74.5, limit_reset: 'monthly', usage: 25.5 },
		});
		const snapshot = await openrouterQuotaAdapter.fetch(ctx(capped.fetchImpl, 'https://openrouter.ai'));
		assert.equal(capped.urls[0], 'https://openrouter.ai/api/v1/key');
		assert.equal(snapshot.state, 'ok');
		assert.equal(snapshot.windows[0]?.id, 'key_limit');
		assert.equal(snapshot.windows[0]?.used, 25.5);
		assert.equal(snapshot.windows[0]?.limit, 100);
		assert.equal(snapshot.windows[0]?.remaining, 74.5);
		assert.equal(snapshot.windows[0]?.usedPercent, 25.5);
		assert.equal(snapshot.windows[0]?.resetsAt, null);

		const unlimited = jsonFetch({ data: { limit: null, limit_remaining: null, usage: 3 } });
		const open = await openrouterQuotaAdapter.fetch(ctx(unlimited.fetchImpl, 'https://openrouter.ai'));
		assert.equal(open.state, 'ok');
		assert.equal(open.windows[0]?.usedPercent, undefined);
		assert.equal(open.windows[0]?.used, 3);
	});

	it('does not include an upstream error body in the failure', async () => {
		const { fetchImpl } = jsonFetch({ error: 'bad key sk-secret' }, 401);
		await assert.rejects(
			() => deepseekQuotaAdapter.fetch(ctx(fetchImpl, 'https://api.deepseek.com')),
			(error: unknown) => {
				assert.ok(error instanceof ProviderQuotaUpstreamError);
				assert.equal(error.status, 401);
				assert.equal(error.message.includes('sk-secret'), false);
				return true;
			},
		);
	});

	it('converts Novita ten-thousandths of a dollar into USD', async () => {
		const { fetchImpl, urls } = jsonFetch({
			availableBalance: '1000000',
			cashBalance: '800000',
			creditLimit: '200000',
			outstandingInvoices: '0',
		});
		const snapshot = await novitaQuotaAdapter.fetch(ctx(fetchImpl, 'https://api.novita.ai'));
		assert.equal(urls[0], 'https://api.novita.ai/openapi/v1/billing/balance/detail');
		assert.deepEqual(snapshot.balances, [{ currency: 'USD', total: 100, paid: 80 }]);
	});

	it('maps DeepInfra prepaid funds and a spend limit, and treats a suspended account as unavailable', async () => {
		const funded = jsonFetch({
			stripe_balance: -12.5,
			recent: 40,
			limit: 100,
			suspended: false,
		});
		const snapshot = await deepinfraQuotaAdapter.fetch(ctx(funded.fetchImpl, 'https://api.deepinfra.com'));
		assert.equal(funded.urls[0], 'https://api.deepinfra.com/payment/checklist');
		assert.equal(snapshot.state, 'ok');
		assert.deepEqual(snapshot.balances, [{ currency: 'USD', total: 12.5 }]);
		assert.equal(snapshot.windows[0]?.id, 'spend_limit');
		assert.equal(snapshot.windows[0]?.used, 40);
		assert.equal(snapshot.windows[0]?.limit, 100);
		assert.equal(snapshot.windows[0]?.usedPercent, 40);

		const suspended = jsonFetch({ stripe_balance: -1, recent: 0, limit: null, suspended: true });
		const blocked = await deepinfraQuotaAdapter.fetch(ctx(suspended.fetchImpl, 'https://api.deepinfra.com'));
		assert.equal(blocked.state, 'exhausted');
	});

	it('reads the StepFun available balance and ignores cumulative top-up totals', async () => {
		const { fetchImpl, urls } = jsonFetch({
			object: 'account',
			type: 'prepaid',
			balance: 3.5,
			total_cash_balance: 100,
			total_voucher_balance: 26,
		});
		const snapshot = await stepfunQuotaAdapter.fetch(ctx(fetchImpl, 'https://api.stepfun.com'));
		assert.equal(urls[0], 'https://api.stepfun.com/v1/accounts');
		assert.deepEqual(snapshot.balances, [{ currency: 'CNY', total: 3.5 }]);
	});

	it('maps OpenCode Go rolling, weekly, and monthly percents, and treats rate-limited as exhausted', async () => {
		const { fetchImpl, urls } = jsonFetch({
			usage: {
				rolling: { status: 'ok', percent: 4, resetsAt: '2026-08-13T16:27:38.287Z' },
				weekly: { status: 'ok', percent: 3, resetsAt: '2026-08-17T00:00:00.287Z' },
				monthly: { status: 'rate-limited', percent: 40, resetsAt: '2026-09-13T06:06:01.287Z' },
			},
		});
		const snapshot = await opencodeGoQuotaAdapter.fetch(ctx(fetchImpl, 'https://opencode.ai'));
		assert.equal(urls[0], 'https://opencode.ai/zen/go/v1/usage');
		assert.equal(snapshot.state, 'exhausted');
		assert.equal(snapshot.windows[0]?.id, '5h');
		assert.equal(snapshot.windows[0]?.usedPercent, 4);
		assert.equal(snapshot.windows[2]?.id, 'monthly');
		assert.equal(snapshot.windows[2]?.usedPercent, 100);
	});

	it('reads MiniMax token-plan remains and treats usage counts as remaining', async () => {
		const { fetchImpl, urls } = jsonFetch({
			base_resp: { status_code: 0, status_msg: '' },
			model_remains: [
				{
					model_name: 'image-01',
					current_interval_total_count: 10,
					current_interval_usage_count: 3,
				},
				{
					model_name: 'general',
					end_time: 1712955600000,
					current_interval_total_count: 200,
					current_interval_usage_count: 187,
					current_weekly_total_count: 1000,
					current_weekly_usage_count: 850,
					weekly_end_time: 1713542400000,
				},
			],
		});
		const snapshot = await minimaxQuotaAdapter.fetch(ctx(fetchImpl, 'https://api.minimaxi.com'));
		assert.equal(urls[0], 'https://www.minimaxi.com/v1/token_plan/remains');
		assert.equal(snapshot.windows[0]?.id, '5h');
		assert.equal(snapshot.windows[0]?.used, 13);
		assert.equal(snapshot.windows[0]?.limit, 200);
		assert.equal(snapshot.windows[0]?.remaining, 187);
		assert.equal(snapshot.windows[1]?.id, 'weekly');
		assert.equal(snapshot.windows[1]?.used, 150);
	});

	it('falls back to MiniMax coding-plan remains when token-plan returns 404', async () => {
		const urls: string[] = [];
		const fetchImpl: typeof fetch = async (input, init) => {
			urls.push(String(input));
			assert.equal(init?.redirect, 'error');
			if (urls.length === 1) return Response.json({ error: 'missing' }, { status: 404 });
			return Response.json({
				model_remains: [
					{
						model_name: 'general',
						current_interval_total_count: 0,
						current_interval_remaining_percent: 99,
						current_weekly_remaining_percent: 0,
					},
				],
			});
		};
		const snapshot = await minimaxQuotaAdapter.fetch(ctx(fetchImpl, 'https://api.minimaxi.com'));
		assert.deepEqual(urls, [
			'https://www.minimaxi.com/v1/token_plan/remains',
			'https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains',
		]);
		assert.equal(snapshot.windows[0]?.usedPercent, 1);
		assert.equal(snapshot.windows[1]?.usedPercent, 100);
		assert.equal(snapshot.state, 'exhausted');
	});

	it('does not send the MiniMax key to another registrable domain', async () => {
		const { fetchImpl, urls } = jsonFetch({});
		await assert.rejects(
			() => minimaxQuotaAdapter.fetch(ctx(fetchImpl, 'https://api.example.com')),
			ProviderQuotaUpstreamError,
		);
		assert.equal(urls.length, 0);
	});

	it('maps Zhipu and Z.AI coding-plan credit windows', async () => {
		const body = {
			code: 200,
			success: true,
			data: {
				limits: [
					{
						type: 'TIME_LIMIT',
						unit: 5,
						number: 1,
						usage: 100,
						percentage: 0,
					},
					{
						type: 'CREDIT_LIMIT',
						unit: 3,
						number: 5,
						usage: 28000,
						percentage: 26,
						nextResetTime: 1786626122911,
					},
					{
						type: 'TOKENS_LIMIT',
						unit: 6,
						number: 1,
						usage: 140000,
						currentValue: 51800,
						remaining: 88200,
						percentage: 37,
						nextResetTime: 1787000000000,
					},
				],
			},
		};
		const zhipu = jsonFetch(body);
		const zhipuSnapshot = await zhipuCodingPlanQuotaAdapter.fetch(ctx(zhipu.fetchImpl, 'https://open.bigmodel.cn'));
		assert.equal(zhipu.urls[0], 'https://open.bigmodel.cn/api/monitor/usage/quota/limit');
		assert.equal(zhipuSnapshot.windows.length, 2);
		assert.equal(zhipuSnapshot.windows[0]?.id, '5h');
		assert.equal(zhipuSnapshot.windows[0]?.limit, 28000);
		assert.equal(zhipuSnapshot.windows[0]?.usedPercent, 26);
		assert.equal(zhipuSnapshot.windows[0]?.used, 7280);
		assert.equal(zhipuSnapshot.windows[1]?.id, 'weekly');
		assert.equal(zhipuSnapshot.windows[1]?.used, 51800);
		assert.equal(zhipuSnapshot.windows[1]?.remaining, 88200);

		const zai = jsonFetch(body);
		const zaiSnapshot = await zaiCodingPlanQuotaAdapter.fetch(ctx(zai.fetchImpl, 'https://api.z.ai'));
		assert.equal(zai.urls[0], 'https://api.z.ai/api/monitor/usage/quota/limit');
		assert.equal(zaiSnapshot.adapter, 'zai-coding-plan');
	});

	it('reads the Vercel AI Gateway credit balance', async () => {
		const { fetchImpl, urls } = jsonFetch({ balance: '95.50', total_used: '4.50' });
		const snapshot = await vercelQuotaAdapter.fetch(ctx(fetchImpl, 'https://ai-gateway.vercel.sh'));
		assert.equal(urls[0], 'https://ai-gateway.vercel.sh/v1/credits');
		assert.deepEqual(snapshot.balances, [{ currency: 'USD', total: 95.5 }]);
		assert.equal(snapshot.windows.length, 0);
	});

	it('rejects a DeepSeek payload without balances', async () => {
		const { fetchImpl } = jsonFetch({ is_available: true, balance_infos: [] });
		await assert.rejects(
			() => deepseekQuotaAdapter.fetch(ctx(fetchImpl, 'https://api.deepseek.com')),
			ProviderQuotaParseError,
		);
	});
});

describe('provider quota registry', () => {
	it('resolves supported kinds and ignores empty or custom kinds', () => {
		assert.equal(getProviderQuotaAdapter('DeepSeek')?.id, 'deepseek');
		assert.equal(getProviderQuotaAdapter('SiliconFlow (International)')?.defaultOrigin, 'https://api.siliconflow.com');
		assert.equal(getProviderQuotaAdapter(''), null);
		assert.equal(getProviderQuotaAdapter('__custom__'), null);
		assert.equal(getProviderQuotaAdapter('Zhipu GLM (Coding Plan)')?.defaultOrigin, 'https://open.bigmodel.cn');
		assert.equal(getProviderQuotaAdapter('Z.AI GLM (Coding Plan)')?.defaultOrigin, 'https://api.z.ai');
		assert.equal(getProviderQuotaAdapter('Kimi Code (Coding API)'), null);
		assert.equal(getProviderQuotaAdapter('Novita AI')?.defaultOrigin, 'https://api.novita.ai');
		assert.deepEqual(listProviderQuotaKinds(), [
			'DeepSeek',
			'Moonshot AI',
			'SiliconFlow',
			'SiliconFlow (International)',
			'OpenRouter',
			'Novita AI',
			'DeepInfra',
			'StepFun',
			'Vercel AI Gateway',
			'OpenCode Go',
			'MiniMax',
			'Zhipu GLM (Coding Plan)',
			'Z.AI GLM (Coding Plan)',
		]);
	});
});
