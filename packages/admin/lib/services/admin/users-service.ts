/**
 * 管理端 `/admin/users`：列表、按外部对幂等创建、详情（懒重置预算）、计划/资料 PATCH、
 * 物理删除、子资源 keys / request-logs / audit-logs。
 */
import type { BudgetPeriod, GatewayRepositories } from '@octafuse/core';
import { createKey, revokeKey, updateKeyName } from '@octafuse/core/services/key-service';
import {
	computeFirstReset,
	getKeyInfo,
	getOrCreateUser,
	getUserInfo,
	replaceKeyMetadata,
	updateKeyMetadata,
	updateKeyStatus,
	updateUserPlan,
} from '@octafuse/core/services/user-service';
import { insertParamsFromFullLegacy } from '@octafuse/core/db/user-audit-legacy-mapper';
import { roundGatewayMoney } from '@octafuse/core/lib/money-precision';
import { badRequest, notFound } from './errors';
import { normalizeMetadataInput } from './shared';
import type { AdminUserCreateInput, AdminUserUpdateInput, JsonObject } from './types';

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * `:id` 为 uuid，或 `ext:` + `urlencode(system)` + `/` + `urlencode(external_user_id)`，
 * 或 `ext:` + `urlencode(system)` + `\x1f` + `urlencode(external_user_id)`（推荐，避免 system 含 `/` 歧义）。
 */
export function parseAdminUserRouteId(
	raw: string
): { kind: 'uuid'; id: string } | { kind: 'external'; externalSystem: string; externalUserId: string } | null {
	const id = raw.trim();
	if (!id) return null;
	if (UUID_RE.test(id)) return { kind: 'uuid', id };
	if (!id.startsWith('ext:')) return null;
	const rest = id.slice(4);
	const unit = '\x1f';
	if (rest.includes(unit)) {
		const [a, b] = rest.split(unit);
		if (!a || b === undefined) return null;
		try {
			return { kind: 'external', externalSystem: decodeURIComponent(a), externalUserId: decodeURIComponent(b) };
		} catch {
			return null;
		}
	}
	const slash = rest.indexOf('/');
	if (slash < 0) return null;
	try {
		return {
			kind: 'external',
			externalSystem: decodeURIComponent(rest.slice(0, slash)),
			externalUserId: decodeURIComponent(rest.slice(slash + 1)),
		};
	} catch {
		return null;
	}
}

export async function resolveAdminUserId(repos: GatewayRepositories, raw: string): Promise<string> {
	const parsed = parseAdminUserRouteId(raw);
	if (!parsed) throw notFound('User not found');
	if (parsed.kind === 'uuid') {
		const u = await repos.users.getById(parsed.id);
		if (!u) throw notFound('User not found');
		return u.id;
	}
	const u = await repos.users.getByExternalPair(parsed.externalSystem, parsed.externalUserId);
	if (!u) throw notFound('User not found');
	return u.id;
}

export async function listAdminUsers(
	repos: GatewayRepositories,
	input: {
		page?: number;
		page_size?: number;
		email?: string;
		external_system?: string;
		external_user_id?: string;
		max_budget?: string;
		status?: string;
	}
) {
	const page = Number.isFinite(input.page) ? Number(input.page) : 1;
	const pageSize = Number.isFinite(input.page_size) ? Number(input.page_size) : 20;
	const maxBudget = input.max_budget;
	const { users, total } = await repos.users.list({
		email: input.email,
		externalSystem: input.external_system,
		externalUserId: input.external_user_id,
		status: input.status,
		maxBudget:
			maxBudget === 'positive' || maxBudget === 'zero_or_negative' || maxBudget === 'null' ? maxBudget : undefined,
		page,
		pageSize,
	});
	const data = await Promise.all(
		users.map(async (u) => {
			const keys = await repos.apiKeys.listKeysByUserId(u.id, { status: 'active' });
			return {
				...u,
				active_keys_count: keys.length,
			};
		})
	);
	return { data, total: Number(total), page, page_size: pageSize };
}

