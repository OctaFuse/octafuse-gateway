/**
 * 管理端 `/admin/users`：列表、按外部对幂等创建、详情（懒重置预算）、计划/资料 PATCH、
 * 物理删除、子资源 keys / request-logs / audit-logs。
 */
import type { BudgetPeriod, GatewayRepositories } from '@octafuse/core';
import type { UserListSortField, UserListSortOrder } from '@octafuse/core/db/users-list-sort';
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
import {
	applyBudgetTransition,
	previewBudgetTransition,
	type BudgetTransitionParams,
} from '@octafuse/core/services/budget-transition-service';
import { userBudgetAuditToInsertRowFull } from '@octafuse/core/db/user-budget-audit-mapper';
import { roundGatewayMoney } from '@octafuse/core/lib/money-precision';
import {
	changedFieldsToJson,
	computeChangedFields,
	snapshotToJson,
	userRowToSnapshot,
} from '@octafuse/core/db/user-audit-snapshot';
import { buildMetadataAuditChange } from './admin-profile-audit-metadata';
import { badRequest, conflict, notFound } from './errors';
import { normalizeMetadataInput } from './shared';
import type { AdminUserCreateInput, AdminUserUpdateInput, AdminBudgetTransitionInput, JsonObject } from './types';

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
		sort?: UserListSortField;
		order?: UserListSortOrder;
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
		sort: input.sort,
		order: input.order,
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

