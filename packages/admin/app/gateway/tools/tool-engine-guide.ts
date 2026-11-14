import { WEB_SEARCH_PROVIDER_DOCS_URL, type WebSearchProvider } from '@/lib/web-search-options';
import { WEB_FETCH_PROVIDER_DOCS_URL, type WebFetchProvider } from '@/lib/web-fetch-options';
import { WEB_DEEP_SEARCH_PROVIDER_DOCS_URL, type WebDeepSearchProvider } from '@/lib/web-deep-search-options';
import { AI_DETECTION_PROVIDER_DOCS_URL, type AiDetectionProvider } from '@/lib/ai-detection-options';
import type { RestToolId } from './tool-api-guide';

type Providers = {
	'web-search': WebSearchProvider;
	'web-fetch': WebFetchProvider;
	'web-deep-search': WebDeepSearchProvider;
	'ai-detection': AiDetectionProvider;
};
const docs: { [Tool in RestToolId]: Record<Providers[Tool], string> } = {
	'web-search': WEB_SEARCH_PROVIDER_DOCS_URL,
	'web-fetch': WEB_FETCH_PROVIDER_DOCS_URL,
	'web-deep-search': WEB_DEEP_SEARCH_PROVIDER_DOCS_URL,
	'ai-detection': AI_DETECTION_PROVIDER_DOCS_URL,
};
const groups: Record<RestToolId, string> = {
	'web-search': 'webSearch',
	'web-fetch': 'webFetch',
	'web-deep-search': 'webDeepSearch',
	'ai-detection': 'aiDetection',
};
export function toolEngineGuide(toolId: string, providerId: string) {
	if (!Object.hasOwn(docs, toolId)) return null;
	const tool = toolId as RestToolId;
	const providers: Record<string, string> = docs[tool];
	if (!Object.hasOwn(providers, providerId)) return null;
	return { copyKey: `${groups[tool]}.${providerId}`, docsHref: providers[providerId]! };
}
