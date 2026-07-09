'use client';

/**
 * 根级鉴权壳：未登录时展示登录表单；已登录则渲染 `Sidebar` + 子页面。
 * 会话依赖 `/api/auth/check` 与 `admin_session` cookie。
 */
import { useState, useEffect, useCallback, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import BrandExternalLinks from '@/components/layout/BrandExternalLinks';
import LocaleSwitcher from '@/components/layout/LocaleSwitcher';
import { BusinessTimezoneProvider } from '@/components/BusinessTimezoneProvider';
import { ADMIN_SESSION_EXPIRED_EVENT_NAME } from '@/lib/admin-session-events';
import { readApiJson, readJson } from '@/lib/api-json';
import Sidebar from './Sidebar';

interface Props {
  children: ReactNode;
}

export default function AuthWrapper({ children }: Props) {
  const t = useTranslations('auth');
  const tBrand = useTranslations('brand');
  const tCommon = useTranslations('common');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

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
    setLoginError('');
    setIsLoading(true);

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
        setIsAuthenticated(true);
      } else {
        setLoginError(data.message || tCommon('loginFailed'));
      }
    } catch (error) {
      setLoginError(tCommon('networkError'));
      console.error('Login error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state - full screen
  if (isLoading && !isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-gray-600">{tCommon('loading')}</div>
      </div>
    );
  }

  // Not authenticated - show login page (no sidebar)
  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
          <h1 className="text-2xl font-bold text-center mb-1 text-gray-800">{tBrand('loginHeading')}</h1>
          <p className="text-center text-xs text-gray-500 mb-6">{tBrand('operatorConsole')}</p>
          <form onSubmit={handleLogin}>
            <div className="mb-4">
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
                {t('username')}
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                required
                autoComplete="username"
              />
            </div>
            <div className="mb-6">
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                {t('password')}
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                required
                autoComplete="current-password"
              />
            </div>
            {loginError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">
                {loginError}
              </div>
            )}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? t('loggingIn') : t('login')}
            </button>
          </form>
          <div className="mt-6 pt-4 border-t border-gray-100 space-y-4">
            <LocaleSwitcher variant="login" />
            <BrandExternalLinks variant="login" />
          </div>
        </div>
      </div>
    );
  }

  // Authenticated - show dashboard layout with sidebar
  return (
    <BusinessTimezoneProvider>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar />
        <main className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
          {children}
        </main>
      </div>
    </BusinessTimezoneProvider>
  );
}
