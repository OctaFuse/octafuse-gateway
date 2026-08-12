/**
 * 路由级兜底：入口已完成 Session/Bearer 认证并注入 Principal。
 */
import { createMiddleware } from 'hono/factory';
import type { AdminEnv } from '@/lib/admin-env';

export const requireAdminPrincipal = createMiddleware<AdminEnv>(async (c, next) => {
	if (!c.get('principal')) {
		return c.json({ error: 'Unauthorized' }, 401);
	}
	await next();
});
