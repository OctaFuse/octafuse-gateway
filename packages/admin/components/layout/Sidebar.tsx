'use client';

/**
 * 左侧导航：Dashboard、推理与路由、Tools、分析、系统集成、系统（含 Config 与 Logout）；底部外链与版本号。
 */
import Link from 'next/link';
import BrandExternalLinks from '@/components/layout/BrandExternalLinks';
import LocaleSwitcher from '@/components/layout/LocaleSwitcher';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ArrowLeftStartOnRectangleIcon,
  HomeIcon,
  KeyIcon,
  CpuChipIcon,
  GlobeAltIcon,
  ArrowsRightLeftIcon,
  BeakerIcon,
  PlayCircleIcon,
  DocumentChartBarIcon,
  ClipboardDocumentListIcon,
  ChartBarIcon,
  ServerStackIcon,
  UsersIcon,
  ShieldCheckIcon,
  Cog6ToothIcon,
  WrenchScrewdriverIcon,
  QueueListIcon,
} from '@heroicons/react/24/outline';
import { useState } from 'react';
import { ADMIN_NAV_GROUPS, type AdminNavNameKey } from '@/lib/admin-nav';
import { adminAppVersion } from '@/lib/app-version';

const NAV_ICONS: Record<AdminNavNameKey, React.ComponentType<{ className?: string }>> = {
  dashboard: HomeIcon,
  providers: GlobeAltIcon,
  models: CpuChipIcon,
  routes: ArrowsRightLeftIcon,
  playground: BeakerIcon,
  simulator: PlayCircleIcon,
  users: UsersIcon,
  apiKeys: KeyIcon,
  requestLogs: DocumentChartBarIcon,
  auditLogs: ClipboardDocumentListIcon,
  toolsConfig: WrenchScrewdriverIcon,
  toolInvocations: QueueListIcon,
  modelUsage: ChartBarIcon,
  providerUsage: ServerStackIcon,
  userUsage: UsersIcon,
  reliability: ShieldCheckIcon,
  adminApiKeys: KeyIcon,
  config: Cog6ToothIcon,
};

export default function Sidebar() {
  const t = useTranslations('sidebar');
  const tBrand = useTranslations('brand');
  const tAuth = useTranslations('auth');
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (isLoggingOut) return;

    setIsLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/');
      router.refresh();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <aside className="sticky top-0 h-dvh w-64 shrink-0 bg-gray-900">
      <div className="flex h-full flex-col">
      {/* Logo / Brand + locale */}
      <div className="flex h-16 items-center justify-between gap-2 bg-gray-950 px-4 leading-tight">
        <Link href="/dashboard" className="min-w-0 block hover:opacity-90">
          <span className="block truncate text-lg font-bold tracking-tight text-white">{tBrand('wordmark')}</span>
          <span className="block truncate text-[11px] font-medium uppercase tracking-wider text-gray-400">
            {tBrand('sidebarSubtitle')}
          </span>
        </Link>
        <LocaleSwitcher variant="header" />
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
        {ADMIN_NAV_GROUPS.map((group) => (
          <div key={group.groupKey}>
            <h3 className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
              {t(`groups.${group.groupKey}`)}
            </h3>
            <div className="space-y-px">
              {group.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href === '/gateway/users' &&
                    (pathname === '/gateway/users' || pathname?.startsWith('/gateway/users/'))) ||
                  (item.href === '/gateway/tools' && pathname === '/gateway/tools');
                const Icon = NAV_ICONS[item.nameKey];

                return (
                  <Link
                    key={item.nameKey}
                    href={item.href}
                    className={`
                      group flex items-center rounded-md px-3 py-2 text-sm font-medium
                      ${isActive
                        ? 'bg-gray-800 text-white'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                      }
                    `}
                  >
                    <Icon className={`
                      mr-3 h-5 w-5 flex-shrink-0
                      ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-white'}
                    `} />
                    {t(`nav.${item.nameKey}`)}
                  </Link>
                );
              })}
              {group.groupKey === 'system' && (
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  className="group flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ArrowLeftStartOnRectangleIcon className="mr-3 h-5 w-5 flex-shrink-0 text-gray-400 group-hover:text-white" />
                  {isLoggingOut ? tAuth('loggingOut') : tAuth('logout')}
                </button>
              )}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer: links + version */}
      <div className="space-y-3 border-t border-gray-800 p-4">
        <BrandExternalLinks variant="sidebar" />
        <p className="text-center text-xs text-gray-500">{t('version', { version: adminAppVersion })}</p>
      </div>
      </div>
    </aside>
  );
}
