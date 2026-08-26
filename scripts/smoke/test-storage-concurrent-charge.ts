/**
 * Postgres / MySQL：同一用户下两把 key 并发调用 `insertRequestUsageAndChargeTx`，
 * 验证 `users.budget_spent` 与 Proxy `recordUsage` 相同的 SQL 原子累加路径。
 *
 * 依赖：已迁移的库（`npm run db:migrate:pg` / `db:migrate:mysql`）、`DATABASE_URL`。
 * 未设置 `DATABASE_URL` 时退出码 **0**（跳过，便于仅 D1 的 CI）。
 *
 * ```bash
 * npm run test:gateway:sql-storage-smoke
 * ```
 */
import { pathToFileURL } from 'node:url';
import type { InsertRequestLogParams } from '../../packages/core/src/db/request-logs-types';
import { resolveNodeDatabaseConfig } from '../../packages/core/src/storage/runtime-database-config';
import {
	PRICING_AUDIT_JSON_SCHEMA_VERSION,
	changedFieldsToJson,
	computeChangedFields,
	createKey,
	getOrCreateUser,
	getUserBudgetSnapshot,
	grantWalletCreditWithAuditTx,
	insertRequestUsageAndChargeTx,
	roundGatewayMoney,
	snapshotToJson,
	snapshotWithOverrides,
	userRowToSnapshot,
} from '../../packages/core/src/index.ts';
import type { UserRow } from '../../packages/core/src/types.ts';

function pricingAuditStub(): string {
	return JSON.stringify({
		v: PRICING_AUDIT_JSON_SCHEMA_VERSION,
		basis_tokens: 1,
		snapshot: { supplier: {}, standard: {}, user_charge: {} },
	});
}

function buildUsageAudit(userRow: UserRow, beforeSpent: number, charged: number, apiKeyId: string, requestLogId: string) {
	const afterSpent = roundGatewayMoney(beforeSpent + charged);
	const beforeS = userRowToSnapshot(userRow);
	const afterS = snapshotWithOverrides(beforeS, { budget_spent: afterSpent });
	return {
		apiKeyId,
		eventType: 'usage_charge' as const,
		actorType: 'system' as const,
		reasonCode: 'request_usage_charged_cost',
		reasonText: 'storage smoke concurrent charge',
		beforeSpent,
		beforeBudgetMax: userRow.budget_max,
		afterBudgetMax: userRow.budget_max,
		beforeBudgetPeriod: userRow.budget_period,
		afterBudgetPeriod: userRow.budget_period,
		beforeBudgetResetAt: userRow.budget_reset_at,
		afterBudgetResetAt: userRow.budget_reset_at,
		requestLogId,
		metadata: null,
		beforeUserSnapshot: snapshotToJson(beforeS),
		afterUserSnapshot: snapshotToJson(afterS),
		changedFields: changedFieldsToJson(computeChangedFields(beforeS, afterS)),
		correlationId: requestLogId,
		source: 'gateway_usage',
	};
}

function buildRequestLog(params: {
	id: string;
	userId: string;
	apiKeyId: string;
	charged: number;
}): InsertRequestLogParams {
	const c = roundGatewayMoney(params.charged);
	return {
		id: params.id,
		userId: params.userId,
		apiKeyId: params.apiKeyId,
		userEmail: 'storage-smoke@local',
		modelId: 'smoke-model',
		providerId: 'smoke-provider',
		providerModelName: 'smoke',
		modelName: 'Smoke',
		providerName: 'Smoke',
		requestBody: '{}',
		upstreamRequestBody: '{}',
		requestProtocol: 'openai',
		upstreamProtocol: 'openai',
		inputTokens: 1,
		outputTokens: 1,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		reasoningTokens: 0,
		totalTokens: 2,
		meteredCost: c,
		standardCost: c,
		chargedCost: c,
		routeGroup: 'default',
		status: 'success',
		latencyMs: 1,
		errorMessage: null,
		rawUsage: null,
		pricingAudit: pricingAuditStub(),
	};
}

