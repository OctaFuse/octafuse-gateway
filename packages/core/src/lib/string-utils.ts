/**
 * trim 后若为空或入参为 null/undefined 则返回 null，否则返回 trim 后的字符串（管理端 URL 等字段用）。
 */
export function nullIfEmpty(s: string | null | undefined): string | null {
	if (s == null || String(s).trim() === '') return null;
	return String(s).trim();
}
