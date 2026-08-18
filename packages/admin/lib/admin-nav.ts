/**
 * 管理后台侧栏路由（不含图标）。DocumentTitle 与 Sidebar 共用，保证标签页标题与导航文案一致。
 */

export type AdminNavNameKey =
	| 'dashboard'
	| 'providers'
	| 'models'
	| 'routes'
	| 'playground'
	| 'simulator'
	| 'users'
	| 'apiKeys'
	| 'requestLogs'
	| 'auditLogs'
	| 'toolsConfig'
	| 'toolInvocations'
	| 'modelUsage'
	| 'providerUsage'
	| 'userUsage'
	| 'reliability'
	| 'adminApiKeys'
	| 'config';

export type AdminNavGroupKey =
	| 'overview'
	| 'inference'
	| 'user'
	| 'tools'
	| 'analytics'
	| 'integration'
	| 'system';

export interface AdminNavRoute {
	nameKey: AdminNavNameKey;
	href: string;
}

export interface AdminNavGroup {
	groupKey: AdminNavGroupKey;
	items: AdminNavRoute[];
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
	{
		groupKey: 'overview',
		items: [{ nameKey: 'dashboard', href: '/dashboard' }],
	},
	{
		groupKey: 'inference',
		items: [
			{ nameKey: 'providers', href: '/gateway/providers' },
			{ nameKey: 'models', href: '/gateway/models' },
			{ nameKey: 'routes', href: '/gateway/routes' },
			{ nameKey: 'playground', href: '/gateway/playground' },
			{ nameKey: 'simulator', href: '/gateway/simulator' },
		],
	},
	{
		groupKey: 'user',
		items: [
			{ nameKey: 'users', href: '/gateway/users' },
			{ nameKey: 'apiKeys', href: '/gateway/keys' },
			{ nameKey: 'requestLogs', href: '/gateway/request-logs' },
			{ nameKey: 'auditLogs', href: '/gateway/audit-logs' },
		],
	},
	{
		groupKey: 'tools',
		items: [
			{ nameKey: 'toolsConfig', href: '/gateway/tools' },
			{ nameKey: 'toolInvocations', href: '/gateway/tools/invocations' },
		],
	},
	{
		groupKey: 'analytics',
		items: [
			{ nameKey: 'modelUsage', href: '/gateway/analytics/models' },
			{ nameKey: 'providerUsage', href: '/gateway/analytics/providers' },
			{ nameKey: 'userUsage', href: '/gateway/analytics/users' },
			{ nameKey: 'reliability', href: '/gateway/analytics/reliability' },
		],
	},
	{
		groupKey: 'integration',
		items: [{ nameKey: 'adminApiKeys', href: '/gateway/admin-api-keys' }],
	},
	{
		groupKey: 'system',
		items: [{ nameKey: 'config', href: '/gateway/config' }],
	},
];

export const ADMIN_NAV_ROUTES: AdminNavRoute[] = ADMIN_NAV_GROUPS.flatMap((group) => group.items);

/** 最长前缀匹配，避免 `/gateway/tools/invocations` 落到 Configuration。 */
export function matchAdminNavRoute(pathname: string): AdminNavRoute | null {
	const path = pathname.split('?')[0] || '/';
	let best: AdminNavRoute | null = null;
	for (const item of ADMIN_NAV_ROUTES) {
		if (path === item.href || path.startsWith(`${item.href}/`)) {
			if (!best || item.href.length > best.href.length) {
				best = item;
			}
		}
	}
	return best;
}

export function formatAdminDocumentTitle(page: string | null | undefined, app: string): string {
	const trimmed = page?.trim() ?? '';
	return trimmed ? `${trimmed} · ${app}` : app;
}
