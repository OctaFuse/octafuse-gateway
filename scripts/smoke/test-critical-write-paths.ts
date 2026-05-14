import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { GatewayDatabaseClient } from '../../packages/core/src/storage/database-client';
import {
	createApiKeyWithAudit,
	insertRequestUsageAndChargeTx,
	updateUserBudgetWithAuditTx,
} from '../../packages/core/src/storage/critical-write-paths';

class MockStatement {
	public readonly sqlText: string;
	public binds: unknown[] = [];
	public runResult: { meta: { changes: number } };

	public constructor(sqlText: string, runChanges = 1) {
		this.sqlText = sqlText;
		this.runResult = { meta: { changes: runChanges } };
	}

	public bind(...values: unknown[]): D1PreparedStatement {
		this.binds = values;
		return this as unknown as D1PreparedStatement;
	}

	public async first<T>(): Promise<T | null> {
		return null;
	}

	public async run(): Promise<{ meta: { changes: number } }> {
		return this.runResult;
	}
}

function createMockD1Database(): D1Database & { batches: D1PreparedStatement[][]; preparedSql: string[] } {
	const batches: D1PreparedStatement[][] = [];
	const preparedSql: string[] = [];
	return {
		prepare(sql: string) {
			preparedSql.push(sql);
			return new MockStatement(sql, 1) as unknown as D1PreparedStatement;
		},
		async batch(statements: D1PreparedStatement[]) {
			batches.push(statements);
			return statements.map(() => ({ meta: { changes: 1 } })) as unknown as [];
		},
		dump: async () => new ArrayBuffer(0),
		exec: async () => undefined,
		withSession: () => {
			throw new Error('not implemented in mock');
		},
		get batches() {
			return batches;
		},
		get preparedSql() {
			return preparedSql;
		},
	} as unknown as D1Database & { batches: D1PreparedStatement[][]; preparedSql: string[] };
}

test('createApiKeyWithAudit uses a single d1 batch transaction', async () => {
	const db = createMockD1Database();
	await createApiKeyWithAudit(db, {
		insert: {
			id: 'key-id',
			key: 'sk-test',
			userId: 'user-1',
			status: 'active',
		},
		audit: {
			id: 'audit-id',
			apiKeyId: 'key-id',
			eventType: 'key_created',
			actorType: 'admin',
			beforeSpent: 0,
			deltaSpent: 0,
			afterSpent: 0,
		},
	});
	assert.equal(db.batches.length, 1);
	assert.equal(db.batches[0]?.length, 2);
});

test('updateUserBudgetWithAuditTx runs update then audit batch when changes > 0', async () => {
	const db = createMockD1Database();
	await updateUserBudgetWithAuditTx(db, {
		userId: 'user-1',
		expectedBudgetResetAt: '2026-01-01T00:00:00.000Z',
		budgetSpent: 12.34,
		budgetResetAt: '2026-01-01T00:00:00.000Z',
		apiKeyId: 'key-id',
		audit: {
			eventType: 'period_reset',
			actorType: 'system',
			beforeSpent: 20,
			deltaSpent: -7.66,
			beforeBudgetMax: 10,
			afterBudgetMax: 10,
		},
	});
	assert.ok(db.preparedSql.some((s) => s.includes('UPDATE users')));
	assert.equal(db.batches.length, 1);
	assert.equal(db.batches[0]?.length, 1);
});

test('insertRequestUsageAndChargeTx batches log + budget + audit together', async () => {
	const db = createMockD1Database();
	await insertRequestUsageAndChargeTx(db, {
		userId: 'user-1',
		requestLog: {
			id: 'log-id',
			userId: 'user-1',
			apiKeyId: 'key-id',
			userEmail: 'u@example.com',
			modelId: 'm',
			providerId: 'p',
			providerModelName: 'pm',
			modelName: 'Model',
			providerName: 'Provider',
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
			meteredCost: 0.1,
			standardCost: 0.1,
			chargedCost: 0.2,
			routeGroup: 'default',
			status: 'success',
			latencyMs: 10,
			errorMessage: null,
			rawUsage: null,
		},
		shouldChargeBudget: true,
		beforeSpent: 1,
		chargedCost: 0.2,
		audit: {
			apiKeyId: 'key-id',
			eventType: 'usage_charge',
			actorType: 'system',
			beforeSpent: 1,
			beforeBudgetMax: 10,
			afterBudgetMax: 10,
			beforeBudgetPeriod: 'monthly',
			afterBudgetPeriod: 'monthly',
			beforeBudgetResetAt: '2026-01-01T00:00:00.000Z',
			afterBudgetResetAt: '2026-01-01T00:00:00.000Z',
			requestLogId: 'log-id',
		},
	});
	assert.equal(db.batches.length, 1);
	assert.equal(db.batches[0]?.length, 3);
});

test('postgres branch uses transaction callback', async () => {
	let transactionCalled = false;
	const mockClient = {
		driver: 'postgres',
		raw: {},
		drizzle: {
			transaction: async (work: (tx: { insert: () => { values: () => Promise<void> } }) => Promise<void>) => {
				transactionCalled = true;
				await work({
					insert: () => ({
						values: async () => undefined,
					}),
				});
			},
		},
	} as unknown as GatewayDatabaseClient;

	await createApiKeyWithAudit(mockClient, {
		insert: {
			id: 'key-id',
			key: 'sk-test',
			userId: 'user-1',
			status: 'active',
		},
		audit: {
			id: 'audit-id',
			apiKeyId: 'key-id',
			eventType: 'key_created',
			actorType: 'admin',
			beforeSpent: 0,
			deltaSpent: 0,
			afterSpent: 0,
		},
	});
	assert.equal(transactionCalled, true);
});
