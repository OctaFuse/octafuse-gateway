/**
 * `GET /.well-known/oauth-protected-resource[/mcp[/{slug}]]`（RFC 9728）。
 * 无需鉴权；未配置 `MCP_OAUTH_AUTHORIZATION_SERVER` 时返回 404，行为与未接入前一致。
 */
import { Hono } from 'hono';
import type { Env } from '../app';
import {
	buildProtectedResourceMetadata,
	publicOrigin,
	readMcpOAuthAuthorizationServer,
} from '../services/mcp/oauth-discovery';

export const oauthProtectedResourceRoutes = new Hono<Env>();

async function serve(c: Parameters<typeof publicOrigin>[0] & { get: (k: 'repositories') => unknown; json: (b: unknown, s?: number, h?: Record<string, string>) => Response }, mcpPath: string) {
	const repos = c.get('repositories') as Parameters<typeof readMcpOAuthAuthorizationServer>[0];
	const server = await readMcpOAuthAuthorizationServer(repos);
	if (!server) return c.json({ error: 'Not found' }, 404);
	return c.json(
		buildProtectedResourceMetadata({ origin: publicOrigin(c), mcpPath, authorizationServer: server }),
		200,
		{ 'Cache-Control': 'public, max-age=300' }
	);
}

// 根路径形式：资源即聚合入口 /mcp
oauthProtectedResourceRoutes.get('/', (c) => serve(c, '/mcp'));
// 路径后缀形式：/.well-known/oauth-protected-resource/mcp[/{slug}]
oauthProtectedResourceRoutes.get('/mcp', (c) => serve(c, '/mcp'));
oauthProtectedResourceRoutes.get('/mcp/:slug', (c) => serve(c, `/mcp/${c.req.param('slug')}`));
