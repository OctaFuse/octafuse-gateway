/**
 * Analytics 表格中百分比指标的颜色档位。
 */

export function successRateClassName(rate: number): string {
	return rate >= 95 ? 'text-green-600' : rate >= 80 ? 'text-yellow-600' : 'text-red-600';
}

/**
 * Prompt cache 命中率多档着色（经验档位，非行业硬标准）。
 * 0%：未启用/未上报 → 中性灰；其余由优到差递进。
 */
export function cacheHitRateClassName(rate: number): string {
	if (rate <= 0) return 'text-gray-500';
	if (rate >= 90) return 'text-emerald-600'; // 优秀
	if (rate >= 70) return 'text-green-600'; // 良好（常见健康目标）
	if (rate >= 50) return 'text-lime-600'; // 一般
	if (rate >= 30) return 'text-yellow-600'; // 偏弱
	if (rate >= 10) return 'text-orange-500'; // 较差
	return 'text-red-600'; // 很低
}
