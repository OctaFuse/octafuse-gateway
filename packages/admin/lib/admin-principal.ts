export const ADMIN_PERMISSIONS = [
	'users.read',
	'users.write',
	'user_keys.read',
	'user_keys.write',
	'providers.read',
	'providers.write',
	'providers.secrets.read',
	'models.read',
	'models.write',
	'routes.read',
	'routes.write',
	'config.read',
	'config.write',
	'config.secrets.read',
	'analytics.read',
	'logs.read',
	'playground.execute',
	'*',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export type AdminPrincipal =
	| { type: 'console'; id: `console:${string}`; username: string }
	| { type: 'api_key'; id: `admin_key:${string}`; keyId: string; permissions: AdminPermission[] };

const PERMISSION_SET = new Set<string>(ADMIN_PERMISSIONS);

export function parseAdminPermissions(value: string): AdminPermission[] {
	try {
		const parsed: unknown = JSON.parse(value);
		if (!Array.isArray(parsed)) return [];
		return [...new Set(parsed.filter((item): item is AdminPermission => typeof item === 'string' && PERMISSION_SET.has(item)))];
	} catch {
		return [];
	}
}

export function normalizeAdminPermissions(value: readonly string[]): AdminPermission[] {
	const valid = value.filter((permission): permission is AdminPermission => PERMISSION_SET.has(permission));
	if (valid.includes('*')) return ['*'];
	return [...new Set(valid)];
}

export function hasAdminPermission(principal: AdminPrincipal, required: AdminPermission): boolean {
	if (principal.type === 'console') return true;
	if (principal.permissions.includes('*') || principal.permissions.includes(required)) return true;
	if (required.endsWith('.read')) {
		const write = `${required.slice(0, -'.read'.length)}.write` as AdminPermission;
		return principal.permissions.includes(write);
	}
	return false;
}
