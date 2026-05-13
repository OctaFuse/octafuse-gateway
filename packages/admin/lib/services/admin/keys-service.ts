/**
 * 管理后台 API 密钥：列表、创建、详情、日志、更新预算/元数据/状态、物理删除。
 * `id` 参数支持内部 uuid 或完整 `sk-` 字符串。
 */
import type { GatewayRepositories, RequestLogsByKeyIdFilter } from '@octafuse/core';
import {
	computeFirstReset,
	createKey,
	getKeyInfo,
	replaceKeyMetadata,
	updateKeyPlan,
	updateKeyMetadata,
	updateKeyStatus,
} from '@octafuse/core/services/key-service';
import { filterAllowedRequestLogStatuses } from '@octafuse/core/db/request-log-status-filter';
import { roundGatewayMoney } from '@octafuse/core/lib/money-precision';
import { badRequest, notFound } from './errors';
import { normalizeMetadataInput } from './shared';
import type {
	AdminKeyCreateInput,
	AdminKeyCreateOutput,
	AdminKeyDetailOutput,
	AdminKeyListItem,
	AdminKeyListOutput,
	AdminKeyLogsOutput,
	AdminKeyBudgetAuditLogsOutput,
	AdminKeyUpdateInput,
	AdminKeyUpdateOutput,
	BudgetPeriod,
	JsonObject,
} from './types';

/** `sk-` 开头按密钥查，否则按行 id 查（不区分 status，供更新前定位行）。 */
async function resolveKeyRow(repos: GatewayRepositories, idOrKey: string) {
	if (idOrKey.startsWith('sk-')) {
		return repos.apiKeys.getApiKeyByKey(idOrKey);
	}
	return repos.apiKeys.getApiKeyById(idOrKey);
}

/** 含已吊销：按 sk- 查时不过滤 status，供物理删除等。 */
async function resolveKeyRowAnyStatus(repos: GatewayRepositories, idOrKey: string) {
	if (idOrKey.startsWith('sk-')) {
		return repos.apiKeys.getApiKeyByKeyAnyStatus(idOrKey);
	}
	return repos.apiKeys.getApiKeyById(idOrKey);
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

	return Object.keys(changes).length > 0
		? { operation, changes }
		: { operation, from: before, to: after };
}

/**
 * 密钥分页列表。
 * @param input.max_budget `positive` | `zero_or_negative` | `null`，其它值忽略筛选
 */
export async function listAdminKeys(
	repos: GatewayRepositories,
	input: { page?: number; page_size?: number; email?: string; max_budget?: string }
): Promise<AdminKeyListOutput> {
	const page = Number.isFinite(input.page) ? Number(input.page) : 1;
	const pageSize = Number.isFinite(input.page_size) ? Number(input.page_size) : 20;
	const maxBudget = input.max_budget;

	const result = await repos.apiKeys.getAllApiKeys({
		email: input.email,
		maxBudget:
			maxBudget === 'positive' || maxBudget === 'zero_or_negative' || maxBudget === 'null' ? maxBudget : undefined,
		page,
		pageSize,
	});

	return {
		data: result.keys as AdminKeyListItem[],
		total: Number(result.total),
		page,
		page_size: pageSize,
	};
}

/**
 * 创建密钥（底层 `createKey` 幂等）；支持 metadata 字符串或对象。
 * @throws `badRequest` 参数非法
 */
export async function createAdminKey(repos: GatewayRepositories, input: AdminKeyCreateInput): Promise<AdminKeyCreateOutput> {
	if (!input.user_id || typeof input.user_id !== 'string') {
		throw badRequest('user_id is required');
	}

	const budget_period = input.budget_period ?? 'none';
	const budget_max = input.budget_max === undefined ? 0 : input.budget_max;
	const budget_base =
		input.budget_base === undefined
			? budget_max == null
				? 0
				: budget_max
			: input.budget_base ?? 0;
	let metaString: string | null | undefined;

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

	const result = await createKey(repos, {
		user_id: input.user_id,
		user_email: input.user_email,
		budget_max,
		budget_period,
		provision_reason: input.reason,
	});

	// 仅在调用方显式传 budget_base、或与默认 0 不一致时再下发 plan 更新写 budget_base，
	// 避免对历史 createKey 路径多一次无副作用的写库调用。
	if (input.budget_base !== undefined || budget_base !== 0) {
		await updateKeyPlan(repos, result.key_id, {
			budget_max,
			budget_period,
			reset_budget: false,
			budget_reset_at: undefined,
			budget_base,
		});
	}

	if (metaString !== undefined && metaString !== null) {
		await replaceKeyMetadata(repos, result.key_id, metaString);
	}

	return {
		key: result.key,
		key_id: result.key_id,
		user_id: input.user_id,
	};
}

/**
 * 单密钥请求日志分页。
 * @param input.include_statuses 逗号分隔；若传入则仅保留白名单内状态（优先于 exclude_status）。解析后若为空则返回空列表。
 * @param input.exclude_status 未传 include_statuses 时 SQL 排除该状态
 */
