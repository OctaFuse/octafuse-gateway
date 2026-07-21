/**
 * Image 按张计费：output / reference 张数 × 目录单价（$/张）。
 */

export type ImagePerImageCounts = {
	outputCount: number;
	referenceCount: number;
};

/** 按张原始成本（未乘路由倍率）：outputUnit×outputCount + inputUnit×referenceCount。 */
export function computeImagePerImageMeteredCost(options: {
	outputCount: number;
	referenceCount: number;
	outputUnitPrice: number;
	inputUnitPrice: number;
}): number {
	const outputCount = Math.max(0, Math.floor(options.outputCount));
	const referenceCount = Math.max(0, Math.floor(options.referenceCount));
	return (
		options.outputUnitPrice * outputCount + options.inputUnitPrice * referenceCount
	);
}