export async function createAdminUser(repos: GatewayRepositories, input: AdminUserCreateInput) {
	const emailTrim = String(input.email ?? '').trim();
	if (!emailTrim) {
		throw badRequest('email is required');
	}
	const budget_period = (input.budget_period ?? 'none') as BudgetPeriod;
	const budget_max = input.budget_max === undefined ? 0 : input.budget_max;
	const budget_base =
		input.budget_base === undefined ? (budget_max == null ? 0 : roundGatewayMoney(Number(budget_max))) : roundGatewayMoney(Number(input.budget_base ?? 0));

	let metaString: string | null = null;
	if (input.metadata !== undefined && input.metadata !== null) {
		if (typeof input.metadata === 'string') {
			const parsed = normalizeMetadataInput(input.metadata);
			if (!parsed.ok) throw badRequest(parsed.message);
			metaString = parsed.value;
		} else if (typeof input.metadata === 'object' && !Array.isArray(input.metadata)) {
			try {
				metaString = JSON.stringify(input.metadata);
			} catch {
				throw badRequest('metadata must be JSON-serializable');
			}
		} else {
			throw badRequest('metadata must be a JSON object or JSON string');
		}
	}

	const user = await getOrCreateUser(repos, {
		external_system: input.external_system ?? null,
		external_user_id: input.external_user_id ?? null,
		email: emailTrim,
		budget_max,
		budget_period,
		budget_base,
		metadata: metaString,
	});

	const info = await getUserInfo(repos, user.id);
	if (!info) throw notFound('User not found');
	return info;
}

export async function getAdminUserByRouteId(repos: GatewayRepositories, raw: string) {
	const userId = await resolveAdminUserId(repos, raw);
	const info = await getUserInfo(repos, userId);
	if (!info) throw notFound('User not found');
	return info;
}

function parseMetadataSnapshot(raw: string | null | undefined): unknown {
	if (raw == null || raw === '') return null;
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return raw;
	}
}

