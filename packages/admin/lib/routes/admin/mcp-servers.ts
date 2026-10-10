/**
 * `/admin/mcp-servers` — register remote MCP servers and review their catalog.
 */
import { Hono } from 'hono';
import type { AdminEnv } from '@/lib/admin-env';
import { requireAdminPrincipal } from '@/lib/middleware/admin-auth';
import { hasAdminPermission } from '@/lib/admin-principal';
import { handleAdminRouteError, jsonErr } from './error-response';
import {
	acceptMcpItemChange,
	createMcpServer,
	deleteMcpServer,
	getMcpServer,
	listMcpServers,
	revealMcpServer,
	setMcpItemPrice,
	setMcpItemStatus,
	syncMcpServer,
	testMcpServer,
	updateMcpServer,
	type CreateMcpServerInput,
} from '@/lib/services/admin/mcp-servers-service';

export const adminMcpServersRoutes = new Hono<AdminEnv>();

adminMcpServersRoutes.use('*', requireAdminPrincipal);

function canReadSecrets(c: { get: (key: 'principal') => Parameters<typeof hasAdminPermission>[0] }): boolean {
	return hasAdminPermission(c.get('principal'), 'mcp.secrets.read');
}

adminMcpServersRoutes.get('/', async (c) => {
	try {
		return c.json({ success: true, data: await listMcpServers(c.get('repositories')) });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to list MCP servers');
	}
});

adminMcpServersRoutes.post('/', async (c) => {
	let body: CreateMcpServerInput;
	try {
		body = await c.req.json();
	} catch {
		return jsonErr(c, 400, 'Invalid JSON body');
	}
	try {
		const data = await createMcpServer(c.get('repositories'), body);
		return c.json({ success: true, data });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to create MCP server');
	}
});

adminMcpServersRoutes.get('/:id/reveal', async (c) => {
	if (!canReadSecrets(c)) {
		return jsonErr(c, 403, 'Missing permission');
	}
	try {
		return c.json({ success: true, data: await revealMcpServer(c.get('repositories'), c.req.param('id')) });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to reveal MCP server');
	}
});

adminMcpServersRoutes.get('/:id', async (c) => {
	try {
		return c.json({ success: true, data: await getMcpServer(c.get('repositories'), c.req.param('id')) });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to get MCP server');
	}
});

adminMcpServersRoutes.patch('/:id', async (c) => {
	let body: CreateMcpServerInput;
	try {
		body = await c.req.json();
	} catch {
		return jsonErr(c, 400, 'Invalid JSON body');
	}
	try {
		const data = await updateMcpServer(c.get('repositories'), c.req.param('id'), body);
		return c.json({ success: true, data });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to update MCP server');
	}
});

adminMcpServersRoutes.delete('/:id', async (c) => {
	try {
		await deleteMcpServer(c.get('repositories'), c.req.param('id'));
		return c.json({ success: true });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to delete MCP server');
	}
});

adminMcpServersRoutes.post('/:id/test', async (c) => {
	try {
		return c.json({ success: true, data: await testMcpServer(c.get('repositories'), c.req.param('id')) });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to test MCP server');
	}
});

adminMcpServersRoutes.post('/:id/sync', async (c) => {
	try {
		return c.json({ success: true, data: await syncMcpServer(c.get('repositories'), c.req.param('id')) });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to sync MCP server');
	}
});

adminMcpServersRoutes.post('/:id/items/status', async (c) => {
	let body: { ids?: unknown; status?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return jsonErr(c, 400, 'Invalid JSON body');
	}
	try {
		const data = await setMcpItemStatus(c.get('repositories'), c.req.param('id'), body.ids, body.status);
		return c.json({ success: true, data });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to update MCP items');
	}
});

adminMcpServersRoutes.patch('/:id/items/:itemId', async (c) => {
	let body: { metered?: unknown; standard?: unknown; charged?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return jsonErr(c, 400, 'Invalid JSON body');
	}
	try {
		const data = await setMcpItemPrice(c.get('repositories'), c.req.param('id'), c.req.param('itemId'), body);
		return c.json({ success: true, data });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to update MCP item price');
	}
});

adminMcpServersRoutes.post('/:id/items/:itemId/accept', async (c) => {
	try {
		const data = await acceptMcpItemChange(c.get('repositories'), c.req.param('id'), c.req.param('itemId'));
		return c.json({ success: true, data });
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to accept MCP item change');
	}
});
