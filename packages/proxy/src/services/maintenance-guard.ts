/**
 * 维护模式守卫：`system_config.MAINTENANCE_MODE` 开启时，推理类入口一律 503。
 *
 * - 放行：`/`、`/health`、模型列表、`/v1/me`、工具价目、`/catalog`、OAuth 受保护资源元数据（只读，且探活不能误判下线）。
 * - 拒绝发生在鉴权之前，不写请求日志、不扣费、不占 RPM，因此能真正冻结账务写入。
 * - 读配置失败时 fail-open：宁可继续服务，也不因为配置读取故障把全网流量打成 503。
 * - 错误体按入口协议给出各 SDK 能解析的形状，并统一附带顶层 `code` / `message`。
 */
import { createMiddleware } from 'hono/factory';
import {
	getMaintenanceConfig,
	maintenanceRetryAfterSeconds,
	resolveMaintenanceMessage,
	type MaintenanceConfig,
} from '@octafuse/core';
import type { Env } from '../app';
import { isAnthropicMessagesPath } from '../middleware/auth';
import { GATEWAY_ERROR_CODE_HEADER, GatewayErrorCode } from './gateway-error-codes';

export const MAINTENANCE_HEADER = 'X-OctaFuse-Maintenance';

type ErrorShape = 'openai' | 'anthropic' | 'gemini';

/** 维护期间仍可访问的只读路径。其它路径（含所有 WebSocket 升级与 `/mcp`）都视为推理入口。 */
export function isMaintenanceExemptRequest(method: string, path: string): boolean {
	if (path === '/' || path === '/health' || path === '/health/') return true;
	if (path === '/catalog' || path.startsWith('/catalog/')) return method === 'GET' || method === 'HEAD';
	// MCP OAuth 受保护资源元数据（RFC 9728）：只读发现文档，不属于推理入口。
	if (path === '/.well-known/oauth-protected-resource' || path.startsWith('/.well-known/oauth-protected-resource/')) {
		return method === 'GET' || method === 'HEAD';
	}
	if (method !== 'GET' && method !== 'HEAD') return false;
	if (path === '/v1/models' || path.startsWith('/v1/models/')) return true;
	if (path === '/v1/me' || path === '/v1/me/') return true;
	if (path === '/v1/tools/pricing' || path === '/v1/tools/pricing/') return true;
	// Gemini 模型列表 / 详情；`models/x:generateContent` 带冒号，不在此列。
	return /^\/v1beta\/models(\/[^:/]+)?\/?$/.test(path);
}

function errorShapeForPath(path: string): ErrorShape {
	if (isAnthropicMessagesPath(path)) return 'anthropic';
	if (path === '/v1beta' || path.startsWith('/v1beta/')) return 'gemini';
	return 'openai';
}

export function buildMaintenanceBody(shape: ErrorShape, message: string, retryAfterSeconds: number): Record<string, unknown> {
	const code = GatewayErrorCode.maintenance;
	switch (shape) {
		case 'anthropic':
			return { type: 'error', error: { type: 'api_error', message }, code, message };
		case 'gemini':
			return { error: { code: 503, message, status: 'UNAVAILABLE' }, code, message };
		default:
			return {
				error: { message, type: 'service_unavailable', code, retry_after_seconds: retryAfterSeconds },
				code,
				message,
			};
	}
}

/** 纯函数：给定配置与请求，返回要发出的 503；不需要拦截则返回 null。 */
export function maintenanceResponseFor(
	config: MaintenanceConfig,
	request: { method: string; path: string; acceptLanguage?: string | null },
	now: Date = new Date()
): Response | null {
	if (!config.enabled) return null;
	if (isMaintenanceExemptRequest(request.method.toUpperCase(), request.path)) return null;
	const message = resolveMaintenanceMessage(config, request.acceptLanguage, now);
	const retryAfter = maintenanceRetryAfterSeconds(config, now);
	return new Response(JSON.stringify(buildMaintenanceBody(errorShapeForPath(request.path), message, retryAfter)), {
		status: 503,
		headers: {
			'Content-Type': 'application/json',
			'Retry-After': String(retryAfter),
			[GATEWAY_ERROR_CODE_HEADER]: GatewayErrorCode.maintenance,
			[MAINTENANCE_HEADER]: '1',
		},
	});
}

/** 必须放在 `repositories` 注入之后、任何路由之前。 */
export const maintenanceGuard = createMiddleware<Env>(async (c, next) => {
	let config: MaintenanceConfig | null = null;
	try {
		config = await getMaintenanceConfig(c.get('repositories'));
	} catch (error) {
		console.warn('[Gateway Maintenance] failed to read MAINTENANCE_MODE, serving normally', error);
	}
	if (config?.enabled) {
		c.set('maintenance', true);
		const blocked = maintenanceResponseFor(config, {
			method: c.req.method,
			path: c.req.path,
			acceptLanguage: c.req.header('Accept-Language'),
		});
		if (blocked) return blocked;
	}
	await next();
});
