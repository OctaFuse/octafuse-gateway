'use client';

import { useTranslations } from 'next-intl';
import {
	OpenAiEndpointIcon,
	AnthropicEndpointIcon,
	GeminiEndpointIcon,
} from '@/components/upstream-brand-logo';
import type { ProviderProtocolSummary } from '../types';

export function ProviderProtocolIcon(props: { protocol: ProviderProtocolSummary['key'] }) {
	const t = useTranslations('upstream');
	if (props.protocol === 'openai') return <OpenAiEndpointIcon label={t('openai')} className="inline-flex" />;
	if (props.protocol === 'anthropic') return <AnthropicEndpointIcon label={t('anthropic')} className="h-4 w-4" />;
	return <GeminiEndpointIcon label={t('gemini')} className="h-4 w-4" />;
}