export async function runStorageConcurrentChargeSmoke(): Promise<void> {
	const tag = '[gateway-sql-storage-smoke]';
	let cfg: ReturnType<typeof resolveNodeDatabaseConfig>;
	try {
		cfg = resolveNodeDatabaseConfig({
			DATABASE_URL: process.env.DATABASE_URL,
			DATABASE_DRIVER: process.env.DATABASE_DRIVER,
		});
	} catch {
		console.log('%s skip: DATABASE_URL unset or invalid for Node SQL', tag);
		return;
	}
	const url = cfg.connectionString;
	const driver = cfg.driver;

	const { createPostgresStorageContext, createMySqlStorageContext } = await import(
		'../../packages/core/src/storage/context.ts'
	);
	const ctx =
		driver === 'mysql'
			? await createMySqlStorageContext(url)
			: await createPostgresStorageContext(url);

	const repos = ctx.repositories;
	const ext = `smoke-${Date.now()}`;
	const user = await getOrCreateUser(repos, {
		external_system: 'gateway-storage-smoke',
		external_user_id: ext,
		email: `${ext}@smoke.local`,
		budget_max: 1_000_000,
		budget_period: 'none',
		budget_base: 0,
		metadata: null,
	});

	const k1 = await createKey(repos, { user_id: user.id, name: 'c1', provision_reason: tag });
	const k2 = await createKey(repos, { user_id: user.id, name: 'c2', provision_reason: tag });

	const u0 = await repos.users.getById(user.id);
	if (!u0) throw new Error('user missing after create');
	const snap0 = await getUserBudgetSnapshot(repos, user.id);
	const spent0 = snap0?.budgetSpent ?? 0;

	const c1 = 0.05;
	const c2 = 0.07;
	const log1 = crypto.randomUUID();
	const log2 = crypto.randomUUID();

	await Promise.all([
		insertRequestUsageAndChargeTx(repos, {
			userId: user.id,
			requestLog: buildRequestLog({
				id: log1,
				userId: user.id,
				apiKeyId: k1.key_id,
				charged: c1,
			}),
			shouldChargeBudget: true,
			beforeSpent: spent0,
			chargedCost: c1,
			audit: buildUsageAudit(u0, spent0, c1, k1.key_id, log1),
		}),
		insertRequestUsageAndChargeTx(repos, {
			userId: user.id,
			requestLog: buildRequestLog({
				id: log2,
				userId: user.id,
				apiKeyId: k2.key_id,
				charged: c2,
			}),
			shouldChargeBudget: true,
			beforeSpent: spent0,
			chargedCost: c2,
			audit: buildUsageAudit(u0, spent0, c2, k2.key_id, log2),
		}),
	]);

	const snap1 = await getUserBudgetSnapshot(repos, user.id);
	const expected = roundGatewayMoney(spent0 + c1 + c2);
	if (!snap1 || roundGatewayMoney(snap1.budgetSpent) !== expected) {
		throw new Error(
			`${tag} budget_spent mismatch: want ${expected}, got ${snap1?.budgetSpent ?? 'null'} (user=${user.id})`
		);
	}
	console.log('%s concurrent charge ok (budget_spent=%s)', tag, expected);

	const grantRef = `smoke-wallet-${ext}`;
	const grant1 = await grantWalletCreditWithAuditTx(repos, {
		userId: user.id,
		amount: 5,
		kind: 'topup',
		externalRef: grantRef,
		reason: 'storage smoke wallet grant',
		source: 'admin_wallet',
	});
	const grant2 = await grantWalletCreditWithAuditTx(repos, {
		userId: user.id,
		amount: 5,
		kind: 'topup',
		externalRef: grantRef,
		reason: 'storage smoke wallet grant replay',
		source: 'admin_wallet',
	});
	if (grant1.status !== 'applied' || grant2.status !== 'duplicate') {
		throw new Error(`${tag} wallet grant idempotency: first=${grant1.status} second=${grant2.status}`);
	}
	if (grant1.walletGranted !== grant2.walletGranted) {
		throw new Error(
			`${tag} wallet grant replay changed granted: ${grant1.walletGranted} vs ${grant2.walletGranted}`
		);
	}
	console.log('%s wallet grant idempotent ok (granted=%s)', tag, grant1.walletGranted);

	const crossExt = `${ext}-cross`;
	const crossUser = await getOrCreateUser(repos, {
		external_system: 'gateway-storage-smoke',
		external_user_id: crossExt,
		email: `${crossExt}@smoke.local`,
		budget_max: 0.1,
		budget_period: 'none',
		budget_base: 0.1,
		metadata: null,
	});
	await grantWalletCreditWithAuditTx(repos, {
		userId: crossUser.id,
		amount: 2,
		kind: 'topup',
		externalRef: `smoke-cross-wallet-${ext}`,
		reason: 'storage smoke cross-pool wallet',
		source: 'admin_wallet',
	});
	const crossRow = await repos.users.getById(crossUser.id);
	if (!crossRow) throw new Error('cross-pool user missing');
	const k3 = await createKey(repos, { user_id: crossUser.id, name: 'c3', provision_reason: tag });
	const k4 = await createKey(repos, { user_id: crossUser.id, name: 'c4', provision_reason: tag });
	const periodCharge = 0.1;
	const walletCharge = 0.08;
	const log3 = crypto.randomUUID();
	const log4 = crypto.randomUUID();
	await Promise.all([
		insertRequestUsageAndChargeTx(repos, {
			userId: crossUser.id,
			requestLog: buildRequestLog({
				id: log3,
				userId: crossUser.id,
				apiKeyId: k3.key_id,
				charged: periodCharge,
			}),
			shouldChargeBudget: true,
			beforeSpent: 0,
			chargedCost: periodCharge,
			chargedFromWallet: 0,
			audit: buildUsageAudit(crossRow, 0, periodCharge, k3.key_id, log3),
		}),
		insertRequestUsageAndChargeTx(repos, {
			userId: crossUser.id,
			requestLog: buildRequestLog({
				id: log4,
				userId: crossUser.id,
				apiKeyId: k4.key_id,
				charged: walletCharge,
			}),
			shouldChargeBudget: true,
			beforeSpent: 0,
			chargedCost: walletCharge,
			chargedFromWallet: walletCharge,
			audit: buildUsageAudit(crossRow, 0, walletCharge, k4.key_id, log4),
		}),
	]);
	const crossSnap = await getUserBudgetSnapshot(repos, crossUser.id);
	const wantBudget = roundGatewayMoney(periodCharge);
	const wantWallet = roundGatewayMoney(walletCharge);
	if (!crossSnap || roundGatewayMoney(crossSnap.budgetSpent) !== wantBudget) {
		throw new Error(
			`${tag} cross-pool budget_spent mismatch: want ${wantBudget}, got ${crossSnap?.budgetSpent ?? 'null'}`
		);
	}
	if (roundGatewayMoney(crossSnap.walletSpent) !== wantWallet) {
		throw new Error(
			`${tag} cross-pool wallet_spent mismatch: want ${wantWallet}, got ${crossSnap.walletSpent}`
		);
	}
	console.log(
		'%s concurrent cross-pool charge ok (budget_spent=%s wallet_spent=%s)',
		tag,
		wantBudget,
		wantWallet
	);

	await repos.users.deleteUserHard(crossUser.id);
	await repos.users.deleteUserHard(user.id);
	console.log('%s cleanup deleteUserHard ok', tag);

	if (ctx.client.driver === 'postgres') {
		await ctx.client.raw.end({ timeout: 5 });
	} else {
		await ctx.client.raw.end();
	}
	console.log('%s done', tag);
}

async function main(): Promise<void> {
	await runStorageConcurrentChargeSmoke();
}

const isMainModule =
	typeof process.argv[1] === 'string' &&
	import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
	main().catch((err) => {
		console.error('[gateway-sql-storage-smoke]', err);
		process.exit(1);
	});
}
