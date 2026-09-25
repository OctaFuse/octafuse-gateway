'use client';

import { Bars3Icon } from '@heroicons/react/24/outline';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import LocaleSwitcher from './LocaleSwitcher';
import Sidebar from './Sidebar';

export default function AdminShell({ children }: { children: ReactNode }) {
  const t = useTranslations('sidebar');
  const tBrand = useTranslations('brand');
  const pathname = usePathname();
  const drawerRef = useRef<HTMLDialogElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    drawerRef.current?.close();
  }, [pathname]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => {
      if (desktop.matches) drawerRef.current?.close();
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  return (
    <div className="flex h-dvh min-w-0 overflow-hidden">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 bg-gray-950 px-3 text-white lg:hidden">
          <button
            type="button"
            aria-label={t('openMenu')}
            aria-expanded={menuOpen}
            aria-controls="admin-mobile-navigation"
            onClick={() => {
              drawerRef.current?.showModal();
              setMenuOpen(true);
            }}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
          >
            <Bars3Icon className="h-6 w-6" aria-hidden />
          </button>
          <div className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-lg font-bold">{tBrand('wordmark')}</span>
            <span className="block truncate text-[11px] text-gray-400">{tBrand('sidebarSubtitle')}</span>
          </div>
          <LocaleSwitcher variant="header" />
        </header>
        <main className="min-h-0 min-w-0 flex-1 overflow-auto bg-gray-50">
          {children}
        </main>
      </div>
      <dialog
        ref={drawerRef}
        id="admin-mobile-navigation"
        aria-label={t('navigation')}
        onClose={() => setMenuOpen(false)}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), [tabindex="0"]'
          )).filter((element) => element.getClientRects().length > 0);
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) drawerRef.current?.close();
        }}
        className="fixed inset-y-0 left-0 right-auto m-0 h-dvh max-h-none w-80 max-w-[calc(100vw-3rem)] border-0 bg-gray-900 p-0 text-white shadow-xl backdrop:bg-black/50"
      >
        <Sidebar mobile onNavigate={() => drawerRef.current?.close()} />
      </dialog>
    </div>
  );
}
