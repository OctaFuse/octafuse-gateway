'use client';

/**
 * 用户详情「API Keys」页签下方：该用户授权给第三方 MCP 客户端的 OAuth 访问令牌，可单条撤销。
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useFeedback } from '@/components/feedback';
import { readApiJson } from '@/lib/api-json';
import { oauthAccessTokenStatusDotClass, type GatewayOAuthAccessToken } from '@/lib/oauth-access-token-types';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';

export function UserOAuthAccessTokensPanel({ userId }: { userId: string }) {
  const t = useTranslations('oauthAccessTokensPage');
  const tCommon = useTranslations('common');
  const { notify, confirm } = useFeedback();
  const { formatDateTime } = useGatewayDateTime();
  const [tokens, setTokens] = useState<GatewayOAuthAccessToken[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/oauth-access-tokens`);
      const data = await readApiJson<GatewayOAuthAccessToken[]>(response);
      if (data.success && data.data) setTokens(data.data);
    } catch (error) {
      console.error('Fetch user access tokens error:', error);
    } finally {
      setLoaded(true);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (token: GatewayOAuthAccessToken) => {
    const ok = await confirm({
      title: t('revokeTitle'),
      message: t('revokeConfirm', { client: token.client_name, user: userId }),
      confirmLabel: t('revoke'),
      danger: true,
    });
    if (!ok) return;
    setBusyId(token.id);
    try {
      const response = await fetch(`/api/admin/oauth-access-tokens/${encodeURIComponent(token.id)}/revoke`, {
        method: 'POST',
      });
      const data = await readApiJson(response);
      if (data.success) {
        notify('success', t('revoked'));
        await load();
      } else {
        notify('error', data.message || t('revokeFailed'));
      }
    } catch (error) {
      console.error('Revoke access token error:', error);
      notify('error', t('revokeFailed'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mt-6 flex min-w-0 flex-col rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">{t('userSectionTitle')}</h2>
        <Link href="/gateway/mcp#oauth-access-tokens" className="text-sm text-blue-600 hover:underline">
          {t('viewAll')}
        </Link>
      </div>
      <p className="mb-4 text-sm text-gray-500">{t('userSectionHint')}</p>
      {loaded && tokens.length === 0 ? (
        <p className="py-2 text-sm text-gray-500">{t('userSectionEmpty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold tracking-wide text-gray-500">
                <th className="py-2 pr-4">{t('table.client')}</th>
                <th className="py-2 pr-4">{t('table.token')}</th>
                <th className="py-2 pr-4">{t('table.expires')}</th>
                <th className="py-2 pr-4">{t('table.lastUsed')}</th>
                <th className="py-2 text-right">{t('table.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tokens.map((token) => (
                <tr key={token.id}>
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${oauthAccessTokenStatusDotClass(token.status)}`}
                        title={t(`status.${token.status}`)}
                        role="img"
                        aria-label={t(`status.${token.status}`)}
                      />
                      <div className="min-w-0">
                        <div className="truncate font-medium text-gray-900">{token.client_name}</div>
                        <div className="truncate font-mono text-[11px] text-gray-400">{token.client_id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-gray-600">
                    {token.token_hint ? `oat_…${token.token_hint}` : tCommon('noData')}
                  </td>
                  <td className="py-2.5 pr-4 text-xs text-gray-600">
                    {token.status === 'revoked'
                      ? `${t('status.revoked')} · ${formatDateTime(token.revoked_at)}`
                      : formatDateTime(token.expires_at) || tCommon('noData')}
                  </td>
                  <td className="py-2.5 pr-4 text-xs text-gray-600">
                    {formatDateTime(token.last_used_at) || tCommon('noData')}
                  </td>
                  <td className="py-2.5 text-right">
                    {token.status !== 'revoked' && (
                      <button
                        type="button"
                        onClick={() => void revoke(token)}
                        disabled={busyId === token.id}
                        className="text-xs font-medium text-red-600 hover:underline disabled:opacity-40"
                      >
                        {t('revoke')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
