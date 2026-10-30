import { redirect } from 'next/navigation';

// OAuth 访问令牌已并入「MCP 服务」页；保留旧地址以免书签失效。
export default function LegacyOAuthAccessTokensPage() {
	redirect('/gateway/mcp#oauth-access-tokens');
}
