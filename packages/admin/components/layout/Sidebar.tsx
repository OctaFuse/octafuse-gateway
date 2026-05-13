'use client';

/**
 * 左侧导航：Dashboard、推理与路由、分析、系统（含 Config 与 Logout）；底部外链与版本号。
 */
import Link from 'next/link';
import BrandExternalLinks from '@/components/layout/BrandExternalLinks';
import { OCTAFUSE_WORDMARK } from '@/lib/brand';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowLeftStartOnRectangleIcon,
  HomeIcon,
  KeyIcon,
  CpuChipIcon,
  GlobeAltIcon,
  ArrowsRightLeftIcon,
  BeakerIcon,
  DocumentChartBarIcon,
  ClipboardDocumentListIcon,
  ChartBarIcon,
  ServerStackIcon,
  UsersIcon,
  ShieldCheckIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline';
import { useState } from 'react';
import { adminAppVersion } from '@/lib/app-version';

interface MenuItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface MenuGroup {
  name: string;
  items: MenuItem[];
}

const menuGroups: MenuGroup[] = [
  {
    name: 'Overview',
    items: [
      { name: 'Dashboard', href: '/dashboard', icon: HomeIcon },
    ],
  },
  {
    name: 'Inference',
    items: [
      { name: 'Providers', href: '/gateway/providers', icon: GlobeAltIcon },
      { name: 'Models', href: '/gateway/models', icon: CpuChipIcon },
      { name: 'Routes', href: '/gateway/routes', icon: ArrowsRightLeftIcon },
      { name: 'Playground', href: '/gateway/playground', icon: BeakerIcon },
    ],
  },
  {
    name: 'User',
    items: [
      { name: 'Users', href: '/gateway/users', icon: UsersIcon },
      { name: 'API Keys', href: '/gateway/keys', icon: KeyIcon },
      { name: 'Request Logs', href: '/gateway/request-logs', icon: DocumentChartBarIcon },
      { name: 'Audit Logs', href: '/gateway/audit-logs', icon: ClipboardDocumentListIcon },
    ],
  },
  {
    name: 'Analytics',
    items: [
      { name: 'Model Usage', href: '/gateway/analytics/models', icon: ChartBarIcon },
      { name: 'Provider Usage', href: '/gateway/analytics/providers', icon: ServerStackIcon },
      { name: 'User Usage', href: '/gateway/analytics/users', icon: UsersIcon },
      { name: 'Reliability', href: '/gateway/analytics/reliability', icon: ShieldCheckIcon },
    ],
  },
  {
    name: 'System',
    items: [
      { name: 'Config', href: '/gateway/config', icon: Cog6ToothIcon },
    ],
  },
];

export default function Sidebar() {
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
          <span className="block text-lg font-bold tracking-tight text-white">{OCTAFUSE_WORDMARK}</span>
          <span className="block text-[11px] font-medium uppercase tracking-wider text-gray-400">
            Gateway · Admin
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-6 overflow-y-auto">
        {menuGroups.map((group) => (
          <div key={group.name}>
            <h3 className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              {group.name}
            </h3>
            <div className="space-y-1">
              {group.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href === '/gateway/users' &&
                    (pathname === '/gateway/users' || pathname?.startsWith('/gateway/users/')));
                const Icon = item.icon;

                return (
                  <Link
                    key={item.name}
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
                    {item.name}
                  </Link>
                );
              })}
              {group.name === 'System' && (
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  className="group w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-lg text-gray-300 hover:bg-gray-800 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ArrowLeftStartOnRectangleIcon className="mr-3 h-5 w-5 flex-shrink-0 text-gray-400 group-hover:text-white" />
                  {isLoggingOut ? 'Logging out...' : 'Logout'}
                </button>
              )}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer: links + version */}
      <div className="p-4 border-t border-gray-800 space-y-3">
        <BrandExternalLinks variant="sidebar" />
        <p className="text-xs text-gray-500 text-center">v{adminAppVersion}</p>
      </div>
      </div>
    </aside>
  );
}
