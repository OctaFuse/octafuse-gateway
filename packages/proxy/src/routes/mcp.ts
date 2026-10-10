/**
 * `POST /mcp` aggregates every enabled upstream.
 * `POST /mcp/:slug` exposes one server.
 * Stateless Streamable HTTP: no session id, GET is 405.
 */
import { Hono } from 'hono';
import type { Env } from '../app';
import { requireApiKey, type ApiKeyContext } from '../middleware/auth';
import { handleMcpAggregateRequest, mcpAggregateDeps } from '../services/mcp/aggregate';

type McpEnv = Env & { Variables: { apiKey: ApiKeyContext } };

export const mcpRoutes = new Hono<McpEnv>();

mcpRoutes.use('*', requireApiKey);

async function serve(c: { req: { raw: Request; param: (name: string) => string | undefined }; get: (key: 'apiKey' | 'repositories') => unknown }) {
	const slug = c.req.param('slug')?.trim() || null;
	if (slug === 'builtin') {
		return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32602, message: 'Unknown MCP server' }, id: null }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' },
		});
	}
	const apiKey = c.get('apiKey') as ApiKeyContext;
	const repos = c.get('repositories') as Parameters<typeof mcpAggregateDeps>[0];
	return handleMcpAggregateRequest(c.req.raw, {
		apiKey,
		slug,
		deps: mcpAggregateDeps(repos),
	});
}

mcpRoutes.all('/', (c) => serve(c));
mcpRoutes.all('/:slug', (c) => serve(c));
