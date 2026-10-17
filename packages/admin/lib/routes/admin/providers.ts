/**
 * 管理路由：`/admin/providers` — 上游供应商账号 CRUD，委托 `providers-service`。
 */
import { Hono } from "hono";
import type { AdminEnv } from "@/lib/admin-env";
import { requireAdminPrincipal } from "@/lib/middleware/admin-auth";
import { listStaticProviderImportCatalogForAdmin } from "@/lib/provider-import-preset";
import {
	createProviderService,
	deleteProviderService,
	getProviderService,
	importProvidersFromStaticPresetsService,
	listProvidersService,
	revealProviderApiKeyService,
	updateProviderService,
} from "@/lib/services/admin/providers-service";
import { getProviderQuotaService } from "@/lib/services/admin/provider-quota-service";
import {
	applyProviderSyncService,
	getProviderSyncReportService,
} from "@/lib/services/admin/provider-sync-service";
import type { ProviderSyncApplyBody } from "@/lib/provider-sync-diff";
import {
	proxyDashScopeAudioResourceService,
	type DashScopeAudioResource,
} from "@/lib/services/admin/dashscope-resources-service";
import type {
	AdminProviderMutationInput,
	AdminProvidersImportBody,
	AdminProvidersImportOutput,
} from "@/lib/services/admin/types";
import { handleAdminRouteError } from "./error-response";
import { normalizeApiTimeFields } from "@octafuse/core/lib/time-format";

export const adminProvidersRoutes = new Hono<AdminEnv>();

adminProvidersRoutes.use("*", requireAdminPrincipal);

/** 全量列表。 */
adminProvidersRoutes.get("/", async (c) => {
	try {
		const repos = c.get("repositories");
		const data = await listProvidersService(repos);
		return c.json(
			normalizeApiTimeFields({ success: true, data, count: data.length })
		);
	} catch (error) {
		return handleAdminRouteError(c, error, "Failed to list providers");
	}
});

/** body 含各协议 base_url、api_key、status 等。 */
adminProvidersRoutes.post("/", async (c) => {
	let body: AdminProviderMutationInput;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ success: false, message: "Invalid JSON body" }, 400);
	}
	try {
		const repos = c.get("repositories");
		const data = await createProviderService(repos, body);
		return c.json(
			normalizeApiTimeFields({
				success: true,
				message: "Provider created successfully",
				data,
			})
		);
	} catch (error) {
		return handleAdminRouteError(c, error, "Failed to create provider");
	}
});

/** 列出内置 Provider 导入模板（无密钥）。须注册在 `/:id` 之前。 */
adminProvidersRoutes.get("/import/catalog", async (c) => {
	try {
		const data = listStaticProviderImportCatalogForAdmin();
		return c.json(
			normalizeApiTimeFields({ success: true, data, count: data.length })
		);
	} catch (error) {
		return handleAdminRouteError(
			c,
			error,
			"Failed to list provider import catalog"
		);
	}
});

/** 从静态模板批量创建 Provider（每次新增；自动生成 id 与唯一显示名）。 */
adminProvidersRoutes.post("/import", async (c) => {
	let body: AdminProvidersImportBody;
	try {
		const raw = await c.req.json();
		body = raw as AdminProvidersImportBody;
	} catch {
		return c.json({ success: false, message: "Invalid JSON body" }, 400);
	}
	try {
		const repos = c.get("repositories");
		const data: AdminProvidersImportOutput =
			await importProvidersFromStaticPresetsService(repos, {
				ids: Array.isArray(body.ids) ? body.ids : [],
				locale: typeof body.locale === 'string' ? body.locale : undefined,
			});
		const parts = [`created ${data.created}`];
		if (data.failed.length) {
			parts.push(`${data.failed.length} failed`);
		}
		return c.json(
			normalizeApiTimeFields({
				success: true,
				message: `Import finished (${parts.join(", ")}).`,
				data,
			})
		);
	} catch (error) {
		return handleAdminRouteError(c, error, "Failed to import providers");
	}
});