function isPlainObject(value: unknown): value is JsonObject {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function metadataValueEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function buildMetadataAuditChange(
	beforeRaw: string | null | undefined,
	afterRaw: string | null | undefined,
	operation: 'merge' | 'replace' | 'update',
	touchedKeys?: string[]
): JsonObject {
	const before = parseMetadataSnapshot(beforeRaw);
	const after = parseMetadataSnapshot(afterRaw);
	if (!isPlainObject(before) || !isPlainObject(after)) {
		return { operation, from: before, to: after };
	}
	const keys =
		touchedKeys && touchedKeys.length > 0
			? touchedKeys
			: Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
	const changes: JsonObject = {};
	for (const key of keys) {
		if (metadataValueEqual(before[key], after[key])) continue;
		changes[key] = { from: before[key] ?? null, to: after[key] ?? null };
	}
	return Object.keys(changes).length > 0 ? { operation, changes } : { operation, from: before, to: after };
}

export async function updateAdminUser(repos: GatewayRepositories, raw: string, input: AdminUserUpdateInput) {
	const userId = await resolveAdminUserId(repos, raw);
	const row = await repos.users.getById(userId);
	if (!row) throw notFound('User not found');

	const budget_max_in = input.budget_max;
	const budget_base_in = input.budget_base;
	const budget_period_in = input.budget_period;
	const budget_spent_in = input.budget_spent;
	const hasBudgetField =
		budget_max_in !== undefined ||
		budget_base_in !== undefined ||
		budget_period_in !== undefined ||
		budget_spent_in !== undefined ||
		input.reset_budget !== undefined ||
		input.budget_reset_at !== undefined;

	let metadataReplaceStr: string | null | undefined;
	const rawReplace = input.metadata_replace !== undefined ? input.metadata_replace : undefined;
	if (rawReplace !== undefined) {
		const parsed = normalizeMetadataInput(rawReplace);
		if (!parsed.ok) throw badRequest(parsed.message);
		metadataReplaceStr = parsed.value;
	} else if (input.metadata !== undefined && typeof input.metadata === 'string') {
		const parsed = normalizeMetadataInput(input.metadata);
		if (!parsed.ok) throw badRequest(parsed.message);
		metadataReplaceStr = parsed.value;
	}

	const hasMetaObjectMerge =
		input.metadata !== undefined &&
		typeof input.metadata === 'object' &&
		input.metadata !== null &&
		!Array.isArray(input.metadata);

	const hasStatus = input.status !== undefined;
	const hasMetaReplace = metadataReplaceStr !== undefined;
	const userEmailRaw = input.email;
	const hasEmail = userEmailRaw !== undefined;
	const nextEmail =
		userEmailRaw === undefined || userEmailRaw === null
			? null
			: String(userEmailRaw).trim() === ''
				? null
				: String(userEmailRaw).trim().toLowerCase();

	if (!hasBudgetField && !hasMetaObjectMerge && !hasMetaReplace && !hasStatus && !hasEmail) {
		throw badRequest(
			'Provide at least one of email, budget_max, budget_base, budget_spent, budget_period, reset_budget, budget_reset_at, metadata, metadata_replace, status'
		);
	}

	if (hasMetaObjectMerge && hasMetaReplace) {
		throw badRequest('Use either metadata (object merge or string replace) or metadata_replace, not both');
	}

	if (hasStatus) {
		await repos.users.updateUserStatus(userId, String(input.status));
	}
	if (hasEmail) {
		if (nextEmail === null) {
			throw badRequest('email cannot be empty');
		}
		const ok = await repos.users.setUserEmailById(userId, nextEmail);
		if (!ok) throw new Error('Failed to update user');
	}

	if (hasMetaObjectMerge && !hasBudgetField && !hasMetaReplace) {
		const existing: JsonObject = row.metadata ? (JSON.parse(row.metadata) as JsonObject) : {};
		const merged = JSON.stringify({ ...existing, ...(input.metadata as JsonObject) });
		const ok = await repos.users.setUserMetadataById(userId, merged);
		if (!ok) throw new Error('Failed to update user');
	} else if (hasBudgetField || hasMetaReplace) {
		const effMax = budget_max_in === undefined ? row.budget_max : budget_max_in;
		const effPeriod = (budget_period_in ?? row.budget_period) as BudgetPeriod;
		let mergedMetadataJson: string | null | undefined;
		if (hasMetaReplace) {
			mergedMetadataJson = metadataReplaceStr ?? undefined;
		} else if (hasMetaObjectMerge && input.metadata) {
			const existing: JsonObject = row.metadata ? (JSON.parse(row.metadata) as JsonObject) : {};
			mergedMetadataJson = JSON.stringify({ ...existing, ...(input.metadata as JsonObject) });
		}

		let resolvedBudgetResetAt: string | null;
		if (input.budget_reset_at !== undefined) {
			resolvedBudgetResetAt = input.budget_reset_at;
		} else if (budget_period_in !== undefined && budget_period_in !== row.budget_period) {
			if (budget_period_in === 'none') {
				resolvedBudgetResetAt = null;
			} else {
				resolvedBudgetResetAt = computeFirstReset(budget_period_in as BudgetPeriod);
			}
		} else {
			resolvedBudgetResetAt = row.budget_reset_at ?? null;
		}

		let resolvedResetBudget: boolean;
		if (input.reset_budget !== undefined) {
			resolvedResetBudget = input.reset_budget;
		} else if (budget_period_in === undefined && input.budget_reset_at === undefined) {
			resolvedResetBudget = false;
		} else {
			resolvedResetBudget = true;
		}

		const ok = await updateUserPlan(repos, userId, {
			budget_max: effMax,
			budget_period: effPeriod,
			reset_budget: resolvedResetBudget,
			budget_reset_at: resolvedBudgetResetAt,
			metadata: mergedMetadataJson,
			budget_spent: budget_spent_in,
			budget_base: budget_base_in,
		});
		if (!ok) throw new Error('Failed to update user');
	}

	const rowAfter = await repos.users.getById(userId);
	if (!rowAfter) throw notFound('User not found');

	const reasonText =
		typeof input.reason === 'string' && input.reason.trim() !== '' ? input.reason.trim() : 'Admin update';

	const budgetChanged =
		Number(rowAfter.budget_spent ?? 0) !== Number(row.budget_spent ?? 0) ||
		Number(rowAfter.budget_max ?? 0) !== Number(row.budget_max ?? 0) ||
		Number(rowAfter.budget_base ?? 0) !== Number(row.budget_base ?? 0) ||
		(rowAfter.budget_period ?? null) !== (row.budget_period ?? null) ||
		(rowAfter.budget_reset_at ?? null) !== (row.budget_reset_at ?? null);

	const metadataChanged = (row.metadata ?? '') !== (rowAfter.metadata ?? '');
	const statusChanged = (row.status ?? '') !== (rowAfter.status ?? '');
	const emailChanged = (row.email ?? null) !== (rowAfter.email ?? null);

	let profileAuditPayload: Record<string, unknown> | null = null;
	if (metadataChanged || statusChanged || emailChanged) {
		profileAuditPayload = {};
		if (emailChanged) {
			profileAuditPayload.email = { from: row.email ?? null, to: rowAfter.email ?? null };
		}
		if (statusChanged) {
			profileAuditPayload.status = { from: row.status ?? null, to: rowAfter.status ?? null };
		}
		if (metadataChanged) {
			let operation: 'merge' | 'replace' | 'update' = 'update';
			let touchedKeys: string[] | undefined;
			if (hasMetaObjectMerge && input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)) {
				operation = 'merge';
				touchedKeys = Object.keys(input.metadata as JsonObject);
			} else if (hasMetaReplace || (input.metadata !== undefined && typeof input.metadata === 'string')) {
				operation = 'replace';
			}
			profileAuditPayload.metadata = buildMetadataAuditChange(row.metadata, rowAfter.metadata, operation, touchedKeys);
		}
	}

	const profileAuditJson =
		profileAuditPayload && Object.keys(profileAuditPayload).length > 0 ? JSON.stringify(profileAuditPayload) : null;

	if (budgetChanged) {
		await repos.userAuditLogs.insertUserAuditLog(
			insertParamsFromFullLegacy(userId, {
				id: crypto.randomUUID(),
				apiKeyId: null,
				eventType: 'admin_adjust',
				actorType: 'admin',
				actorId: 'master_key',
				reasonCode: 'admin_patch_budget',
				reasonText: reasonText,
				beforeSpent: Number(row.budget_spent ?? 0),
				deltaSpent: Number(rowAfter.budget_spent ?? 0) - Number(row.budget_spent ?? 0),
				afterSpent: Number(rowAfter.budget_spent ?? 0),
				beforeBudgetMax: row.budget_max ?? null,
				afterBudgetMax: rowAfter.budget_max ?? null,
				beforeBudgetBase: row.budget_base ?? null,
				afterBudgetBase: rowAfter.budget_base ?? null,
				beforeBudgetPeriod: row.budget_period ?? null,
				afterBudgetPeriod: rowAfter.budget_period ?? null,
				beforeBudgetResetAt: row.budget_reset_at ?? null,
				afterBudgetResetAt: rowAfter.budget_reset_at ?? null,
				metadata: profileAuditJson,
			})
		);
	} else if (metadataChanged || statusChanged || emailChanged) {
		let reasonCode = 'admin_patch_profile';
		if (metadataChanged && !statusChanged && !emailChanged) reasonCode = 'admin_patch_metadata';
		else if (statusChanged && !metadataChanged && !emailChanged) reasonCode = 'admin_patch_status';
		else if (emailChanged && !metadataChanged && !statusChanged) reasonCode = 'admin_patch_email';
		const spent = Number(rowAfter.budget_spent ?? 0);
		const bmax = rowAfter.budget_max ?? null;
		const bbase = rowAfter.budget_base ?? null;
		const bperiod = rowAfter.budget_period ?? null;
		const breset = rowAfter.budget_reset_at ?? null;
		await repos.userAuditLogs.insertUserAuditLog(
			insertParamsFromFullLegacy(userId, {
				id: crypto.randomUUID(),
				apiKeyId: null,
				eventType: 'admin_adjust',
				actorType: 'admin',
				actorId: 'master_key',
				reasonCode,
				reasonText: reasonText,
				beforeSpent: spent,
				deltaSpent: 0,
				afterSpent: spent,
				beforeBudgetMax: bmax,
				afterBudgetMax: bmax,
				beforeBudgetBase: bbase,
				afterBudgetBase: bbase,
				beforeBudgetPeriod: bperiod,
				afterBudgetPeriod: bperiod,
				beforeBudgetResetAt: breset,
				afterBudgetResetAt: breset,
				metadata: profileAuditJson,
			})
		);
	}

	return getUserInfo(repos, userId);
}