export async function getAdminKeyLogs(
	repos: GatewayRepositories,
	idOrKey: string,
	input: { page?: number; page_size?: number; exclude_status?: string; include_statuses?: string }
): Promise<AdminKeyLogsOutput> {
	const row = await resolveKeyRow(repos, idOrKey);
	if (!row) throw notFound('Key not found');

	const page = Math.max(1, Number(input.page ?? 1));
	const page_size = Math.min(100, Math.max(1, Number(input.page_size ?? 20)));

	let filter: RequestLogsByKeyIdFilter | undefined;
	if (input.include_statuses !== undefined && input.include_statuses !== null) {
		const parsed = input.include_statuses
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		const includeStatuses = filterAllowedRequestLogStatuses(parsed);
		if (includeStatuses.length === 0) {
			return { logs: [], total: 0, page, page_size };
		}
		filter = { includeStatuses };
	} else if (input.exclude_status) {
		filter = { excludeStatus: input.exclude_status };
	}

	const { logs, total } = await repos.requestLogs.getRequestLogsByKeyId(row.id, page, page_size, filter);
	return { logs, total, page, page_size };
}

export async function getAdminKeyBudgetAuditLogs(
	repos: GatewayRepositories,
	idOrKey: string,
	input: { page?: number; page_size?: number }
): Promise<AdminKeyBudgetAuditLogsOutput> {
	const row = await resolveKeyRow(repos, idOrKey);
	if (!row) throw notFound('Key not found');

	const page = Math.max(1, Number(input.page ?? 1));
	const page_size = Math.min(100, Math.max(1, Number(input.page_size ?? 20)));
	const { logs, total } = await repos.budgetAuditLogs.getApiKeyBudgetAuditLogsByKeyId(row.id, page, page_size);
	return { logs, total, page, page_size };
}

/**
 * 部分更新：预算字段、metadata（对象浅合并 / 字符串整体替换 / metadata_replace）、status。
 * 纯 metadata 对象合并且无预算字段时走 `updateKeyMetadata`；含预算或整体替换走 `updateKeyPlan`。
 * @throws `badRequest` | `notFound`
 */
