/**
 * 管理路由：`/admin/providers` — 上游供应商账号 CRUD，委托 `providers-service`。
 */
import { Hono } from 'hono';
import type { AdminEnv } from '@/lib/admin-env';
import { requireMasterKey } from '@/lib/middleware/admin-auth';
import { listStaticProviderImportCatalogForAdmin } from '@/lib/provider-import-preset';
import {
	createProviderService,
	deleteProviderService,
	getProviderService,
	importProvidersFromStaticPresetsService,
	listProvidersService,
	updateProviderService,
} from '@/lib/services/admin/providers-service';
import {
	createProviderKeyService,
	deleteProviderKeyService,
	listProviderKeysService,
	revealProviderKeyService,
	updateProviderKeyService,
} from '@/lib/services/admin/provider-api-keys-service';
import type { AdminProviderMutationInput, AdminProviderKeyMutationInput, AdminProvidersImportBody, AdminProvidersImportOutput } from '@/lib/services/admin/types';
import { handleAdminRouteError } from './error-response';
import { normalizeApiTimeFields } from '@octafuse/core/lib/time-format';
export const adminProvidersRoutes = new Hono<AdminEnv>();

adminProvidersRoutes.use('*', requireMasterKey);

/** 全量列表。 */
adminProvidersRoutes.get('/', async (c) => {
	try {
		const repos = c.get('repositories');
		const data = await listProvidersService(repos);
		return c.json(normalizeApiTimeFields({ success: true, data, count: data.length }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to list providers');
	}
});

/** body 含各协议 base_url、api_key 等。 */
adminProvidersRoutes.post('/', async (c) => {
	let body: AdminProviderMutationInput;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ success: false, message: 'Invalid JSON body' }, 400);
	}
	try {
		const repos = c.get('repositories');
		const data = await createProviderService(repos, body);
		return c.json(normalizeApiTimeFields({ success: true, message: 'Provider created successfully', data }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to create provider');
	}
});

/** 列出内置 Provider 导入模板（无密钥）。须注册在 `/:id` 之前。 */
adminProvidersRoutes.get('/import/catalog', async (c) => {
	try {
		const data = listStaticProviderImportCatalogForAdmin();
		return c.json(normalizeApiTimeFields({ success: true, data, count: data.length }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to list provider import catalog');
	}
});

/** 从静态模板批量创建 Provider（同 id 不覆盖；写入占位 API Key）。 */
adminProvidersRoutes.post('/import', async (c) => {
	let body: AdminProvidersImportBody;
	try {
		const raw = await c.req.json();
		body = raw as AdminProvidersImportBody;
	} catch {
		return c.json({ success: false, message: 'Invalid JSON body' }, 400);
	}
	try {
		const repos = c.get('repositories');
		const data: AdminProvidersImportOutput = await importProvidersFromStaticPresetsService(repos, {
			ids: Array.isArray(body.ids) ? body.ids : [],
		});
		const parts = [`created ${data.created}`];
		if (data.skipped_existing.length) {
			parts.push(`skipped ${data.skipped_existing.length} existing`);
		}
		if (data.failed.length) {
			parts.push(`${data.failed.length} failed`);
		}
		return c.json(
			normalizeApiTimeFields({
				success: true,
				message: `Import finished (${parts.join(', ')}).`,
				data,
			})
		);
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to import providers');
	}
});

/** `:id` 为 D1 行 id。 */
adminProvidersRoutes.get('/:id/keys', async (c) => {
	const providerId = c.req.param('id');
	try {
		const repos = c.get('repositories');
		const data = await listProviderKeysService(repos, providerId);
		return c.json(normalizeApiTimeFields({ success: true, data, count: data.length }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to list provider keys');
	}
});

adminProvidersRoutes.post('/:id/keys', async (c) => {
	const providerId = c.req.param('id');
	let body: AdminProviderKeyMutationInput;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ success: false, message: 'Invalid JSON body' }, 400);
	}
	try {
		const repos = c.get('repositories');
		const data = await createProviderKeyService(repos, providerId, body);
		return c.json(normalizeApiTimeFields({ success: true, message: 'Provider key created successfully', data }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to create provider key');
	}
});

adminProvidersRoutes.get('/:id/keys/:keyId', async (c) => {
	const providerId = c.req.param('id');
	const keyId = c.req.param('keyId');
	try {
		const repos = c.get('repositories');
		const data = await revealProviderKeyService(repos, providerId, keyId);
		return c.json({ success: true, data });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to reveal provider key');
	}
});

adminProvidersRoutes.patch('/:id/keys/:keyId', async (c) => {
	const providerId = c.req.param('id');
	const keyId = c.req.param('keyId');
	let body: AdminProviderKeyMutationInput;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ success: false, message: 'Invalid JSON body' }, 400);
	}
	try {
		const repos = c.get('repositories');
		await updateProviderKeyService(repos, providerId, keyId, body);
		return c.json({ success: true, message: 'Provider key updated successfully' });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to update provider key');
	}
});

adminProvidersRoutes.delete('/:id/keys/:keyId', async (c) => {
	const providerId = c.req.param('id');
	const keyId = c.req.param('keyId');
	try {
		const repos = c.get('repositories');
		await deleteProviderKeyService(repos, providerId, keyId);
		return c.json({ success: true, message: 'Provider key deleted successfully' });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to delete provider key');
	}
});

/** `:id` 为 D1 行 id。 */
adminProvidersRoutes.get('/:id', async (c) => {
	const id = c.req.param('id');
	try {
		const repos = c.get('repositories');
		const provider = await getProviderService(repos, id);
		return c.json(normalizeApiTimeFields({ success: true, data: provider }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to get provider');
	}
});

/** 部分更新。 */
adminProvidersRoutes.patch('/:id', async (c) => {
	const id = c.req.param('id');
	let body: AdminProviderMutationInput;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ success: false, message: 'Invalid JSON body' }, 400);
	}
	try {
		const repos = c.get('repositories');
		await updateProviderService(repos, id, body);
		return c.json({ success: true, message: 'Provider updated successfully' });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to update provider');
	}
});

/** 删除供应商行。 */
adminProvidersRoutes.delete('/:id', async (c) => {
	const id = c.req.param('id');
	try {
		const repos = c.get('repositories');
		await deleteProviderService(repos, id);
		return c.json({ success: true, message: 'Provider deleted successfully' });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to delete provider');
	}
});
