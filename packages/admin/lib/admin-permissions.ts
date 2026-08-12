import type { AdminPermission } from '@/lib/admin-principal';

export type AdminAuthorizationDecision =
	| { kind: 'permission'; permission: AdminPermission }
	| { kind: 'console_only' }
	| { kind: 'authenticated' }
	| { kind: 'deny' };

function readOrWrite(method: string, resource: string): AdminAuthorizationDecision {
	const suffix = method === 'GET' || method === 'HEAD' ? 'read' : 'write';
	return { kind: 'permission', permission: `${resource}.${suffix}` as AdminPermission };
}

export function getAdminAuthorizationDecision(method: string, pathname: string): AdminAuthorizationDecision {
	const normalizedMethod = method.toUpperCase();
	if (normalizedMethod === 'OPTIONS') return { kind: 'authenticated' };
	if (pathname === '/admin' && normalizedMethod === 'GET') return { kind: 'authenticated' };
	if (pathname.startsWith('/admin/access-keys')) {
		return { kind: 'console_only' };
	}
	if (/^\/admin\/providers\/[^/]+\/api-key$/.test(pathname) && normalizedMethod === 'GET') {
		return { kind: 'permission', permission: 'providers.secrets.read' };
	}
	if (pathname.startsWith('/admin/providers')) return readOrWrite(normalizedMethod, 'providers');
	if (pathname.startsWith('/admin/models')) return readOrWrite(normalizedMethod, 'models');
	if (pathname.startsWith('/admin/routes')) return readOrWrite(normalizedMethod, 'routes');
	if (/^\/admin\/users\/[^/]+\/(?:logs|audit-logs)(?:\/|$)/.test(pathname)) {
		return { kind: 'permission', permission: 'logs.read' };
	}
	if (/^\/admin\/keys\/[^/]+\/logs(?:\/|$)/.test(pathname)) {
		return { kind: 'permission', permission: 'logs.read' };
	}
	if (/^\/admin\/users\/[^/]+\/keys(?:\/|$)/.test(pathname)) return readOrWrite(normalizedMethod, 'user_keys');
	if (pathname.startsWith('/admin/users')) return readOrWrite(normalizedMethod, 'users');
	if (pathname.startsWith('/admin/keys')) return readOrWrite(normalizedMethod, 'user_keys');
	if (pathname === '/admin/config' || pathname === '/admin/config/') return readOrWrite(normalizedMethod, 'config');
	if (pathname.startsWith('/admin/business-timezone')) return { kind: 'permission', permission: 'config.read' };
	if (pathname.startsWith('/admin/analytics') || pathname.startsWith('/admin/stats')) {
		return { kind: 'permission', permission: 'analytics.read' };
	}
	if (pathname.startsWith('/admin/request-logs') || pathname.startsWith('/admin/budget-audit-logs')) {
		return { kind: 'permission', permission: 'logs.read' };
	}
	if (pathname.startsWith('/admin/playground')) {
		return { kind: 'permission', permission: 'playground.execute' };
	}
	return { kind: 'deny' };
}
