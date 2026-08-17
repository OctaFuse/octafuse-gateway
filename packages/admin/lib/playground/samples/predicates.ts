export type ClaudeThinkingProfile = {
	mode: 'extended' | 'adaptive';
	includeEffort: boolean;
};

export type GeminiThinkingProfile = 'budget' | 'level';

export type SamplePredicateId =
	| 'deepseek'
	| 'glm_reasoning_effort'
	| 'thinking_compat'
	| 'qwen'
	| 'minimax'
	| 'openai_no_reasoning_effort'
	| 'openai_max_completion_tokens'
	| 'claude_adaptive'
	| 'claude_extended_effort'
	| 'gemini_2_5'
	| 'gemini_thinking_level';

function hayHas(haystack: string, pattern: RegExp): boolean {
	return pattern.test(haystack);
}

function isDeepseekModel(haystack: string): boolean {
	return hayHas(haystack, /deepseek/);
}

function isGlmModel(haystack: string): boolean {
	return hayHas(haystack, /(?:^|[^a-z])glm(?:[-_. ]|$)|chatglm|zhipu/);
}

function isGlmReasoningEffortModel(haystack: string): boolean {
	const minor = haystack.match(/glm[-_. ]?5[-_. ]?(\d+)/);
	return minor != null && Number(minor[1]) >= 2;
}

function isQwenModel(haystack: string): boolean {
	return hayHas(haystack, /qwen|qwq/);
}

function isMinimaxModel(haystack: string): boolean {
	return hayHas(haystack, /minimax/);
}

function isKimiModel(haystack: string): boolean {
	return hayHas(haystack, /kimi|moonshot/);
}

function isDoubaoModel(haystack: string): boolean {
	return hayHas(haystack, /doubao/);
}

function isGrokModel(haystack: string): boolean {
	return hayHas(haystack, /grok/);
}

function isOpenAiReasoningModel(haystack: string): boolean {
	if (/(?:^|[^a-z0-9])o[1-4](?:[-_.]|$)/.test(haystack)) return true;
	return /gpt[-_.]?5/.test(haystack);
}

function openaiChatUsesReasoningEffort(haystack: string): boolean {
	if (!haystack) return true;
	if (isOpenAiReasoningModel(haystack) || isGrokModel(haystack) || isDeepseekModel(haystack)) return true;
	if (/gpt[-_.]?4o/.test(haystack)) return false;
	if (/gpt[-_.]?4/.test(haystack) || /gpt[-_.]?3/.test(haystack)) return false;
	return true;
}

/**
 * Per-model thinking config from Anthropic docs
 * (https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting):
 * 4.5 and earlier → extended only; 4.6 still accepts extended but adaptive is preferred;
 * 4.7+ reject `type: enabled` with 400. Opus 4.5 is the only extended-only model that also takes effort.
 */
export function resolveClaudeThinkingProfile(haystack: string): ClaudeThinkingProfile {
	const hay = haystack.toLowerCase();
	if (/claude[-_. ]?(fable|mythos)/.test(hay)) {
		return { mode: 'adaptive', includeEffort: true };
	}
	if (/claude[-_. ]?3[-_.]7/.test(hay)) {
		return { mode: 'extended', includeEffort: false };
	}

	const named = hay.match(/claude[-_. ]?(opus|sonnet|haiku)[-_. ](\d+)(?:[-_.](\d+))?/);
	if (named) {
		const family = named[1];
		const major = Number(named[2]);
		const rawMinor = named[3] != null ? Number(named[3]) : 0;
		const minor = rawMinor >= 100 ? 0 : rawMinor;
		if (major >= 5 || (major === 4 && minor >= 6)) {
			return { mode: 'adaptive', includeEffort: true };
		}
		return {
			mode: 'extended',
			includeEffort: family === 'opus' && major === 4 && minor === 5,
		};
	}

	if (/4[-_.]5/.test(hay)) {
		return { mode: 'extended', includeEffort: /opus/.test(hay) };
	}
	if (/claude|anthropic/.test(hay)) {
		return { mode: 'adaptive', includeEffort: true };
	}
	return { mode: 'extended', includeEffort: false };
}

/** Gemini 2.5 uses `thinkingBudget`; Gemini 3+ uses `thinkingLevel` and rejects the budget field. */
export function resolveGeminiThinkingProfile(haystack: string): GeminiThinkingProfile {
	const hay = haystack.toLowerCase();
	if (/gemini[-_. ]?2[-_.]5/.test(hay)) return 'budget';
	if (/gemini[-_. ]?[3-9]/.test(hay)) return 'level';
	return 'budget';
}

export const SAMPLE_PREDICATES: Record<SamplePredicateId, (haystack: string) => boolean> = {
	deepseek: isDeepseekModel,
	glm_reasoning_effort: (hay) => isGlmModel(hay) && isGlmReasoningEffortModel(hay),
	thinking_compat: (hay) =>
		(isGlmModel(hay) && !isGlmReasoningEffortModel(hay)) || isKimiModel(hay) || isDoubaoModel(hay),
	qwen: isQwenModel,
	minimax: isMinimaxModel,
	openai_no_reasoning_effort: (hay) => Boolean(hay) && !openaiChatUsesReasoningEffort(hay),
	openai_max_completion_tokens: isOpenAiReasoningModel,
	claude_adaptive: (hay) => resolveClaudeThinkingProfile(hay).mode === 'adaptive',
	claude_extended_effort: (hay) => {
		const profile = resolveClaudeThinkingProfile(hay);
		return profile.mode === 'extended' && profile.includeEffort;
	},
	gemini_2_5: (hay) => /gemini[-_. ]?2[-_.]5/.test(hay),
	gemini_thinking_level: (hay) => resolveGeminiThinkingProfile(hay) === 'level',
};
