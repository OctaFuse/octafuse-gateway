'use client';

/**
 * 左侧导航：Dashboard、推理与路由、Tools、分析、系统集成、系统（含 Config 与 Logout）；底部外链与版本号。
 */
import Link from 'next/link';
import BrandMark from '@/components/brand-mark';
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
  PauseCircleIcon,
  WrenchScrewdriverIcon,
  QueueListIcon,
  Squares2X2Icon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useState } from 'react';
import { ADMIN_NAV_GROUPS, matchAdminNavRoute, type AdminNavNameKey } from '@/lib/admin-nav';
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
  mcpServers: Squares2X2Icon,
  modelUsage: ChartBarIcon,
  providerUsage: ServerStackIcon,
  userUsage: UsersIcon,
  reliability: ShieldCheckIcon,
  adminApiKeys: KeyIcon,
  config: Cog6ToothIcon,
  maintenance: PauseCircleIcon,
};

export default function Sidebar({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const t = useTranslations('sidebar');
  const tBrand = useTranslations('brand');
  const tAuth = useTranslations('auth');
  const tCommon = useTranslations('common');
  const pathname = usePathname();
  const router = useRouter();
  const activeRoute = matchAdminNavRoute(pathname);
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
    <aside className={`${mobile ? 'h-full w-full' : 'hidden h-dvh w-60 shrink-0 lg:block'} admin-sidebar`}>
      <div className="flex h-full flex-col">
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-4">
          <Link href="/dashboard" onClick={onNavigate} className="flex min-w-0 items-center gap-2 rounded-lg">
            <BrandMark className="h-8 w-8" />
            <div className="min-w-0 leading-tight">
              <span className="block truncate text-base font-semibold text-gray-950">{tBrand('wordmark')}</span>
              <span className="mt-1 block truncate text-xs text-gray-500">{tBrand('sidebarSubtitle')}</span>
            </div>
          </Link>
          {mobile && (
            <button type="button" onClick={onNavigate} aria-label={tCommon('close')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-200">
              <XMarkIcon className="h-5 w-5" aria-hidden />
            </button>
          )}
        </div>

        <nav aria-label={t('navigation')} className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-3 pb-4 pt-2">
          {ADMIN_NAV_GROUPS.map((group) => (
            <div key={group.groupKey}>
              <h3 className="mb-2 px-3 text-xs font-normal text-gray-500">{t(`groups.${group.groupKey}`)}</h3>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = NAV_ICONS[item.nameKey];
                  return (
                    <Link
                      key={item.nameKey}
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={activeRoute?.href === item.href ? 'page' : undefined}
                      className="admin-nav-item"
                    >
                      <Icon aria-hidden="true" />
                      <span className="min-w-0 truncate">{t(`nav.${item.nameKey}`)}</span>
                    </Link>
                  );
                })}
                {group.groupKey === 'system' && (
                  <button type="button" onClick={handleLogout} disabled={isLoggingOut} className="admin-nav-item w-full disabled:cursor-not-allowed disabled:opacity-50">
                    <ArrowLeftStartOnRectangleIcon aria-hidden="true" />
                    {isLoggingOut ? tAuth('loggingOut') : tAuth('logout')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </nav>

        <div className={`shrink-0 border-t border-gray-200 px-4 py-3 ${mobile ? 'space-y-3' : ''}`}>
          {mobile && <BrandExternalLinks variant="sidebar" />}
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs tabular-nums text-gray-500">{t('version', { version: adminAppVersion })}</span>
            <LocaleSwitcher variant="header" />
          </div>
        </div>
      </div>
    </aside>
  );
}
