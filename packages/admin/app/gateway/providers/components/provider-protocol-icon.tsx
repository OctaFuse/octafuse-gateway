import {
	OpenAiEndpointIcon,
	AnthropicEndpointIcon,
	GeminiEndpointIcon,
} from '@/components/upstream-brand-logo';
import type { ProviderProtocolSummary } from '../types';

export function ProviderProtocolIcon(props: { protocol: ProviderProtocolSummary['key'] }) {
	if (props.protocol === 'openai') return <OpenAiEndpointIcon label="OpenAI" className="inline-flex" />;
	if (props.protocol === 'anthropic') return <AnthropicEndpointIcon label="Anthropic" className="h-4 w-4" />;
	return <GeminiEndpointIcon label="Gemini" className="h-4 w-4" />;
}