/** 与官方模板的差异报告（按模板类型分组）。须注册在 `/:id` 之前。 */
adminProvidersRoutes.get("/sync/diff", async (c) => {
	try {
		const repos = c.get("repositories");
		const data = await getProviderSyncReportService(repos, c.req.query("locale"));
		return c.json(normalizeApiTimeFields({ success: true, data }));
	} catch (error) {
		return handleAdminRouteError(c, error, "Failed to compute provider sync diff");
	}
});

/** 把选中的官方值写入 provider（只写 description / endpoints；服务端重算差异）。 */
adminProvidersRoutes.post("/sync/apply", async (c) => {
	let body: ProviderSyncApplyBody;
	try {
		body = (await c.req.json()) as ProviderSyncApplyBody;
	} catch {
		return c.json({ success: false, message: "Invalid JSON body" }, 400);
	}
	try {
		const repos = c.get("repositories");
		const data = await applyProviderSyncService(repos, body);
		const parts = [`updated ${data.updated}`];
		if (data.skipped) parts.push(`${data.skipped} skipped`);
		if (data.failed.length) parts.push(`${data.failed.length} failed`);
		return c.json(
			normalizeApiTimeFields({
				success: true,
				message: `Sync finished (${parts.join(", ")}).`,
				data,
			})
		);
	} catch (error) {
		return handleAdminRouteError(c, error, "Failed to sync providers");
	}
});

/** 实时查询供应商额度。不回显密钥。须注册在 `/:id` 之前。 */
adminProvidersRoutes.get("/:id/quota", async (c) => {
	const providerId = c.req.param("id");
	try {
		const repos = c.get("repositories");
		const data = await getProviderQuotaService(repos, providerId);
		return c.json(normalizeApiTimeFields({ success: true, data }));
	} catch (error) {
		return handleAdminRouteError(c, error, "Failed to query provider quota");
	}
});

/** 揭示供应商明文 API Key。须注册在 `/:id` 之前。 */
adminProvidersRoutes.get("/:id/api-key", async (c) => {
	const providerId = c.req.param("id");
	try {
		const repos = c.get("repositories");
		const data = await revealProviderApiKeyService(repos, providerId);
		return c.json({ success: true, data });
	} catch (error) {
		return handleAdminRouteError(c, error, "Failed to reveal provider API key");
	}
});

/** DashScope 热词/音色是供应商账号级资源，必须使用管理员鉴权，且保持官方请求体原样。 */
adminProvidersRoutes.post("/:id/dashscope/:resource", async (c) => {
	const providerId = c.req.param("id");
	const resource = c.req.param("resource");
	if (resource !== "hotwords" && resource !== "voices") {
		return c.json(
			{ success: false, message: "Unsupported DashScope audio resource" },
			404
		);
	}
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ success: false, message: "Invalid JSON body" }, 400);
	}
	try {
		const repos = c.get("repositories");
		return await proxyDashScopeAudioResourceService(
			repos,
			providerId,
			resource as DashScopeAudioResource,
			body
		);
	} catch (error) {
		return handleAdminRouteError(
			c,
			error,
			`Failed to manage DashScope ${resource}`
		);
	}
});

/** `:id` 为 D1 行 id。 */
adminProvidersRoutes.get("/:id", async (c) => {
	const id = c.req.param("id");
	try {
		const repos = c.get("repositories");
		const provider = await getProviderService(repos, id);
		return c.json(normalizeApiTimeFields({ success: true, data: provider }));
	} catch (error) {
		return handleAdminRouteError(c, error, "Failed to get provider");
	}
});

/** 部分更新。 */
adminProvidersRoutes.patch("/:id", async (c) => {
	const id = c.req.param("id");
	let body: AdminProviderMutationInput;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ success: false, message: "Invalid JSON body" }, 400);
	}
	try {
		const repos = c.get("repositories");
		await updateProviderService(repos, id, body);
		return c.json({ success: true, message: "Provider updated successfully" });
	} catch (error) {
		return handleAdminRouteError(c, error, "Failed to update provider");
	}
});

/** 删除供应商行。 */
adminProvidersRoutes.delete("/:id", async (c) => {
	const id = c.req.param("id");
	try {
		const repos = c.get("repositories");
		await deleteProviderService(repos, id);
		return c.json({ success: true, message: "Provider deleted successfully" });
	} catch (error) {
		return handleAdminRouteError(c, error, "Failed to delete provider");
	}
});
