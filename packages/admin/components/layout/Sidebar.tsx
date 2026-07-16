'use client';

/**
 * 左侧导航：Dashboard、推理与路由、Tools、分析、系统（含 Config 与 Logout）；底部外链与版本号。
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
import { adminAppVersion } from '@/lib/app-version';

interface MenuItem {
  nameKey: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface MenuGroup {
  groupKey: string;
  items: MenuItem[];
}

const menuGroups: MenuGroup[] = [
  {
    groupKey: 'overview',
    items: [
      { nameKey: 'dashboard', href: '/dashboard', icon: HomeIcon },
    ],
  },
  {
    groupKey: 'inference',
    items: [
      { nameKey: 'providers', href: '/gateway/providers', icon: GlobeAltIcon },
      { nameKey: 'models', href: '/gateway/models', icon: CpuChipIcon },
      { nameKey: 'routes', href: '/gateway/routes', icon: ArrowsRightLeftIcon },
      { nameKey: 'playground', href: '/gateway/playground', icon: BeakerIcon },
      { nameKey: 'simulator', href: '/gateway/simulator', icon: PlayCircleIcon },
    ],
  },
  {
    groupKey: 'user',
    items: [
      { nameKey: 'users', href: '/gateway/users', icon: UsersIcon },
      { nameKey: 'apiKeys', href: '/gateway/keys', icon: KeyIcon },
      { nameKey: 'requestLogs', href: '/gateway/request-logs', icon: DocumentChartBarIcon },
      { nameKey: 'auditLogs', href: '/gateway/audit-logs', icon: ClipboardDocumentListIcon },
    ],
  },
  {
    groupKey: 'tools',
    items: [
      { nameKey: 'toolsConfig', href: '/gateway/tools', icon: WrenchScrewdriverIcon },
      { nameKey: 'toolInvocations', href: '/gateway/tools/invocations', icon: QueueListIcon },
    ],
  },
  {
    groupKey: 'analytics',
    items: [
      { nameKey: 'modelUsage', href: '/gateway/analytics/models', icon: ChartBarIcon },
      { nameKey: 'providerUsage', href: '/gateway/analytics/providers', icon: ServerStackIcon },
      { nameKey: 'userUsage', href: '/gateway/analytics/users', icon: UsersIcon },
      { nameKey: 'reliability', href: '/gateway/analytics/reliability', icon: ShieldCheckIcon },
    ],
  },
  {
    groupKey: 'system',
    items: [
      { nameKey: 'config', href: '/gateway/config', icon: Cog6ToothIcon },
    ],
  },
];

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
      {/* Logo / Brand */}
      <div className="flex h-16 flex-col justify-center px-6 bg-gray-950 leading-tight">
        <Link href="/dashboard" className="block hover:opacity-90">
          <span className="block text-lg font-bold tracking-tight text-white">{tBrand('wordmark')}</span>
          <span className="block text-[11px] font-medium uppercase tracking-wider text-gray-400">
            {tBrand('sidebarSubtitle')}
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-6 overflow-y-auto">
        {menuGroups.map((group) => (
          <div key={group.groupKey}>
            <h3 className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              {t(`groups.${group.groupKey}`)}
            </h3>
            <div className="space-y-1">
              {group.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href === '/gateway/users' &&
                    (pathname === '/gateway/users' || pathname?.startsWith('/gateway/users/'))) ||
                  (item.href === '/gateway/tools' && pathname === '/gateway/tools');
                const Icon = item.icon;

                return (
                  <Link
                    key={item.nameKey}
                    href={item.href}
                    className={`
                      group flex items-center px-3 py-2.5 text-sm font-medium rounded-lg
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
                  className="group w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-lg text-gray-300 hover:bg-gray-800 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
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
      <div className="p-4 border-t border-gray-800 space-y-3">
        <LocaleSwitcher variant="sidebar" />
        <BrandExternalLinks variant="sidebar" />
        <p className="text-xs text-gray-500 text-center">{t('version', { version: adminAppVersion })}</p>
      </div>
      </div>
    </aside>
  );
}
