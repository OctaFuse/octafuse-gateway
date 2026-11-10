'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckIcon, MagnifyingGlassIcon, UserCircleIcon } from '@heroicons/react/24/outline';
import { readApiJson } from '@/lib/api-json';
import type { GatewayUserListItem } from '@/lib/types';

export function KeyUserPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const t = useTranslations('keysPage');
  const common = useTranslations('common');
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<GatewayUserListItem[]>([]);
  const [selected, setSelected] = useState<GatewayUserListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (selected) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ page_size: '8' });
    if (query.trim()) params.set('email', query.trim());
    void fetch(`/api/admin/users?${params}`, { signal: controller.signal })
      .then((res) => readApiJson<GatewayUserListItem[]>(res))
      .then((data) => {
        if (controller.signal.aborted) return;
        if (!data.success || !data.data) throw new Error(data.message || t('ui.loadFailed'));
        setUsers(data.data);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setUsers([]);
          setError(err instanceof Error ? err.message : t('ui.loadFailed'));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, selected, t]);
  return (
    <div className="space-y-3">
      {selected && value === selected.id ? (
        <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <UserCircleIcon className="h-5 w-5 shrink-0 text-gray-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{selected.email}</p>
            <p className="text-xs text-gray-500">
              {selected.external_system || t('ui.gatewayUser')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setError('');
              setSelected(null);
              onChange('');
            }}
            className="text-xs text-gray-600 hover:underline"
          >
            {t('ui.changeUser')}
          </button>
        </div>
      ) : (
        <>
          <label htmlFor="key-user-search" className="block text-sm font-medium text-gray-700">
            {t('ui.selectUser')} <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <MagnifyingGlassIcon
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              aria-hidden
            />
            <input
              id="key-user-search"
              type="search"
              value={query}
              onChange={(e) => {
                setLoading(true);
                setError('');
                setQuery(e.target.value);
              }}
              placeholder={t('ui.searchUser')}
              className="h-10 w-full rounded-lg border border-gray-200 pl-9 pr-3 text-sm"
            />
          </div>
          <div
            aria-busy={loading}
            className="max-h-44 overflow-y-auto rounded-lg border border-gray-200"
          >
            {loading ? (
              <p role="status" className="p-3 text-xs text-gray-500">
                {common('loading')}
              </p>
            ) : error ? (
              <p role="alert" className="p-3 text-xs text-red-600">
                {error}
              </p>
            ) : users.length === 0 ? (
              <p className="p-3 text-xs text-gray-500">{t('ui.noUsers')}</p>
            ) : (
              users.map((user) => (
                <button
                  type="button"
                  key={user.id}
                  onClick={() => {
                    setSelected(user);
                    onChange(user.id);
                  }}
                  className="flex w-full items-center justify-between gap-3 border-b border-gray-100 px-3 py-2.5 text-left last:border-0 hover:bg-gray-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-gray-900">{user.email}</span>
                    <span className="block text-xs text-gray-500">
                      {user.external_system || t('ui.gatewayUser')}
                      {user.status !== 'active' ? ` · ${t('ui.userDisabled')}` : ''}
                    </span>
                  </span>
                  {value === user.id && (
                    <CheckIcon className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                  )}
                </button>
              ))
            )}
          </div>
        </>
      )}
      <details className="text-xs text-gray-500">
        <summary className="cursor-pointer">{t('ui.enterUserId')}</summary>
        <label htmlFor="key-user-id" className="mt-3 block">
          {t('fields.userId')}
        </label>
        <input
          id="key-user-id"
          value={value}
          onChange={(e) => {
            if (selected) {
              setLoading(true);
              setError('');
            }
            setSelected(null);
            onChange(e.target.value);
          }}
          className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs"
          placeholder={t('placeholders.userId')}
        />
      </details>
    </div>
  );
}
