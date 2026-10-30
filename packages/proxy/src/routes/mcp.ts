/**
 * `POST /mcp` aggregates every enabled upstream.
 * `POST /mcp/:slug` exposes one server.
 * Stateless Streamable HTTP: no session id, GET is 405.
 */
import { Hono } from 'hono';
import { requireMcpCaller, type McpCaller, type McpEnv } from '../middleware/mcp-auth';
import { handleMcpAggregateRequest, mcpAggregateDeps } from '../services/mcp/aggregate';

export const mcpRoutes = new Hono<McpEnv>();

mcpRoutes.use('*', requireMcpCaller);

async function serve(c: { req: { raw: Request; param: (name: string) => string | undefined }; get: (key: 'mcpCaller' | 'repositories') => unknown }) {
	const slug = c.req.param('slug')?.trim() || null;
	if (slug === 'builtin') {
		return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32602, message: 'Unknown MCP server' }, id: null }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' },
		});
	}
	const caller = c.get('mcpCaller') as McpCaller;
	const repos = c.get('repositories') as Parameters<typeof mcpAggregateDeps>[0];
	return handleMcpAggregateRequest(c.req.raw, {
		caller,
		slug,
		deps: mcpAggregateDeps(repos),
	});
}

mcpRoutes.all('/', (c) => serve(c));
mcpRoutes.all('/:slug', (c) => serve(c));