/** D1/SQLite 或 Postgres 在 `(external_system, email)` 唯一索引冲突时的错误识别。 */
function isExternalSystemEmailUniqueViolation(error: unknown): boolean {
	const msg = error instanceof Error ? error.message : String(error);
	return (
		msg.includes('uk_users_external_system_email') ||
		(msg.includes('UNIQUE constraint') && msg.includes('external_system') && msg.includes('email')) ||
		(msg.includes('duplicate key') && msg.includes('external_system') && msg.includes('email'))
	);
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

	let user;
	try {
		user = await getOrCreateUser(repos, {
			external_system: input.external_system ?? null,
			external_user_id: input.external_user_id ?? null,
			email: emailTrim,
			budget_max,
			budget_period,
			budget_base,
			metadata: metaString,
		});
	} catch (error) {
		if (isExternalSystemEmailUniqueViolation(error)) {
			const system = String(input.external_system ?? '').trim() || '(unknown)';
			throw conflict(
				`email "${emailTrim}" is already linked to another user under external_system "${system}"`
			);
		}
		throw error;
	}

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

	const hasExternalSystem = Object.prototype.hasOwnProperty.call(input, 'external_system');
	const hasExternalUserId = Object.prototype.hasOwnProperty.call(input, 'external_user_id');
	const hasExternalIdentity = hasExternalSystem || hasExternalUserId;
	const normalizeExternalString = (raw: unknown): string | null => {
		if (raw == null) return null;
		const s = String(raw).trim();
		return s === '' ? null : s;
	};
	const nextExternalSystem = hasExternalSystem
		? normalizeExternalString(input.external_system)
		: row.external_system;
	const nextExternalUserId = hasExternalUserId
		? normalizeExternalString(input.external_user_id)
		: row.external_user_id;
	if (hasExternalIdentity) {
		const bothNull = nextExternalSystem === null && nextExternalUserId === null;
		const bothSet = nextExternalSystem !== null && nextExternalUserId !== null;
		if (!bothNull && !bothSet) {
			throw badRequest('external_system and external_user_id must both be set or both empty');
		}
	}

	if (
		!hasBudgetField &&
		!hasMetaObjectMerge &&
		!hasMetaReplace &&
		!hasStatus &&
		!hasEmail &&
		!hasExternalIdentity
	) {
		throw badRequest(
			'Provide at least one of email, budget_max, budget_base, budget_spent, budget_period, reset_budget, budget_reset_at, metadata, metadata_replace, status, external_system, external_user_id'
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
	if (hasExternalIdentity) {
		const ok = await repos.users.setUserExternalIdentityById(
			userId,
			nextExternalSystem,
			nextExternalUserId
		);
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
	const externalSystemChanged = (row.external_system ?? null) !== (rowAfter.external_system ?? null);
	const externalUserIdChanged = (row.external_user_id ?? null) !== (rowAfter.external_user_id ?? null);
	const externalChanged = externalSystemChanged || externalUserIdChanged;

	let profileAuditPayload: Record<string, unknown> | null = null;
	if (metadataChanged || statusChanged || emailChanged || externalChanged) {
		profileAuditPayload = {};
		if (emailChanged) {
			profileAuditPayload.email = { from: row.email ?? null, to: rowAfter.email ?? null };
		}
		if (statusChanged) {
			profileAuditPayload.status = { from: row.status ?? null, to: rowAfter.status ?? null };
		}
		if (externalSystemChanged) {
			profileAuditPayload.external_system = {
				from: row.external_system ?? null,
				to: rowAfter.external_system ?? null,
			};
		}
		if (externalUserIdChanged) {
			profileAuditPayload.external_user_id = {
				from: row.external_user_id ?? null,
				to: rowAfter.external_user_id ?? null,
			};
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

	const beforeUserSnap = snapshotToJson(userRowToSnapshot(row));
	const afterUserSnap = snapshotToJson(userRowToSnapshot(rowAfter));
	const userChangedFieldsJson = changedFieldsToJson(computeChangedFields(userRowToSnapshot(row), userRowToSnapshot(rowAfter)));

	if (budgetChanged) {
		await repos.userAuditLogs.insertUserAuditLog(
			userBudgetAuditToInsertRowFull(userId, {
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
				changePayloadMerge: profileAuditJson,
				beforeUserSnapshot: beforeUserSnap,
				afterUserSnapshot: afterUserSnap,
				changedFields: userChangedFieldsJson,
				source: 'admin_users',
				correlationId: crypto.randomUUID(),
			})
		);
	} else if (metadataChanged || statusChanged || emailChanged || externalChanged) {
		let reasonCode = 'admin_patch_profile';
		if (metadataChanged && !statusChanged && !emailChanged) reasonCode = 'admin_patch_metadata';
		else if (statusChanged && !metadataChanged && !emailChanged) reasonCode = 'admin_patch_status';
		else if (emailChanged && !metadataChanged && !statusChanged && !externalChanged) reasonCode = 'admin_patch_email';
		else if (externalChanged && !metadataChanged && !statusChanged && !emailChanged) reasonCode = 'admin_patch_external_identity';
		const spent = Number(rowAfter.budget_spent ?? 0);
		const bmax = rowAfter.budget_max ?? null;
		const bbase = rowAfter.budget_base ?? null;
		const bperiod = rowAfter.budget_period ?? null;
		const breset = rowAfter.budget_reset_at ?? null;
		await repos.userAuditLogs.insertUserAuditLog(
			userBudgetAuditToInsertRowFull(userId, {
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
				changePayloadMerge: profileAuditJson,
				beforeUserSnapshot: beforeUserSnap,
				afterUserSnapshot: afterUserSnap,
				changedFields: userChangedFieldsJson,
				source: 'admin_users',
				correlationId: crypto.randomUUID(),
			})
		);
	}

	return getUserInfo(repos, userId);
}

const VALID_BUDGET_PERIODS = new Set<BudgetPeriod>(['none', 'daily', 'weekly', 'monthly']);
const VALID_CARRYOVER = new Set(['remaining_or_overage', 'none']);

function parseAdminBudgetTransitionInput(input: AdminBudgetTransitionInput): BudgetTransitionParams {
	const base = input.target_budget_base;
	if (typeof base !== 'number' || !Number.isFinite(base) || base < 0) {
		throw badRequest('target_budget_base must be a non-negative finite number');
	}
	const period = input.budget_period;
	if (!VALID_BUDGET_PERIODS.has(period)) {
		throw badRequest('budget_period must be none, daily, weekly, or monthly');
	}
	const strategy = input.carryover_strategy ?? 'remaining_or_overage';
	if (!VALID_CARRYOVER.has(strategy)) {
		throw badRequest('carryover_strategy must be remaining_or_overage or none');
	}
	if (input.budget_reset_at !== undefined && input.budget_reset_at !== null) {
		const t = new Date(input.budget_reset_at).getTime();
		if (Number.isNaN(t)) {
			throw badRequest('budget_reset_at must be a valid ISO datetime or null');
		}
	}
	let metadata: Record<string, unknown> | undefined;
	if (input.metadata !== undefined) {
		if (typeof input.metadata !== 'object' || input.metadata === null || Array.isArray(input.metadata)) {
			throw badRequest('metadata must be a JSON object');
		}
		metadata = input.metadata as Record<string, unknown>;
	}
	return {
		target_budget_base: base,
		budget_period: period,
		budget_reset_at: input.budget_reset_at,
		carryover_strategy: strategy,
		reset_spent: input.reset_spent,
		metadata,
		reason: input.reason,
	};
}

export async function previewAdminBudgetTransition(
	repos: GatewayRepositories,
	raw: string,
	input: AdminBudgetTransitionInput
) {
	const userId = await resolveAdminUserId(repos, raw);
	const params = parseAdminBudgetTransitionInput(input);
	const preview = await previewBudgetTransition(repos, userId, params);
	if (!preview) throw notFound('User not found');
	return preview;
}

export async function applyAdminBudgetTransition(
	repos: GatewayRepositories,
	raw: string,
	input: AdminBudgetTransitionInput
) {
	const userId = await resolveAdminUserId(repos, raw);
	const params = parseAdminBudgetTransitionInput(input);
	const result = await applyBudgetTransition(repos, userId, params);
	if (!result) throw notFound('User not found');
	const info = await getUserInfo(repos, userId);
	if (!info) throw notFound('User not found');
	return { transition: result.preview, user: info };
}

export async function deleteAdminUser(repos: GatewayRepositories, raw: string): Promise<void> {
	const userId = await resolveAdminUserId(repos, raw);
	const row = await repos.users.getById(userId);
	if (!row) throw notFound('User not found');
	const beforeUserSnap = snapshotToJson(userRowToSnapshot(row));
	const spent = Number(row.budget_spent ?? 0);
	const bmax = row.budget_max ?? null;
	const bbase = row.budget_base ?? null;
	const bperiod = row.budget_period ?? null;
	const breset = row.budget_reset_at ?? null;
	await repos.userAuditLogs.insertUserAuditLog(
		userBudgetAuditToInsertRowFull(userId, {
			id: crypto.randomUUID(),
			apiKeyId: null,
			eventType: 'user_deleted',
			actorType: 'admin',
			actorId: 'master_key',
			reasonCode: 'admin_user_delete',
			reasonText: 'User permanently deleted',
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
			changePayloadMerge: JSON.stringify({ deleted_user_id: userId, deleted_user_email: row.email ?? null }),
			beforeUserSnapshot: beforeUserSnap,
			afterUserSnapshot: null,
			changedFields: null,
			source: 'admin_users',
			correlationId: crypto.randomUUID(),
		})
	);
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
	const userAud = await repos.users.getById(userId);
	const userSnapJson = userAud ? snapshotToJson(userRowToSnapshot(userAud)) : null;
	const spent = Number(row.budget_spent ?? 0);
	const bmax = row.budget_max ?? null;
	const bbase = row.budget_base ?? null;
	const bperiod = row.budget_period ?? null;
	const breset = row.budget_reset_at ?? null;
	await repos.userAuditLogs.insertUserAuditLog(
		userBudgetAuditToInsertRowFull(userId, {
			id: crypto.randomUUID(),
			apiKeyId: keyId,
			eventType: 'key_deleted',
			actorType: 'admin',
			actorId: 'master_key',
			reasonCode: 'admin_user_key_delete',
			reasonText: 'API key permanently deleted',
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
			changePayloadMerge: JSON.stringify({
				key_id: row.id,
				name: row.name,
				status: row.status,
			}),
			beforeUserSnapshot: userSnapJson,
			afterUserSnapshot: userSnapJson,
			changedFields: null,
			source: 'admin_user_key',
			correlationId: crypto.randomUUID(),
		})
	);
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
		const userAud = await repos.users.getById(userId);
		const userSnapJson = userAud ? snapshotToJson(userRowToSnapshot(userAud)) : null;
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
		const isRevoked = statusChanged && rowAfter.status === 'revoked';
		let reasonCode = 'admin_patch_key_profile';
		if (isRevoked) {
			reasonCode = 'admin_user_key_revoked';
		} else if (metadataChanged && !statusChanged && !nameChanged) reasonCode = 'admin_patch_key_metadata';
		else if (statusChanged && !metadataChanged && !nameChanged) reasonCode = 'admin_patch_key_status';
		else if (nameChanged && !metadataChanged && !statusChanged) reasonCode = 'admin_patch_key_name';
		const eventType = isRevoked ? 'key_revoked' : 'admin_adjust';

		await repos.userAuditLogs.insertUserAuditLog(
			userBudgetAuditToInsertRowFull(userId, {
				id: crypto.randomUUID(),
				apiKeyId: keyId,
				eventType,
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
				changePayloadMerge: JSON.stringify(profileAuditPayload),
				beforeUserSnapshot: userSnapJson,
				afterUserSnapshot: userSnapJson,
				changedFields: null,
				source: 'admin_user_key',
				correlationId: crypto.randomUUID(),
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
