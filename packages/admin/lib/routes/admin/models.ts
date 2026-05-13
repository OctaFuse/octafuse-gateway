/**
 * 管理路由：`/admin/models` — 统一模型目录与标签 CRUD，委托 `models-service`。
 */
import { Hono } from 'hono';
import type { AdminEnv } from '@/lib/admin-env';
import { requireMasterKey } from '@/lib/middleware/admin-auth';
import {
	createModelService,
	deleteModelService,
	getModelService,
	importModelsFromStaticPresetsService,
	listModelsService,
	listStaticModelPresetCatalogForAdmin,
	updateModelService,
} from '@/lib/services/admin/models-service';
import type {
	AdminModelMutationInput,
	AdminModelsImportBody,
	AdminModelsImportOutput,
} from '@/lib/services/admin/types';
import { handleAdminRouteError } from './error-response';
import { normalizeApiTimeFields } from '@octafuse/core/lib/time-format';
export const adminModelsRoutes = new Hono<AdminEnv>();

adminModelsRoutes.use('*', requireMasterKey);

/** 全量列表（含 tags）。 */
adminModelsRoutes.get('/', async (c) => {
	try {
		const repos = c.get('repositories');
		const data = await listModelsService(repos);
		return c.json(normalizeApiTimeFields({ success: true, data, count: data.length }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to list models');
	}
});

/** 新建模型与标签关联。 */
adminModelsRoutes.post('/', async (c) => {
	let body: AdminModelMutationInput;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ success: false, message: 'Invalid JSON body' }, 400);
	}
	try {
		const repos = c.get('repositories');
		const data = await createModelService(repos, body);
		return c.json(normalizeApiTimeFields({ success: true, message: 'Model created successfully', data }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to create model');
	}
});

/** 列出内置静态目录中可导入的模型（不含完整 pricing JSON）。 */
adminModelsRoutes.get('/import/catalog', async (c) => {
	try {
		const data = listStaticModelPresetCatalogForAdmin();
		return c.json(normalizeApiTimeFields({ success: true, data, count: data.length }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to list import catalog');
	}
});

/** 从内置静态目录按请求体 `ids` 导入模型（按 `BILLING_CURRENCY` 选用 USD/CNY 价；同 id 不覆盖）。 */
adminModelsRoutes.post('/import', async (c) => {
	let body: AdminModelsImportBody;
	try {
		const raw = await c.req.json();
		body = raw as AdminModelsImportBody;
	} catch {
		return c.json({ success: false, message: 'Invalid JSON body' }, 400);
	}
	try {
		const repos = c.get('repositories');
		const data: AdminModelsImportOutput = await importModelsFromStaticPresetsService(repos, {
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
				message: `Import finished (${parts.join(', ')}); billing branch ${data.billing_currency_used}.`,
				data,
			})
		);
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to import models');
	}
});

/** `:id` 为 models 表 id。 */
adminModelsRoutes.get('/:id', async (c) => {
	const id = c.req.param('id');
	try {
		const repos = c.get('repositories');
		const model = await getModelService(repos, id);
		return c.json(normalizeApiTimeFields({ success: true, data: model }));
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to get model');
	}
});

/** 部分更新模型与标签。 */
adminModelsRoutes.patch('/:id', async (c) => {
	const id = c.req.param('id');
	let body: AdminModelMutationInput;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ success: false, message: 'Invalid JSON body' }, 400);
	}
	try {
		const repos = c.get('repositories');
		await updateModelService(repos, id, body);
		return c.json({ success: true, message: 'Model updated successfully' });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to update model');
	}
});

/** 级联删除模型及其路由、标签（见 `deleteModelService`）。 */
adminModelsRoutes.delete('/:id', async (c) => {
	const id = c.req.param('id');
	try {
		const repos = c.get('repositories');
		await deleteModelService(repos, id);
		return c.json({ success: true, message: 'Model deleted successfully' });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to delete model');
	}
});
