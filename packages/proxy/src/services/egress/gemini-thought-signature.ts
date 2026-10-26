/**
 * Gemini thought signature 兜底。
 *
 * 背景：Gemini 3 系列在 `functionCall` part 上返回 `thoughtSignature`，客户端须在后续轮次原样回放。
 * 签名只有签发它的那类上游认：同一会话被 failover 到另一类上游（例如 Vertex → 第三方中转）后，
 * 历史里会混进别家格式的签名，下一次回到 Vertex 就会返回 `HTTP 400: Invalid thought signature.`。
 * 400 不属于可 failover 的错误，客户端重试带的还是同一份历史，会话从此一直失败。
 *
 * 处理：仅在上游明确返回该 400 时，对**同一个上游**用清洗后的请求体重试一次：
 * - `functionCall` part 的签名换成官方文档提供的跳过校验占位值；
 * - 非 `functionCall` part（文本、思考）的签名不是必需项，直接删除。
 * 正常请求完全不受影响。
 */

/** Google 文档给出的占位签名，Vertex 与 Gemini API 都接受，用于跳过历史 function call 的签名校验。 */
export const GEMINI_SKIP_THOUGHT_SIGNATURE = 'skip_thought_signature_validator';

/** 上游 400 body 是否表示「签名无效」（不含「缺少签名」这一类，那是另一种错误）。 */
export function isInvalidThoughtSignatureErrorBody(text: string): boolean {
	return /invalid/i.test(text) && /thought[\s_]?signature/i.test(text);
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(obj: JsonObject, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(obj, key);
}

export type SanitizedGeminiSignatures = {
	body: JsonObject;
	/** 被替换为占位值的 functionCall 签名数 */
	replaced: number;
	/** 被删除的非 functionCall 签名数 */
	removed: number;
};

/**
 * 返回清洗了历史签名的请求体副本；没有任何签名可处理时返回 `null`（此时重试没有意义）。
 * 不修改入参。
 */
export function sanitizeGeminiThoughtSignatures(body: JsonObject): SanitizedGeminiSignatures | null {
	const contents = body.contents;
	if (!Array.isArray(contents)) return null;

	let replaced = 0;
	let removed = 0;

	const nextContents = contents.map((content) => {
		if (!isObject(content) || !Array.isArray(content.parts)) return content;
		const parts = content.parts.map((part) => {
			if (!isObject(part)) return part;
			const hasCamel = hasOwn(part, 'thoughtSignature');
			const hasSnake = hasOwn(part, 'thought_signature');
			if (!hasCamel && !hasSnake) return part;

			const { thoughtSignature: _camel, thought_signature: _snake, ...rest } = part;
			const isFunctionCall = part.functionCall != null || part.function_call != null;
			if (isFunctionCall) {
				replaced += 1;
				return { ...rest, thoughtSignature: GEMINI_SKIP_THOUGHT_SIGNATURE };
			}
			removed += 1;
			return rest;
		});
		return { ...content, parts };
	});

	if (replaced === 0 && removed === 0) return null;
	return { body: { ...body, contents: nextContents }, replaced, removed };
}