export async function deleteAdminUser(repos: GatewayRepositories, raw: string): Promise<void> {
	const userId = await resolveAdminUserId(repos, raw);
	const ok = await repos.users.deleteUserHard(userId);
	if (!ok) throw notFound('User not found');
}

export async function listAdminUserKeys(repos: GatewayRepositories, raw: string) {
	const userId = await resolveAdminUserId(repos, raw);
	return repos.apiKeys.listKeysByUserId(userId);
}

export async function createAdminUserKey(
	repos: GatewayRepositories,
	raw: string,
	input: { name?: string | null; metadata?: unknown; reason?: string }
) {
	const userId = await resolveAdminUserId(repos, raw);
	let metaString: string | null = null;
	if (input.metadata !== undefined && input.metadata !== null) {
		if (typeof input.metadata === 'string') {
			const parsed = normalizeMetadataInput(input.metadata);
			if (!parsed.ok) throw badRequest(parsed.message);
			metaString = parsed.value;
		} else if (typeof input.metadata === 'object' && !Array.isArray(input.metadata)) {
			try {
				metaString = JSON.stringify(input.metadata);
			} catch {
				throw badRequest('metadata must be JSON-serializable');
			}
		} else {
			throw badRequest('metadata must be a JSON object or JSON string');
		}
	}
	return createKey(repos, {
		user_id: userId,
		name: input.name ?? null,
		metadata: metaString,
		provision_reason: input.reason,
	});
}

