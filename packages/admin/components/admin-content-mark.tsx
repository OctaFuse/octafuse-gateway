'use client';

import './admin-content.css';
import { usePathname } from 'next/navigation';
import { Squares2X2Icon } from '@heroicons/react/24/outline';
import { ADMIN_NAV_GROUPS, matchAdminNavRoute } from '@/lib/admin-nav';
import { ADMIN_NAV_ICONS } from './layout/admin-nav-icons';

type IconType = typeof Squares2X2Icon;

/** A small content marker; navigation and page-shell presentation stay independent. */
export function AdminContentMark({ icon, compact = false }: { icon?: IconType; compact?: boolean }) {
	const route = matchAdminNavRoute(usePathname());
	const group = ADMIN_NAV_GROUPS.find(g => g.items.some(i => i.href === route?.href));
	const Icon = icon ?? (route ? ADMIN_NAV_ICONS[route.nameKey] : Squares2X2Icon);
	return <span aria-hidden="true" className={`admin-content-mark content-mark-${group?.groupKey ?? 'system'} ${compact ? 'admin-content-mark-compact' : ''}`}><Icon className="h-4 w-4" /></span>;
}
