/**
 * 健康检查：`GET /health`，负载均衡与探活使用。
 */
import { Hono } from 'hono';
import type { Env } from '../app';

export const healthRoutes = new Hono<Env>();

/** 返回固定 JSON，不做 DB 探测（轻量探活）。 */
healthRoutes.get('/', (c) => {
	return c.json({ status: 'ok', service: 'octafuse-proxy' });
});
