import type {
  OAuthAccessTokenAppStat as CoreAppStat,
  OAuthAccessTokenRow,
  OAuthAccessTokenClientStat as CoreClientStat,
  OAuthAccessTokenStatus,
} from '@octafuse/core';

export type { OAuthAccessTokenStatus } from '@octafuse/core';

/** Admin API `/api/admin/oauth-access-tokens` 的返回形状；复用 core 契约，明文令牌不进入列表。 */
export type GatewayOAuthAccessToken = OAuthAccessTokenRow & {
  status: OAuthAccessTokenStatus;
  /** 仅全局列表返回 */
  user_email?: string | null;
  /** 仅全局列表返回：所属应用名；未归属为 null */
  app_name?: string | null;
};

export type OAuthAccessTokenClientStat = CoreClientStat;
export type OAuthAccessTokenAppStat = CoreAppStat;

export interface OAuthAccessTokenListPage {
  items: GatewayOAuthAccessToken[];
  total: number;
  page: number;
  page_size: number;
}

/** `/api/admin/oauth/apps` 的应用条目（应用目录 + 统计）。 */
export interface OAuthApp {
  id: string;
  slug: string;
  name: string;
  redirect_uris: string[];
  client_name_patterns: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
  client_count: number;
  user_count: number;
  active_count: number;
  live_count: number;
  total_count: number;
  last_used_at: string | null;
}

export interface OAuthAppsOverview {
  apps: OAuthApp[];
  /** 迁移前由外部授权服务器签发、没有归属应用的授权，按客户端名称成组 */
  unattributed: OAuthAccessTokenAppStat[];
  unattributed_client_count: number;
}

export function oauthAccessTokenStatusDotClass(status: OAuthAccessTokenStatus): string {
  if (status === 'active') return 'bg-emerald-500';
  if (status === 'renewable') return 'bg-sky-400';
  if (status === 'expired') return 'bg-amber-400';
  return 'bg-gray-400';
}
