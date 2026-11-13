'use client';

/**
 * 根级鉴权壳：未登录时展示登录表单；已登录则渲染 `Sidebar` + 子页面。
 * 会话依赖 `/api/auth/check` 与 `admin_session` cookie。
 */
import { useState, useEffect, useCallback, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRightIcon, ArrowPathIcon, ExclamationCircleIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import BrandExternalLinks from '@/components/layout/BrandExternalLinks';
import BrandMark from '@/components/brand-mark';
import LocaleSwitcher from '@/components/layout/LocaleSwitcher';
import { BusinessTimezoneProvider } from '@/components/BusinessTimezoneProvider';
import { ADMIN_SESSION_EXPIRED_EVENT_NAME } from '@/lib/admin-session-events';
import { readApiJson, readJson } from '@/lib/api-json';
import { adminAppVersion } from '@/lib/app-version';
import AdminShell from './AdminShell';

interface Props {
  children: ReactNode;
}

export default function AuthWrapper({ children }: Props) {
  const t = useTranslations('auth');
  const tBrand = useTranslations('brand');
  const tSidebar = useTranslations('sidebar');
  const tCommon = useTranslations('common');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const checkAuth = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/check');
      const data = await readJson<{ authenticated: boolean }>(response);
      setIsAuthenticated(data.authenticated);
    } catch (error) {
      console.error('Auth check error:', error);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    const onSessionExpired = () => {
      void fetch('/api/auth/logout', { method: 'POST' });
      setIsAuthenticated(false);
      setIsLoading(false);
    };
    window.addEventListener(ADMIN_SESSION_EXPIRED_EVENT_NAME, onSessionExpired);
    return () => window.removeEventListener(ADMIN_SESSION_EXPIRED_EVENT_NAME, onSessionExpired);
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        checkAuth();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [checkAuth]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setLoginError('');
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await readApiJson(response);

      if (data.success) {
        setPassword('');
        setShowPassword(false);
        setIsAuthenticated(true);
      } else {
        setLoginError(data.message || tCommon('loginFailed'));
      }
    } catch (error) {
      setLoginError(tCommon('networkError'));
      console.error('Login error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Loading state - full screen
  if (isLoading && !isAuthenticated) {
    return (
      <div className="flex h-dvh items-center justify-center bg-gray-50">
        <div className="text-gray-600">{tCommon('loading')}</div>
      </div>
    );
  }

  // Not authenticated - show login page (no sidebar)
  if (!isAuthenticated) {
    return (
      <main className="flex h-dvh items-start justify-center overflow-y-auto bg-gray-50 px-4 py-8 sm:px-8">
        <div className="my-auto w-full max-w-[480px]">
          <section aria-labelledby="login-title" className="rounded-2xl border border-gray-200 bg-white shadow-sm">
            <header className="flex items-center justify-between gap-3 rounded-t-2xl border-b border-gray-100 bg-gray-50/80 px-6 py-5 sm:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <BrandMark className="h-10 w-10" />
                <div className="min-w-0">
                  <p className="text-base font-medium leading-6 text-gray-950">{tBrand('wordmark')}</p>
                  <p className="text-xs leading-5 text-gray-500">{tBrand('sidebarSubtitle')}</p>
                </div>
              </div>
              <LocaleSwitcher variant="login" />
            </header>
            <div className="p-6 sm:p-8">
              <div className="mb-8">
                <h1 id="login-title" className="text-2xl font-medium leading-8 text-gray-950">{t('title')}</h1>
                <p className="mt-2 text-sm leading-6 text-gray-500">{t('description')}</p>
              </div>
              <form onSubmit={handleLogin} aria-busy={isSubmitting} className="space-y-5">
                <div className="space-y-2">
                  <label htmlFor="username" className="block text-sm font-medium text-gray-700">
                    {t('username')}
                  </label>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="h-12 w-full rounded-lg border border-gray-200 bg-white px-3 text-base text-gray-950 transition-colors hover:border-gray-300 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 disabled:bg-gray-50 sm:text-sm"
                    required
                    disabled={isSubmitting}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    aria-invalid={loginError ? true : undefined}
                    aria-describedby={loginError ? 'login-error' : undefined}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                    {t('password')}
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-12 w-full rounded-lg border border-gray-200 bg-white py-2 pl-3 pr-12 text-base text-gray-950 transition-colors hover:border-gray-300 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 disabled:bg-gray-50 sm:text-sm"
                      required
                      disabled={isSubmitting}
                      autoComplete="current-password"
                      aria-invalid={loginError ? true : undefined}
                      aria-describedby={loginError ? 'login-error' : undefined}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      disabled={isSubmitting}
                      aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                      aria-pressed={showPassword}
                      aria-controls="password"
                      className="absolute inset-y-1 right-1 flex w-10 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
                    >
                      {showPassword ? <EyeSlashIcon className="h-[18px] w-[18px]" aria-hidden /> : <EyeIcon className="h-[18px] w-[18px]" aria-hidden />}
                    </button>
                  </div>
                </div>
                {loginError && (
                  <div id="login-error" role="alert" className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-sm leading-5 text-red-700">
                    <ExclamationCircleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>{loginError}</span>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  aria-label={isSubmitting ? t('loggingIn') : t('login')}
                  className="admin-primary flex h-12 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
                >
                  <span aria-live="polite">{isSubmitting ? t('loggingIn') : t('login')}</span>
                  {isSubmitting ? <ArrowPathIcon className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <ArrowRightIcon className="h-4 w-4" aria-hidden />}
                </button>
              </form>
            </div>
          </section>
          <footer className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <BrandExternalLinks variant="login" />
            <span className="border-l border-gray-200 pl-4 font-mono text-xs tabular-nums text-gray-500">
              {tSidebar('version', { version: adminAppVersion })}
            </span>
          </footer>
        </div>
      </main>
    );
  }

  // Authenticated - show dashboard layout with sidebar
  return (
    <BusinessTimezoneProvider>
      <AdminShell>{children}</AdminShell>
    </BusinessTimezoneProvider>
  );
}
