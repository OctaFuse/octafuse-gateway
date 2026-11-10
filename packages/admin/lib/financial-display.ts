/** A missing or zero standard amount cannot define an effective multiplier. */
export function relativeMoneyFactor(
	value: number,
	standard: number | null | undefined
): number | null {
	if (
		standard == null ||
		!Number.isFinite(standard) ||
		standard <= 0 ||
		!Number.isFinite(value) ||
		value < 0
	)
		return null;
	const result = value / standard;
	return Number.isFinite(result) ? result : null;
}
