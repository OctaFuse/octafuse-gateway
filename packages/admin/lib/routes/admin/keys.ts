/**
 * 管理路由：`/admin/keys` — API 密钥列表（分页、邮箱、`user_id`）、
 * 创建、查询、更新（仅 name/metadata/status）、物理删除及单 key 请求日志。全程 `requireMasterKey`。
 */
import { Hono } from 'hono';
import { parseApiKeyListSortQuery } from '@octafuse/core/db/api-keys-list-sort';
import type { AdminEnv } from '@/lib/admin-env';
import { requireMasterKey } from '@/lib/middleware/admin-auth';
import {
	createAdminKey,
	deleteAdminKey,
	getAdminKeyById,
	getAdminKeyLogs,
	listAdminKeys,
	updateAdminKey,
} from '@/lib/services/admin/keys-service';
import type { AdminKeyCreateInput, AdminKeyUpdateInput } from '@/lib/services/admin/types';
import { handleAdminRouteError, jsonErr } from './error-response';
import { normalizeApiTimeFields } from '@octafuse/core/lib/time-format';
export const adminKeysRoutes = new Hono<AdminEnv>();

adminKeysRoutes.use('*', requireMasterKey);

/** 查询：page、page_size、email、user_id、sort、order。 */
adminKeysRoutes.get('/', async (c) => {
	try {
		const sortParsed = parseApiKeyListSortQuery(c.req.query('sort'), c.req.query('order'));
		if (!sortParsed.ok) {
			return jsonErr(c, 400, sortParsed.message);
		}
		const repos = c.get('repositories');
		const result = await listAdminKeys(repos, {
			page: parseInt(c.req.query('page') ?? '1', 10),
			page_size: parseInt(c.req.query('page_size') ?? '20', 10),
			email: c.req.query('email') ?? undefined,
			user_id: c.req.query('user_id') ?? undefined,
			sort: sortParsed.value.sort,
			order: sortParsed.value.order,
		});
		return c.json(normalizeApiTimeFields({ success: true as const, ...result }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to list keys');
	}
});

/** 创建：须 `user_id`，或同时 `external_system` + `external_user_id` + `email`（新建用户时邮箱必填）。 */
adminKeysRoutes.post('/', async (c) => {
	let body: AdminKeyCreateInput;
	try {
		body = await c.req.json();
	} catch {
		return jsonErr(c, 400, 'Invalid JSON body');
	}
	try {
		const repos = c.get('repositories');
		const result = await createAdminKey(repos, body);
		return c.json(
			normalizeApiTimeFields({
				success: true as const,
				message: 'Key created successfully',
				data: result,
			})
		);
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to create key');
	}
});

/** `:id` 可为 uuid 或 `sk-…`；查询 page、page_size、exclude_status、include_statuses（逗号分隔，优先于 exclude_status）。 */
adminKeysRoutes.get('/:id/logs', async (c) => {
	try {
		const repos = c.get('repositories');
		const includeRaw = c.req.query('include_statuses');
		const result = await getAdminKeyLogs(repos, c.req.param('id'), {
			page: Math.max(1, parseInt(c.req.query('page') ?? '1', 10)),
			page_size: Math.min(100, Math.max(1, parseInt(c.req.query('page_size') ?? '20', 10))),
			exclude_status: c.req.query('exclude_status') ?? undefined,
			include_statuses: includeRaw !== undefined ? includeRaw : undefined,
		});
		return c.json(
			normalizeApiTimeFields({
				success: true as const,
				data: result.logs,
				total: result.total,
				page: result.page,
				page_size: result.page_size,
			})
		);
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to get key logs');
	}
});

/** 部分更新 name、metadata、status（预算见 `/admin/users`）。 */
adminKeysRoutes.patch('/:id', async (c) => {
	let body: AdminKeyUpdateInput;
	try {
		body = await c.req.json();
	} catch {
		return jsonErr(c, 400, 'Invalid JSON body');
	}
	try {
		const repos = c.get('repositories');
		const data = await updateAdminKey(repos, c.req.param('id'), body);
		return c.json(
			normalizeApiTimeFields({
				success: true as const,
				message: 'Key updated successfully',
				data,
			})
		);
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to update key');
	}
});

adminKeysRoutes.get('/:id', async (c) => {
	try {
		const repos = c.get('repositories');
		const data = await getAdminKeyById(repos, c.req.param('id'));
		return c.json(normalizeApiTimeFields({ success: true as const, data }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to get key');
	}
});

/** 物理删除密钥行。 */
adminKeysRoutes.delete('/:id', async (c) => {
	try {
		const repos = c.get('repositories');
		await deleteAdminKey(repos, c.req.param('id'));
		return c.json({ success: true as const, message: 'Key deleted successfully' });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to delete key');
	}
});
