/**
 * OpenAI Images generations 兼容扩展字段（Seedream 等）。
 * 用户显式传入才写入；路由默认值仍由 `buildRouteRequestBody` + `custom_params` 合并。
 */

/**
 * 将 OpenAI Images generations 的兼容扩展字段写入上游体。
 * 覆盖：`watermark` / `sequential_image_generation*` / `image` / `optimize_prompt_options`。
 */
export function applyOpenAiImageGenerationExtras(
	upstreamBody: Record<string, unknown>,
	body: Record<string, unknown>
): void {
	if (typeof body.watermark === 'boolean') {
		upstreamBody.watermark = body.watermark;
	}
	if (
		typeof body.sequential_image_generation === 'string' &&
		body.sequential_image_generation.trim() !== ''
	) {
		upstreamBody.sequential_image_generation = body.sequential_image_generation.trim();
	}
	if (
		body.sequential_image_generation_options &&
		typeof body.sequential_image_generation_options === 'object' &&
		!Array.isArray(body.sequential_image_generation_options)
	) {
		upstreamBody.sequential_image_generation_options = body.sequential_image_generation_options;
	}
	if (
		body.optimize_prompt_options &&
		typeof body.optimize_prompt_options === 'object' &&
		!Array.isArray(body.optimize_prompt_options)
	) {
		upstreamBody.optimize_prompt_options = body.optimize_prompt_options;
	}
	// Seedream 图生图 / 多图融合：JSON `image`（URL 或 data URL / 数组）；非 multipart edits
	if (typeof body.image === 'string' && body.image.trim() !== '') {
		upstreamBody.image = body.image.trim();
	} else if (Array.isArray(body.image)) {
		const images = body.image
			.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
			.map((v) => v.trim());
		if (images.length > 0) {
			upstreamBody.image = images.length === 1 ? images[0] : images;
		}
	}
}
