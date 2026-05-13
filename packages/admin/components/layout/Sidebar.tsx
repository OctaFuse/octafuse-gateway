'use client';

/**
 * 左侧导航：Dashboard、Gateway 资源、分析、系统配置；底部登出调用 `/api/auth/logout`。
 */
import Link from 'next/link';
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
    name: 'Gateway',
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
      <div className="flex items-center h-16 px-6 bg-gray-950">
        <span className="text-xl font-bold text-white">Gateway Admin</span>
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
                const isActive = pathname === item.href;
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
            </div>
          </div>
        ))}
      </nav>

      {/* Footer with Logout */}
      <div className="p-4 border-t border-gray-800 space-y-3">
        <button
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-lg text-gray-300 hover:bg-gray-800 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ArrowLeftStartOnRectangleIcon className="mr-3 h-5 w-5 flex-shrink-0 text-gray-400" />
          {isLoggingOut ? 'Logging out...' : 'Logout'}
        </button>
        <p className="text-xs text-gray-500 text-center">v1.0.0</p>
      </div>
      </div>
    </aside>
  );
}
