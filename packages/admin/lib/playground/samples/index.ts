import openaiChatConnectivity from './openai-chat/connectivity.json';
import openaiChatConnectivityMaxCompletion from './openai-chat/connectivity.max-completion.json';
import openaiChatTools from './openai-chat/tools.json';
import openaiChatToolsMaxCompletion from './openai-chat/tools.max-completion.json';
import openaiChatReasoningEffort from './openai-chat/reasoning.effort.json';
import openaiChatReasoningEffortMaxCompletion from './openai-chat/reasoning.effort-max-completion.json';
import openaiChatReasoningNone from './openai-chat/reasoning.none.json';
import openaiChatReasoningThinking from './openai-chat/reasoning.thinking.json';
import openaiChatReasoningThinkingEffort from './openai-chat/reasoning.thinking-effort.json';
import openaiChatReasoningQwen from './openai-chat/reasoning.qwen.json';
import openaiChatReasoningMinimax from './openai-chat/reasoning.minimax.json';
import openaiResponsesConnectivity from './openai-responses/connectivity.json';
import openaiResponsesTools from './openai-responses/tools.json';
import openaiResponsesReasoning from './openai-responses/reasoning.json';
import openaiResponsesReasoningNone from './openai-responses/reasoning.none.json';
import openaiResponsesReasoningDeepseek from './openai-responses/reasoning.deepseek.json';
import anthropicConnectivity from './anthropic/connectivity.json';
import anthropicTools from './anthropic/tools.json';
import anthropicReasoningExtended from './anthropic/reasoning.extended.json';
import anthropicReasoningExtendedEffort from './anthropic/reasoning.extended-effort.json';
import anthropicReasoningAdaptive from './anthropic/reasoning.adaptive.json';
import geminiConnectivity from './gemini/connectivity.json';
import geminiTools from './gemini/tools.json';
import geminiToolsNoStreamArgs from './gemini/tools.no-stream-args.json';
import geminiReasoningBudget from './gemini/reasoning.budget.json';
import geminiReasoningLevel from './gemini/reasoning.level.json';
import sampleRoutes from './routes.json';
import { SAMPLE_PREDICATES, type SamplePredicateId } from './predicates';

export type PlaygroundLlmFamily = 'openai_chat' | 'openai_responses' | 'anthropic' | 'gemini';

export type PlaygroundLlmSampleId = 'connectivity' | 'tools' | 'reasoning';

export const PLAYGROUND_LLM_SAMPLE_IDS: readonly PlaygroundLlmSampleId[] = [
	'connectivity',
	'tools',
	'reasoning',
];

export type { ClaudeThinkingProfile, GeminiThinkingProfile } from './predicates';
export { resolveClaudeThinkingProfile, resolveGeminiThinkingProfile } from './predicates';

type SampleRouteRule = { when?: SamplePredicateId; id: string };

type SampleRouteTable = Record<PlaygroundLlmFamily, Record<PlaygroundLlmSampleId, SampleRouteRule[]>>;

const SAMPLE_BODIES: Record<string, unknown> = {
	'openai-chat/connectivity': openaiChatConnectivity,
	'openai-chat/connectivity.max-completion': openaiChatConnectivityMaxCompletion,
	'openai-chat/tools': openaiChatTools,
	'openai-chat/tools.max-completion': openaiChatToolsMaxCompletion,
	'openai-chat/reasoning.effort': openaiChatReasoningEffort,
	'openai-chat/reasoning.effort-max-completion': openaiChatReasoningEffortMaxCompletion,
	'openai-chat/reasoning.none': openaiChatReasoningNone,
	'openai-chat/reasoning.thinking': openaiChatReasoningThinking,
	'openai-chat/reasoning.thinking-effort': openaiChatReasoningThinkingEffort,
	'openai-chat/reasoning.qwen': openaiChatReasoningQwen,
	'openai-chat/reasoning.minimax': openaiChatReasoningMinimax,
	'openai-responses/connectivity': openaiResponsesConnectivity,
	'openai-responses/tools': openaiResponsesTools,
	'openai-responses/reasoning': openaiResponsesReasoning,
	'openai-responses/reasoning.none': openaiResponsesReasoningNone,
	'openai-responses/reasoning.deepseek': openaiResponsesReasoningDeepseek,
	'anthropic/connectivity': anthropicConnectivity,
	'anthropic/tools': anthropicTools,
	'anthropic/reasoning.extended': anthropicReasoningExtended,
	'anthropic/reasoning.extended-effort': anthropicReasoningExtendedEffort,
	'anthropic/reasoning.adaptive': anthropicReasoningAdaptive,
	'gemini/connectivity': geminiConnectivity,
	'gemini/tools': geminiTools,
	'gemini/tools.no-stream-args': geminiToolsNoStreamArgs,
	'gemini/reasoning.budget': geminiReasoningBudget,
	'gemini/reasoning.level': geminiReasoningLevel,
};

const SAMPLE_ROUTES = sampleRoutes as SampleRouteTable;

export function formatPlaygroundSampleJson(body: unknown): string {
	return JSON.stringify(body, null, 2);
}

export function resolvePlaygroundSampleId(
	family: PlaygroundLlmFamily,
	sampleId: PlaygroundLlmSampleId,
	haystack = '',
): string {
	const rules = SAMPLE_ROUTES[family]?.[sampleId];
	if (!rules?.length) {
		throw new Error(`No playground sample route for ${family}.${sampleId}`);
	}
	for (const rule of rules) {
		if (!rule.when) return rule.id;
		const predicate = SAMPLE_PREDICATES[rule.when];
		if (!predicate) {
			throw new Error(`Unknown playground sample predicate: ${rule.when}`);
		}
		if (predicate(haystack)) return rule.id;
	}
	return rules[rules.length - 1].id;
}

export function loadPlaygroundSampleBody(
	family: PlaygroundLlmFamily,
	sampleId: PlaygroundLlmSampleId,
	haystack = '',
): string {
	const id = resolvePlaygroundSampleId(family, sampleId, haystack);
	const body = SAMPLE_BODIES[id];
	if (body == null) {
		throw new Error(`Missing playground sample JSON: ${id}`);
	}
	return formatPlaygroundSampleJson(body);
}

export const PLAYGROUND_SAMPLE_IDS = Object.keys(SAMPLE_BODIES);
