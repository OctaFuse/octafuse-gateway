/**
 * 读取 Proxy 运行时配置：Workers 用 `c.env` binding，Node 用 `process.env`。
 */
export function readProxyEnv(
	bindings: Record<string, unknown> | undefined,
	key: string
): string | undefined {
	const fromBinding = bindings?.[key];
	if (typeof fromBinding === 'string' && fromBinding.trim()) {
		return fromBinding.trim();
	}
	const fromProcess = typeof process !== 'undefined' ? process.env[key]?.trim() : undefined;
	return fromProcess || undefined;
}
