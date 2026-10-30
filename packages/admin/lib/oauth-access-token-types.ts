import type { OAuthAccessTokenRow, OAuthAccessTokenClientStat as CoreClientStat, OAuthAccessTokenStatus } from '@octafuse/core';

export type { OAuthAccessTokenStatus } from '@octafuse/core';

/** Admin API `/api/admin/oauth-access-tokens` 的返回形状；复用 core 契约，明文令牌不进入列表。 */
export type GatewayOAuthAccessToken = OAuthAccessTokenRow & {
  status: OAuthAccessTokenStatus;
  /** 仅全局列表返回 */
  user_email?: string | null;
};

export type OAuthAccessTokenClientStat = CoreClientStat;

export interface OAuthAccessTokenListPage {
  items: GatewayOAuthAccessToken[];
  total: number;
  page: number;
  page_size: number;
}

export function oauthAccessTokenStatusDotClass(status: OAuthAccessTokenStatus): string {
  if (status === 'active') return 'bg-emerald-500';
  if (status === 'expired') return 'bg-amber-400';
  return 'bg-gray-400';
}
