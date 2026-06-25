/**
 * 管理路由：`/admin/users` — 用户 CRUD、子资源 keys / logs / audit-logs。
 */
import { Hono } from 'hono';
import { parseUserListSortQuery } from '@octafuse/core/db/users-list-sort';
import type { AdminEnv } from '@/lib/admin-env';
import { requireMasterKey } from '@/lib/middleware/admin-auth';
import {
	createAdminUser,
	createAdminUserKey,
	deleteAdminUser,
	deleteAdminUserKey,
	getAdminUserAuditLogs,
	getAdminUserByRouteId,
	getAdminUserLogs,
	listAdminUserKeys,
	listAdminUsers,
	patchAdminUserKey,
	updateAdminUser,
	previewAdminBudgetTransition,
	applyAdminBudgetTransition,
} from '@/lib/services/admin/users-service';
import type { AdminUserCreateInput, AdminUserUpdateInput, AdminBudgetTransitionInput } from '@/lib/services/admin/types';
import type { AdminUserKeyPatchInput } from '@/lib/services/admin/users-service';
import { handleAdminRouteError, jsonErr } from './error-response';
import { normalizeApiTimeFields } from '@octafuse/core/lib/time-format';

export const adminUsersRoutes = new Hono<AdminEnv>();

adminUsersRoutes.use('*', requireMasterKey);

adminUsersRoutes.get('/', async (c) => {
	try {
		const sortParsed = parseUserListSortQuery(c.req.query('sort'), c.req.query('order'));
		if (!sortParsed.ok) {
			return jsonErr(c, 400, sortParsed.message);
		}
		const repos = c.get('repositories');
		const result = await listAdminUsers(repos, {
			page: parseInt(c.req.query('page') ?? '1', 10),
			page_size: parseInt(c.req.query('page_size') ?? '20', 10),
			email: c.req.query('email') ?? undefined,
			external_system: c.req.query('external_system') ?? undefined,
			external_user_id: c.req.query('external_user_id') ?? undefined,
			max_budget: c.req.query('max_budget') ?? undefined,
			status: c.req.query('status') ?? undefined,
			sort: sortParsed.value.sort,
			order: sortParsed.value.order,
		});
		return c.json(normalizeApiTimeFields({ success: true as const, ...result }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to list users');
	}
});

adminUsersRoutes.post('/', async (c) => {
	let body: AdminUserCreateInput;
	try {
		body = await c.req.json();
	} catch {
		return jsonErr(c, 400, 'Invalid JSON body');
	}
	try {
		const repos = c.get('repositories');
		const data = await createAdminUser(repos, body);
		return c.json(
			normalizeApiTimeFields({
				success: true as const,
				message: 'User created or returned (idempotent by external pair)',
				data,
			})
		);
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to create user');
	}
});

adminUsersRoutes.get('/:id/logs', async (c) => {
	try {
		const repos = c.get('repositories');
		const result = await getAdminUserLogs(repos, c.req.param('id'), {
			page: Math.max(1, parseInt(c.req.query('page') ?? '1', 10)),
			page_size: Math.min(100, Math.max(1, parseInt(c.req.query('page_size') ?? '20', 10))),
			status: c.req.query('status') ?? undefined,
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
		return handleAdminRouteError(c, error, 'Failed to get user logs');
	}
});

adminUsersRoutes.get('/:id/audit-logs', async (c) => {
	try {
		const repos = c.get('repositories');
		const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
		const page_size = Math.min(100, Math.max(1, parseInt(c.req.query('page_size') ?? '20', 10)));
		const result = await getAdminUserAuditLogs(repos, c.req.param('id'), { page, page_size });
		return c.json(
			normalizeApiTimeFields({
				success: true as const,
				data: result.logs,
				total: result.total,
				page,
				page_size,
			})
		);
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to get user audit logs');
	}
});

adminUsersRoutes.get('/:id/keys', async (c) => {
	try {
		const repos = c.get('repositories');
		const keys = await listAdminUserKeys(repos, c.req.param('id'));
		return c.json(normalizeApiTimeFields({ success: true as const, data: keys }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to list user keys');
	}
});

adminUsersRoutes.post('/:id/keys', async (c) => {
	let body: { name?: string | null; metadata?: unknown; reason?: string };
	try {
		body = await c.req.json();
	} catch {
		return jsonErr(c, 400, 'Invalid JSON body');
	}
	try {
		const repos = c.get('repositories');
		const result = await createAdminUserKey(repos, c.req.param('id'), body);
		return c.json(
			normalizeApiTimeFields({
				success: true as const,
				message: 'Key created successfully',
				data: result,
			})
		);
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to create user key');
	}
});

adminUsersRoutes.patch('/:id/keys/:keyId', async (c) => {
	let body: AdminUserKeyPatchInput;
	try {
		body = await c.req.json();
	} catch {
		return jsonErr(c, 400, 'Invalid JSON body');
	}
	try {
		const repos = c.get('repositories');
		const data = await patchAdminUserKey(repos, c.req.param('id'), c.req.param('keyId'), body);
		return c.json(normalizeApiTimeFields({ success: true as const, message: 'Key updated', data }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to update user key');
	}
});

adminUsersRoutes.delete('/:id/keys/:keyId', async (c) => {
	try {
		const repos = c.get('repositories');
		await deleteAdminUserKey(repos, c.req.param('id'), c.req.param('keyId'));
		return c.json({ success: true as const, message: 'Key deleted successfully' });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to delete user key');
	}
});

adminUsersRoutes.post('/:id/budget/transition/preview', async (c) => {
	let body: AdminBudgetTransitionInput;
	try {
		body = await c.req.json();
	} catch {
		return jsonErr(c, 400, 'Invalid JSON body');
	}
	try {
		const repos = c.get('repositories');
		const data = await previewAdminBudgetTransition(repos, c.req.param('id'), body);
		return c.json(normalizeApiTimeFields({ success: true as const, data }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to preview budget transition');
	}
});

adminUsersRoutes.post('/:id/budget/transition', async (c) => {
	let body: AdminBudgetTransitionInput;
	try {
		body = await c.req.json();
	} catch {
		return jsonErr(c, 400, 'Invalid JSON body');
	}
	try {
		const repos = c.get('repositories');
		const data = await applyAdminBudgetTransition(repos, c.req.param('id'), body);
		return c.json(
			normalizeApiTimeFields({
				success: true as const,
				message: 'Budget transition applied',
				data,
			})
		);
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to apply budget transition');
	}
});

adminUsersRoutes.get('/:id', async (c) => {
	try {
		const repos = c.get('repositories');
		const data = await getAdminUserByRouteId(repos, c.req.param('id'));
		return c.json(normalizeApiTimeFields({ success: true as const, data }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to get user');
	}
});

adminUsersRoutes.patch('/:id', async (c) => {
	let body: AdminUserUpdateInput;
	try {
		body = await c.req.json();
	} catch {
		return jsonErr(c, 400, 'Invalid JSON body');
	}
	try {
		const repos = c.get('repositories');
		const data = await updateAdminUser(repos, c.req.param('id'), body);
		return c.json(normalizeApiTimeFields({ success: true as const, message: 'User updated successfully', data }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to update user');
	}
});

adminUsersRoutes.delete('/:id', async (c) => {
	try {
		const repos = c.get('repositories');
		await deleteAdminUser(repos, c.req.param('id'));
		return c.json({ success: true as const, message: 'User deleted successfully' });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to delete user');
	}
});
