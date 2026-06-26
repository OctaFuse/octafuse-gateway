/**
 * 上游敏感内容拦截错误识别（OpenAI / Anthropic / Gemini / 国内供应商等）。
 */

function errorMessageLower(errorMessage: string | null | undefined): string {
	return (errorMessage ?? '').toLowerCase();
}

/**
 * 基于错误摘要或原始文案判断是否为上游敏感内容拦截。
 */
export function isSensitiveContentErrorMessage(errorMessage: string | null | undefined): boolean {
	const lower = errorMessageLower(errorMessage);
	if (!lower) {
		return false;
	}
	return (
		lower.includes('sensitive content') ||
		lower.includes('unsafe or sensitive') ||
		lower.includes('inappropriate content') ||
		lower.includes('datainspectionfailed') ||
		lower.includes('data inspection failed') ||
		lower.includes('content policy') ||
		lower.includes('policy violation') ||
		lower.includes('safety filter') ||
		lower.includes('blocked by safety') ||
		lower.includes('moderation') ||
		lower.includes('敏感内容') ||
		lower.includes('不安全或敏感') ||
		lower.includes('内容安全') ||
		lower.includes('内容审核') ||
		lower.includes('违规内容') ||
		lower.includes('不适宜内容')
	);
}
