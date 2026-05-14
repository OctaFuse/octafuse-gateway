/**
 * 用户 API 密钥：生成 sk-、每次新建活跃密钥（非幂等）、审计写入 `user_audit_logs`。
 * 预算与周期在 `users`，请先 `getOrCreateUser` / 确保用户存在。
 */
import type { InsertKeyParams } from '../db/api-keys-types';
import {
	snapshotToJson,
	userRowToSnapshot,
} from '../db/user-audit-snapshot';
import type { GatewayRepositories } from '../storage/repositories';
import { createApiKeyWithAudit } from '../storage/critical-write-paths';

const KEY_PREFIX = 'sk-';
const KEY_RANDOM_BYTES = 32;

function generateKey(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = KEY_PREFIX;
	const bytes = new Uint8Array(KEY_RANDOM_BYTES);
	crypto.getRandomValues(bytes);
	for (let i = 0; i < KEY_RANDOM_BYTES; i++) {
		result += chars[bytes[i]! % chars.length];
	}
	return result;
}

function generateId(): string {
	return crypto.randomUUID();
}

/**
 * 在已存在的 `users.id` 下新建一条 active 密钥（不幂等；同一 user 可持有多把 active key）。
 */
export async function createKey(
	repos: GatewayRepositories,
	params: {
		user_id: string;
		name?: string | null;
		metadata?: string | null;
		provision_reason?: string | null;
	}
): Promise<{ key: string; key_id: string }> {
	const u = await repos.users.getById(params.user_id);
	if (!u) {
		throw new Error('createKey: user not found');
	}

	const id = generateId();
	const key = generateKey();

	const insertParams: InsertKeyParams = {
		id,
		key,
		userId: params.user_id,
		name: params.name ?? null,
		metadata: params.metadata ?? null,
		status: 'active',
	};

	const provisionReason =
		typeof params.provision_reason === 'string' && params.provision_reason.trim() !== ''
			? params.provision_reason.trim()
			: 'API key provisioned';

	const auditId = crypto.randomUUID();
	const userSnap = snapshotToJson(userRowToSnapshot(u));
	await createApiKeyWithAudit(repos, {
		insert: insertParams,
		audit: {
			id: auditId,
			apiKeyId: id,
			eventType: 'key_created',
			actorType: 'admin',
			actorId: 'master_key',
			reasonCode: 'key_create',
			reasonText: provisionReason,
			beforeSpent: 0,
			deltaSpent: 0,
			afterSpent: 0,
			beforeBudgetMax: null,
			afterBudgetMax: u.budget_max,
			beforeBudgetPeriod: null,
			afterBudgetPeriod: u.budget_period,
			beforeBudgetResetAt: null,
			afterBudgetResetAt: u.budget_reset_at,
			requestLogId: null,
			metadata: null,
			beforeUserSnapshot: userSnap,
			afterUserSnapshot: userSnap,
			changedFields: null,
			source: 'key_provision',
		},
	});
	return { key, key_id: id };
}

export async function revokeKey(repos: GatewayRepositories, id: string): Promise<boolean> {
	return repos.apiKeys.revokeApiKey(id);
}

export async function updateKeyName(repos: GatewayRepositories, id: string, name: string | null): Promise<boolean> {
	return repos.apiKeys.updateApiKeyName(id, name);
}