export async function updateAdminKey(
	repos: GatewayRepositories,
	idOrKey: string,
	input: AdminKeyUpdateInput
): Promise<AdminKeyUpdateOutput> {
	const row = await resolveKeyRow(repos, idOrKey);
	if (!row) throw notFound('Key not found');

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
	const userEmailRaw = input.user_email;
	const hasUserEmail = userEmailRaw !== undefined;
	const nextUserEmail =
		userEmailRaw === undefined || userEmailRaw === null
			? null
			: String(userEmailRaw).trim() === ''
				? null
				: String(userEmailRaw).trim().toLowerCase();

	if (!hasBudgetField && !hasMetaObjectMerge && !hasMetaReplace && !hasStatus && !hasUserEmail) {
		throw badRequest(
			'Provide at least one of user_email, budget_max, budget_base, budget_spent, budget_period, reset_budget, budget_reset_at, metadata, metadata_replace, status'
		);
	}

	if (hasMetaObjectMerge && hasMetaReplace) {
		throw badRequest('Use either metadata (object merge or string replace) or metadata_replace, not both');
	}

	if (hasStatus) {
		await updateKeyStatus(repos, row.id, String(input.status));
	}
	if (hasUserEmail) {
		const ok = await repos.apiKeys.setApiKeyUserEmailById(row.id, nextUserEmail);
		if (!ok) throw new Error('Failed to update key');
	}

	if (hasMetaObjectMerge && !hasBudgetField && !hasMetaReplace) {
		const ok = await updateKeyMetadata(repos, row.id, input.metadata as JsonObject);
		if (!ok) throw new Error('Failed to update key');
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

		const ok = await updateKeyPlan(repos, row.id, {
			budget_max: effMax,
			budget_period: effPeriod,
			reset_budget: resolvedResetBudget,
			budget_reset_at: resolvedBudgetResetAt,
			metadata: mergedMetadataJson,
			budget_spent: budget_spent_in,
			budget_base: budget_base_in,
		});
		if (!ok) throw new Error('Failed to update key');
	}

	const rowAfterUpdate = await resolveKeyRow(repos, row.id);
	const reasonText =
		typeof input.reason === 'string' && input.reason.trim() !== '' ? input.reason.trim() : 'Admin update';

	if (rowAfterUpdate) {
		const budgetChanged =
			Number(rowAfterUpdate.budget_spent ?? 0) !== Number(row.budget_spent ?? 0) ||
			Number(rowAfterUpdate.budget_max ?? 0) !== Number(row.budget_max ?? 0) ||
			Number(rowAfterUpdate.budget_base ?? 0) !== Number(row.budget_base ?? 0) ||
			(rowAfterUpdate.budget_period ?? null) !== (row.budget_period ?? null) ||
			(rowAfterUpdate.budget_reset_at ?? null) !== (row.budget_reset_at ?? null);

		const metadataChanged = (row.metadata ?? '') !== (rowAfterUpdate.metadata ?? '');
		const statusChanged = (row.status ?? '') !== (rowAfterUpdate.status ?? '');
		const userEmailChanged = (row.user_email ?? null) !== (rowAfterUpdate.user_email ?? null);

		let profileAuditPayload: Record<string, unknown> | null = null;
		if (metadataChanged || statusChanged || userEmailChanged) {
			profileAuditPayload = {};
			if (userEmailChanged) {
				profileAuditPayload.user_email = {
					from: row.user_email ?? null,
					to: rowAfterUpdate.user_email ?? null,
				};
			}
			if (statusChanged) {
				profileAuditPayload.status = { from: row.status ?? null, to: rowAfterUpdate.status ?? null };
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
				profileAuditPayload.metadata = buildMetadataAuditChange(
					row.metadata,
					rowAfterUpdate.metadata,
					operation,
					touchedKeys
				);
			}
		}

		const profileAuditJson =
			profileAuditPayload && Object.keys(profileAuditPayload).length > 0
				? JSON.stringify(profileAuditPayload)
				: null;

		if (budgetChanged) {
			await repos.budgetAuditLogs.insertApiKeyBudgetAuditLog({
				id: crypto.randomUUID(),
				apiKeyId: row.id,
				eventType: 'admin_adjust',
				actorType: 'admin',
				actorId: 'master_key',
				reasonCode: 'admin_patch_budget',
				reasonText: reasonText,
				beforeSpent: Number(row.budget_spent ?? 0),
				deltaSpent: Number(rowAfterUpdate.budget_spent ?? 0) - Number(row.budget_spent ?? 0),
				afterSpent: Number(rowAfterUpdate.budget_spent ?? 0),
				beforeBudgetMax: row.budget_max ?? null,
				afterBudgetMax: rowAfterUpdate.budget_max ?? null,
				beforeBudgetBase: row.budget_base ?? null,
				afterBudgetBase: rowAfterUpdate.budget_base ?? null,
				beforeBudgetPeriod: row.budget_period ?? null,
				afterBudgetPeriod: rowAfterUpdate.budget_period ?? null,
				beforeBudgetResetAt: row.budget_reset_at ?? null,
				afterBudgetResetAt: rowAfterUpdate.budget_reset_at ?? null,
				metadata: profileAuditJson,
			});
		} else if (metadataChanged || statusChanged || userEmailChanged) {
			let reasonCode = 'admin_patch_profile';
			if (metadataChanged && !statusChanged && !userEmailChanged) {
				reasonCode = 'admin_patch_metadata';
			} else if (statusChanged && !metadataChanged && !userEmailChanged) {
				reasonCode = 'admin_patch_status';
			} else if (userEmailChanged && !metadataChanged && !statusChanged) {
				reasonCode = 'admin_patch_user_email';
			}
			const spent = Number(rowAfterUpdate.budget_spent ?? 0);
			const bmax = rowAfterUpdate.budget_max ?? null;
			const bbase = rowAfterUpdate.budget_base ?? null;
			const bperiod = rowAfterUpdate.budget_period ?? null;
			const breset = rowAfterUpdate.budget_reset_at ?? null;
			await repos.budgetAuditLogs.insertApiKeyBudgetAuditLog({
				id: crypto.randomUUID(),
				apiKeyId: row.id,
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
			});
		}
	}

	const info = await getKeyInfo(repos, row.id);
	if (!info) {
		return { id: row.id, updated: true };
	}
	return {
		id: info.id,
		key_id: info.id,
		user_id: info.user_id,
		budget_max: info.budget_max,
		budget_base: roundGatewayMoney(Number(info.budget_base ?? 0)),
		budget_period: info.budget_period,
		budget_reset_at: info.budget_reset_at,
		metadata: info.metadata ?? undefined,
	};
}

/**
 * 密钥详情（含懒预算重置后的字段）。
 */
export async function getAdminKeyById(repos: GatewayRepositories, idOrKey: string): Promise<AdminKeyDetailOutput> {
	const row = await resolveKeyRow(repos, idOrKey);
	if (!row) throw notFound('Key not found');

	const info = await getKeyInfo(repos, row.id);
	if (!info) throw notFound('Key not found');

	return {
		id: info.id,
		key: info.key,
		user_id: info.user_id,
		user_email: info.user_email,
		budget_max: info.budget_max,
		budget_base: roundGatewayMoney(Number(info.budget_base ?? 0)),
		budget_spent: info.budget_spent,
		budget_period: info.budget_period,
		budget_reset_at: info.budget_reset_at,
		status: info.status,
		metadata: info.metadata ?? undefined,
		created_at: info.created_at,
		updated_at: info.updated_at,
		spend: info.budget_spent,
		max_budget: info.budget_max,
	};
}

/** 物理删除密钥；未找到抛 `notFound`。 */
export async function deleteAdminKey(repos: GatewayRepositories, idOrKey: string): Promise<void> {
	const row = await resolveKeyRowAnyStatus(repos, idOrKey);
	if (!row) throw notFound('Key not found');

	const ok = await repos.apiKeys.deleteApiKeyHard(row.id, row.key);
	if (!ok) throw notFound('Key not found');
}
