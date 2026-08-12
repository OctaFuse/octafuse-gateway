import { Hono } from 'hono';
import type { AdminApiKeyRow } from '@octafuse/core';
import type { AdminEnv } from '@/lib/admin-env';
import { ADMIN_PERMISSIONS, normalizeAdminPermissions, parseAdminPermissions } from '@/lib/admin-principal';
import { generateAdminApiKey } from '@/lib/auth';

export const adminAccessKeysRoutes = new Hono<AdminEnv>();

const SECRET_KEY_RE = /^sk-admin-[0-9a-f]{64}$/i;

function publicKey(row: AdminApiKeyRow) {
	const safePrefix = row.keyPrefix.slice(0, Math.max(0, row.secretKey.length - 4));
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		key: `${safePrefix}••••••••`,
		key_prefix: safePrefix,
		permissions: parseAdminPermissions(row.permissionsJson),
		status: row.status,
		last_used_at: row.lastUsedAt,
		created_at: row.createdAt,
		updated_at: row.updatedAt,
		revoked_at: row.revokedAt,
	};
}

function parsePermissions(value: unknown): string[] | null {
	if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && ADMIN_PERMISSIONS.includes(item as never))) {
		return null;
	}
	const normalized = normalizeAdminPermissions(value);
	return normalized.length > 0 ? normalized : null;
}

function isUniqueConflict(error: unknown): boolean {
	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
	return message.includes('unique') || message.includes('duplicate');
}

function parseOptionalSecret(value: unknown): string | null | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'string' || !SECRET_KEY_RE.test(value.trim())) return null;
	return value.trim();
}

adminAccessKeysRoutes.get('/', async (c) => {
	const rows = await c.get('repositories').adminAccess.listApiKeys();
	return c.json({ success: true, data: rows.map(publicKey) });
});

adminAccessKeysRoutes.post('/', async (c) => {
	let body: { name?: unknown; description?: unknown; permissions?: unknown; secret_key?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ success: false, message: 'Invalid JSON body' }, 400);
	}
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	const permissions = parsePermissions(body.permissions);
	const providedSecret = parseOptionalSecret(body.secret_key);
	if (body.secret_key !== undefined && providedSecret === null) {
		return c.json({ success: false, message: 'Invalid secret_key' }, 400);
	}
	if (!name || name.length > 255 || !permissions) {
		return c.json({ success: false, message: 'Invalid name or permissions' }, 400);
	}
	const secretKey = providedSecret ?? generateAdminApiKey();
	const id = crypto.randomUUID();
	try {
		await c.get('repositories').adminAccess.insertApiKey({
			id,
			name,
			description: typeof body.description === 'string' ? body.description.trim() || null : null,
			secretKey,
			keyPrefix: secretKey.slice(0, 12),
			permissionsJson: JSON.stringify(permissions),
		});
	} catch (error) {
		if (isUniqueConflict(error)) return c.json({ success: false, message: 'Admin API key name already exists' }, 409);
		throw error;
	}
	const row = await c.get('repositories').adminAccess.getApiKeyById(id);
	return c.json({ success: true, data: { ...publicKey(row!), key: secretKey } }, 201);
});

adminAccessKeysRoutes.get('/:id/secret', async (c) => {
	const row = await c.get('repositories').adminAccess.getApiKeyById(c.req.param('id'));
	if (!row) return c.json({ success: false, message: 'Admin API key not found' }, 404);
	return c.json({ success: true, data: { id: row.id, key: row.secretKey } });
});

adminAccessKeysRoutes.post('/:id/rotate', async (c) => {
	const secretKey = generateAdminApiKey();
	const updated = await c.get('repositories').adminAccess.rotateApiKey(c.req.param('id'), secretKey, secretKey.slice(0, 12));
	if (!updated) return c.json({ success: false, message: 'Active Admin API key not found' }, 404);
	return c.json({ success: true, data: { id: c.req.param('id'), key: secretKey } });
});

adminAccessKeysRoutes.post('/:id/revoke', async (c) => {
	const updated = await c.get('repositories').adminAccess.revokeApiKey(c.req.param('id'));
	if (!updated) return c.json({ success: false, message: 'Active Admin API key not found' }, 404);
	return c.json({ success: true });
});

adminAccessKeysRoutes.get('/:id', async (c) => {
	const row = await c.get('repositories').adminAccess.getApiKeyById(c.req.param('id'));
	if (!row) return c.json({ success: false, message: 'Admin API key not found' }, 404);
	return c.json({ success: true, data: publicKey(row) });
});

adminAccessKeysRoutes.patch('/:id', async (c) => {
	let body: {
		name?: unknown;
		description?: unknown;
		permissions?: unknown;
		status?: unknown;
		secret_key?: unknown;
	};
	try {
		body = await c.req.json();
	} catch {
		return c.json({ success: false, message: 'Invalid JSON body' }, 400);
	}
	const patch: {
		name?: string;
		description?: string | null;
		permissionsJson?: string;
		secretKey?: string;
		keyPrefix?: string;
		status?: 'active' | 'revoked';
		revokedAt?: string | null;
	} = {};
	if (body.name !== undefined) {
		if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 255) {
			return c.json({ success: false, message: 'Invalid name' }, 400);
		}
		patch.name = body.name.trim();
	}
	if (body.description !== undefined) {
		if (body.description !== null && typeof body.description !== 'string') {
			return c.json({ success: false, message: 'Invalid description' }, 400);
		}
		patch.description = typeof body.description === 'string' ? body.description.trim() || null : null;
	}
	if (body.permissions !== undefined) {
		const permissions = parsePermissions(body.permissions);
		if (!permissions) return c.json({ success: false, message: 'Invalid permissions' }, 400);
		patch.permissionsJson = JSON.stringify(permissions);
	}
	if (body.status !== undefined) {
		if (body.status !== 'active' && body.status !== 'revoked') {
			return c.json({ success: false, message: 'Invalid status' }, 400);
		}
		patch.status = body.status;
		patch.revokedAt = body.status === 'revoked' ? new Date().toISOString() : null;
	}
	if (body.secret_key !== undefined) {
		const secretKey = parseOptionalSecret(body.secret_key);
		if (secretKey === null || secretKey === undefined) {
			return c.json({ success: false, message: 'Invalid secret_key' }, 400);
		}
		patch.secretKey = secretKey;
		patch.keyPrefix = secretKey.slice(0, 12);
	}
	if (Object.keys(patch).length === 0) {
		return c.json({ success: false, message: 'No changes supplied' }, 400);
	}
	let updated: boolean;
	try {
		updated = await c.get('repositories').adminAccess.updateApiKey(c.req.param('id'), patch);
	} catch (error) {
		if (isUniqueConflict(error)) return c.json({ success: false, message: 'Admin API key name already exists' }, 409);
		throw error;
	}
	if (!updated) return c.json({ success: false, message: 'Admin API key not found or no changes supplied' }, 404);
	const row = await c.get('repositories').adminAccess.getApiKeyById(c.req.param('id'));
	const payload =
		patch.secretKey != null
			? { ...publicKey(row!), key: patch.secretKey }
			: publicKey(row!);
	return c.json({ success: true, data: payload });
});
