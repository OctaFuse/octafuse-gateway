/**
 * 健康检查：`GET /health`，负载均衡与探活使用。
 */
import { Hono } from 'hono';
import type { Env } from '../app';

export const healthRoutes = new Hono<Env>();

/**
 * 轻量探活：不额外探测 DB。维护模式开启时仍返回 200（避免负载均衡误判节点下线），
 * 仅附加 `maintenance: true`（标记来自守卫已缓存的配置；读配置失败时省略）。
 */
healthRoutes.get('/', (c) => {
	if (c.get('maintenance')) {
		return c.json({ status: 'ok', service: 'octafuse-proxy', maintenance: true }, 200, {
			'X-OctaFuse-Maintenance': '1',
		});
	}
	return c.json({ status: 'ok', service: 'octafuse-proxy' });
});
