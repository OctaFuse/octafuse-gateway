import type { SystemConfigRow } from '@octafuse/core';

export const LEGACY_MASTER_KEY_CONFIG = 'MASTER_KEY';
export const MASKED_ADMIN_SECRET = '••••••••';

const SENSITIVE_CONFIG_KEY = /(KEY|SECRET|TOKEN|PASSWORD|WEBHOOK)/i;
const SENSITIVE_JSON_FIELD = /^(apiKey|secretKey|secretId|token|password|authorization)$/i;

function maskNestedSecrets(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(maskNestedSecrets);
	if (value == null || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
			key,
			SENSITIVE_JSON_FIELD.test(key) && nested ? MASKED_ADMIN_SECRET : maskNestedSecrets(nested),
		])
	);
}

function maskConfigValue(key: string, value: string): string {
	if (SENSITIVE_CONFIG_KEY.test(key) && !key.endsWith('_CATALOG')) return value ? MASKED_ADMIN_SECRET : '';
	if (!key.endsWith('_CATALOG') || !value) return value;
	try {
		return JSON.stringify(maskNestedSecrets(JSON.parse(value)));
	} catch {
		return MASKED_ADMIN_SECRET;
	}
}

export function prepareAdminConfigRows(
	rows: SystemConfigRow[],
	canReadSecrets: boolean
): SystemConfigRow[] {
	return rows
		.filter((row) => row.key !== LEGACY_MASTER_KEY_CONFIG)
		.map((row) => canReadSecrets ? row : { ...row, value: maskConfigValue(row.key, row.value ?? '') });
}
