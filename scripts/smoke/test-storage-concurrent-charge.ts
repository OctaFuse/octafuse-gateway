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
