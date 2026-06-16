/**
 * Provider 上游密钥脱敏与指纹（日志 / Admin 展示）。
 */

/** 尾号指纹，如 `…x7Kp`；短密钥返回 `***`。 */
export function fingerprintProviderApiKey(apiKey: string): string {
	const trimmed = apiKey.trim();
	if (trimmed.length === 0) return '***';
	if (trimmed.length <= 4) return '***';
	return `…${trimmed.slice(-4)}`;
}

/** Admin 列表脱敏预览，如 `sk-…x7Kp`。 */
export function maskProviderApiKeyForAdmin(apiKey: string): string {
	const trimmed = apiKey.trim();
	if (trimmed.length === 0) return '(empty)';
	if (trimmed.length <= 8) return '***';
	return `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`;
}