async function assertKeyBelongsToUser(repos: GatewayRepositories, userId: string, keyId: string) {
	const row = await repos.apiKeys.getApiKeyWithUserById(keyId);
	if (!row || row.user_id !== userId) throw notFound('Key not found');
	return row;
}

export async function deleteAdminUserKey(repos: GatewayRepositories, rawUser: string, keyId: string): Promise<void> {
	const userId = await resolveAdminUserId(repos, rawUser);
	const row = await assertKeyBelongsToUser(repos, userId, keyId);
	const ok = await repos.apiKeys.deleteApiKeyHard(keyId, row.key);
	if (!ok) throw notFound('Key not found');
}

export type AdminUserKeyPatchInput = {
	name?: string | null;
	status?: string;
	metadata?: unknown;
	metadata_replace?: unknown;
	reason?: string;
};

export async function patchAdminUserKey(
	repos: GatewayRepositories,
	rawUser: string,
	keyId: string,
	input: AdminUserKeyPatchInput
) {
	const userId = await resolveAdminUserId(repos, rawUser);
	const row = await assertKeyBelongsToUser(repos, userId, keyId);

	const hasBudget =
		(input as Record<string, unknown>).budget_max !== undefined ||
		(input as Record<string, unknown>).budget_base !== undefined ||
		(input as Record<string, unknown>).budget_period !== undefined ||
		(input as Record<string, unknown>).budget_spent !== undefined;
	if (hasBudget) throw badRequest('budget fields belong on /admin/users; use PATCH /admin/users/:id');

	let metadataReplaceStr: string | null | undefined;
	if (input.metadata_replace !== undefined) {
		const parsed = normalizeMetadataInput(input.metadata_replace);
		if (!parsed.ok) throw badRequest(parsed.message);
		metadataReplaceStr = parsed.value;
	} else if (input.metadata !== undefined && typeof input.metadata === 'string') {
		const parsed = normalizeMetadataInput(input.metadata);
		if (!parsed.ok) throw badRequest(parsed.message);
		metadataReplaceStr = parsed.value;
	}

	const hasMetaObjectMerge =
		input.metadata !== undefined &&
		typeof input.metadata === 'object' &&
		input.metadata !== null &&
		!Array.isArray(input.metadata);

	if (hasMetaObjectMerge && metadataReplaceStr !== undefined) {
		throw badRequest('Use either metadata (object merge or string replace) or metadata_replace, not both');
	}

	if (input.name !== undefined) {
		await updateKeyName(repos, keyId, input.name ?? null);
	}
	if (input.status !== undefined) {
		const st = String(input.status);
		if (st === 'revoked') await revokeKey(repos, keyId);
		else await updateKeyStatus(repos, keyId, st);
	}
	if (hasMetaObjectMerge) {
		await updateKeyMetadata(repos, keyId, input.metadata as JsonObject);
	} else if (metadataReplaceStr !== undefined) {
		await replaceKeyMetadata(repos, keyId, metadataReplaceStr);
	}

	const reasonText =
		typeof input.reason === 'string' && input.reason.trim() !== '' ? input.reason.trim() : 'Admin key patch';

	const rowAfter = await repos.apiKeys.getApiKeyWithUserById(keyId);
	if (!rowAfter) throw notFound('Key not found');

	const metadataChanged = (row.metadata ?? '') !== (rowAfter.metadata ?? '');
	const statusChanged = (row.status ?? '') !== (rowAfter.status ?? '');
	const nameChanged = (row.name ?? null) !== (rowAfter.name ?? null);

	if (metadataChanged || statusChanged || nameChanged) {
		let profileAuditPayload: Record<string, unknown> = {};
		if (nameChanged) profileAuditPayload.name = { from: row.name ?? null, to: rowAfter.name ?? null };
		if (statusChanged) profileAuditPayload.status = { from: row.status ?? null, to: rowAfter.status ?? null };
		if (metadataChanged) {
			let operation: 'merge' | 'replace' | 'update' = 'update';
			let touchedKeys: string[] | undefined;
			if (hasMetaObjectMerge && input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)) {
				operation = 'merge';
				touchedKeys = Object.keys(input.metadata as JsonObject);
			} else if (metadataReplaceStr !== undefined || (input.metadata !== undefined && typeof input.metadata === 'string')) {
				operation = 'replace';
			}
			profileAuditPayload.metadata = buildMetadataAuditChange(row.metadata, rowAfter.metadata, operation, touchedKeys);
		}
		const spent = Number(rowAfter.budget_spent ?? 0);
		const bmax = rowAfter.budget_max ?? null;
		const bbase = rowAfter.budget_base ?? null;
		const bperiod = rowAfter.budget_period ?? null;
		const breset = rowAfter.budget_reset_at ?? null;
		let reasonCode = 'admin_patch_key_profile';
		if (metadataChanged && !statusChanged && !nameChanged) reasonCode = 'admin_patch_key_metadata';
		else if (statusChanged && !metadataChanged && !nameChanged) reasonCode = 'admin_patch_key_status';
		else if (nameChanged && !metadataChanged && !statusChanged) reasonCode = 'admin_patch_key_name';

		await repos.userAuditLogs.insertUserAuditLog(
			insertParamsFromFullLegacy(userId, {
				id: crypto.randomUUID(),
				apiKeyId: keyId,
				eventType: 'admin_adjust',
				actorType: 'admin',
				actorId: 'master_key',
				reasonCode,
				reasonText: reasonText,
				beforeSpent: spent,
				deltaSpent: 0,
				afterSpent: spent,
				beforeBudgetMax: bmax,
				afterBudgetMax: bmax,
				beforeBudgetBase: bbase,
				afterBudgetBase: bbase,
				beforeBudgetPeriod: bperiod,
				afterBudgetPeriod: bperiod,
				beforeBudgetResetAt: breset,
				afterBudgetResetAt: breset,
				metadata: JSON.stringify(profileAuditPayload),
			})
		);
	}

	const keyInfo = await getKeyInfo(repos, keyId);
	if (!keyInfo) throw notFound('Key not found');
	return keyInfo;
}

export async function getAdminUserLogs(
	repos: GatewayRepositories,
	rawUser: string,
	input: { page?: number; page_size?: number; status?: string }
) {
	const userId = await resolveAdminUserId(repos, rawUser);
	const page = Math.max(1, Number(input.page ?? 1));
	const page_size = Math.min(100, Math.max(1, Number(input.page_size ?? 20)));
	const status =
		input.status !== undefined && input.status !== null && String(input.status).trim() !== ''
			? String(input.status).trim()
			: undefined;

	const { logs, total } = await repos.requestLogs.getRequestLogs({
		page,
		pageSize: page_size,
		userId,
		status,
	});
	return { logs, total, page, page_size };
}

export async function getAdminUserAuditLogs(
	repos: GatewayRepositories,
	rawUser: string,
	input: { page?: number; page_size?: number }
) {
	const userId = await resolveAdminUserId(repos, rawUser);
	const page = Math.max(1, Number(input.page ?? 1));
	const page_size = Math.min(100, Math.max(1, Number(input.page_size ?? 20)));
	return repos.userAuditLogs.getUserAuditLogsByUserId(userId, page, page_size);
}
