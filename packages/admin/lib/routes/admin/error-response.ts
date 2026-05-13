/**
 * 管理路由统一错误响应：将 `AdminServiceError` 映射为 JSON，其余记日志并返回 500。
 */
import type { Context } from 'hono';
import { isAdminServiceError } from '@/lib/services/admin/errors';

/** 返回 `{ success: false, message }` JSON，不经过 Hono `c.json`（与部分路由错误体一致）。 */
export function jsonErr(c: Context, status: number, message: string) {
	return new Response(JSON.stringify({ success: false as const, message }), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});
}

/**
 * `AdminServiceError` → 对应 status；否则 500 并打日志。
 */
export function handleAdminRouteError(c: Context, error: unknown, fallbackMessage: string) {
	if (isAdminServiceError(error)) {
		return jsonErr(c, error.status, error.message);
	}
	console.error('[admin] route error:', error);
	return jsonErr(c, 500, fallbackMessage);
}
