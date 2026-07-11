/**
 * Analytics 表格中百分比指标的颜色档位。
 *
 * 类名须为完整静态字符串（Tailwind 扫描 `lib/`）。
 */

/** 成功率：优秀绿 / 良好黄 / 其余红。 */
export function successRateClassName(rate: number): string {
	if (rate >= 95) return 'text-green-700';
	if (rate >= 80) return 'text-yellow-600';
	return 'text-red-600';
}

/**
 * Prompt cache 命中率。
 *
 * | 档位 | 阈值 | 样式 |
 * |------|------|------|
 * | 无缓存 | ≤0% | 灰 |
 * | 优秀 | ≥90% | 绿 |
 * | 良好 | ≥70% | 黄 |
 * | 一般 | ≥40% | 琥珀 |
 * | 较差 | ≥20% | 橙 |
 * | 很低 | <20% | 红 |
 */
export function cacheHitRateClassName(rate: number): string {
	if (rate <= 0) return 'text-gray-500';
	if (rate >= 90) return 'text-green-700';
	if (rate >= 70) return 'text-yellow-600';
	if (rate >= 40) return 'text-amber-600';
	if (rate >= 20) return 'text-orange-600';
	return 'text-red-600';
}
