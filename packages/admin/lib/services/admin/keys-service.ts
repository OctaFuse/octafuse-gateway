/**
 * 管理后台 API 密钥：列表（JOIN users，预算只读）、创建（须关联已有 user 或外部身份对）、
 * 详情、日志、密钥级 metadata/status/name 更新、物理删除。预算与邮箱在 `/admin/users`。
 */
import type { GatewayRepositories, RequestLogsByKeyIdFilter } from '@octafuse/core';
import { createKey, updateKeyName } from '@octafuse/core/services/key-service';
import {
	getKeyInfo,
	getOrCreateUser,
	replaceKeyMetadata,
	updateKeyMetadata,
	updateKeyStatus,
} from '@octafuse/core/services/user-service';
import { filterAllowedRequestLogStatuses } from '@octafuse/core/db/request-log-status-filter';
import { insertParamsFromFullLegacy } from '@octafuse/core/db/user-audit-legacy-mapper';
import { badRequest, notFound } from './errors';
import { normalizeMetadataInput } from './shared';
import type {
	AdminKeyCreateInput,
	AdminKeyCreateOutput,
	AdminKeyDetailOutput,
	AdminKeyListItem,
	AdminKeyListOutput,
	AdminKeyLogsOutput,
	AdminKeyUpdateInput,
	AdminKeyUpdateOutput,
	JsonObject,
} from './types';

/** `sk-` 开头按密钥查，否则按行 id 查（不区分 status，供更新前定位行）。 */
async function resolveKeyRow(repos: GatewayRepositories, idOrKey: string) {
	if (idOrKey.startsWith('sk-')) {
		return repos.apiKeys.getApiKeyWithUserByKey(idOrKey);
	}
	return repos.apiKeys.getApiKeyWithUserById(idOrKey);
}

/** 含已吊销：按 sk- 查时不过滤 status，供物理删除等。 */
async function resolveKeyRowAnyStatus(repos: GatewayRepositories, idOrKey: string) {
	if (idOrKey.startsWith('sk-')) {
		const k = await repos.apiKeys.getApiKeyByKeyAnyStatus(idOrKey);
		if (!k) return null;
		return repos.apiKeys.getApiKeyWithUserById(k.id);
	}
	return repos.apiKeys.getApiKeyWithUserById(idOrKey);
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

/**
 * 密钥分页列表（`user_id`、`email` 筛选；预算来自 JOIN users，只读）。
 */
export async function listAdminKeys(
	repos: GatewayRepositories,
	input: { page?: number; page_size?: number; email?: string; user_id?: string }
): Promise<AdminKeyListOutput> {
	const page = Number.isFinite(input.page) ? Number(input.page) : 1;
	const pageSize = Number.isFinite(input.page_size) ? Number(input.page_size) : 20;

	const result = await repos.apiKeys.getAllApiKeys({
		email: input.email,
		userId: input.user_id,
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
 * 在已有用户下新建密钥；无 `user_id` 时须提供 `external_system` + `external_user_id` 以幂等取/建用户。
 */
export async function createAdminKey(repos: GatewayRepositories, input: AdminKeyCreateInput): Promise<AdminKeyCreateOutput> {
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

	let userId: string;
	if (input.user_id && typeof input.user_id === 'string' && input.user_id.trim() !== '') {
		userId = input.user_id.trim();
		const u = await repos.users.getById(userId);
		if (!u) throw badRequest('user not found');
	} else {
		const extS = input.external_system;
		const extU = input.external_user_id;
		if (extS == null || extU == null || String(extS).trim() === '' || String(extU).trim() === '') {
			throw badRequest('Provide user_id or both external_system and external_user_id');
		}
		const u = await getOrCreateUser(repos, {
			external_system: extS,
			external_user_id: extU,
			email: null,
			budget_max: 0,
			budget_period: 'none',
			budget_base: 0,
			metadata: null,
		});
		userId = u.id;
	}

	const result = await createKey(repos, {
		user_id: userId,
		name: input.name ?? null,
		metadata: metaString ?? null,
		provision_reason: input.reason,
	});

	return {
		key: result.key,
		key_id: result.key_id,
		user_id: userId,
	};
}

/**
 * 单密钥请求日志分页。
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

/**
 * 部分更新：`name`、`metadata`（合并或整体替换）、`status`。预算字段须走 `/admin/users`。
 */
export async function updateAdminKey(
	repos: GatewayRepositories,
	idOrKey: string,
	input: AdminKeyUpdateInput
): Promise<AdminKeyUpdateOutput> {
	const raw = input as Record<string, unknown>;
	for (const k of ['budget_max', 'budget_base', 'budget_spent', 'budget_period', 'reset_budget', 'budget_reset_at', 'user_email']) {
		if (raw[k] !== undefined) {
			throw badRequest(`Field ${k} is not allowed on keys; use PATCH /admin/users/:id`);
		}
	}

	const row = await resolveKeyRow(repos, idOrKey);
	if (!row) throw notFound('Key not found');

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
	const hasName = input.name !== undefined;

	if (!hasMetaObjectMerge && !hasMetaReplace && !hasStatus && !hasName) {
		throw badRequest('Provide at least one of name, metadata, metadata_replace, status');
	}

	if (hasMetaObjectMerge && hasMetaReplace) {
		throw badRequest('Use either metadata (object merge or string replace) or metadata_replace, not both');
	}

	if (hasName) {
		await updateKeyName(repos, row.id, input.name ?? null);
	}
	if (hasStatus) {
		await updateKeyStatus(repos, row.id, String(input.status));
	}
	if (hasMetaObjectMerge) {
		await updateKeyMetadata(repos, row.id, input.metadata as JsonObject);
	} else if (hasMetaReplace) {
		await replaceKeyMetadata(repos, row.id, metadataReplaceStr ?? null);
	}

	const reasonText =
		typeof input.reason === 'string' && input.reason.trim() !== '' ? input.reason.trim() : 'Admin key update';

	const rowAfter = await resolveKeyRow(repos, row.id);
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
			} else if (hasMetaReplace || (input.metadata !== undefined && typeof input.metadata === 'string')) {
				operation = 'replace';
			}
			profileAuditPayload.metadata = buildMetadataAuditChange(
				row.metadata,
				rowAfter.metadata,
				operation,
				touchedKeys
			);
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
			insertParamsFromFullLegacy(row.user_id, {
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
				metadata: JSON.stringify(profileAuditPayload),
			})
		);
	}

	const info = await getKeyInfo(repos, row.id);
	if (!info) {
		return { id: row.id, updated: true };
	}
	return {
		id: info.id,
		key_id: info.id,
		user_id: info.user_id,
		name: info.name,
		user_email: info.user_email,
		budget_max: info.budget_max,
		budget_base: info.budget_base,
		budget_spent: info.budget_spent,
		budget_period: info.budget_period,
		budget_reset_at: info.budget_reset_at,
		metadata: info.metadata ?? undefined,
	};
}

/**
 * 密钥详情（含懒预算重置后的用户预算字段，只读）。
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
		name: info.name,
		user_email: info.user_email,
		budget_max: info.budget_max,
		budget_base: info.budget_base,
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
