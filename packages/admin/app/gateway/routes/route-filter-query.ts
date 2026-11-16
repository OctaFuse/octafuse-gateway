import { parseGroupedSelection, type GroupedSelection } from '@/lib/grouped-selection';
import { normalizeModelVendorInput } from '@/lib/model-vendor';

/** 新参数优先；旧供应商链接同时带类型和 ID 时，保留具体供应商范围。 */
export function readRouteCatalogFilters(params: Pick<URLSearchParams, 'get' | 'has'>) {
	const models = parseGroupedSelection(params.get('model_vendors') ?? params.get('vendor'), params.get('model_ids') ?? params.get('model_id'));
	models.groups = [...new Set(models.groups.map(normalizeModelVendorInput))];
	const providers = params.has('provider_kinds') || params.has('provider_ids')
		? parseGroupedSelection(params.get('provider_kinds'), params.get('provider_ids'))
		: params.get('provider_id')
			? parseGroupedSelection(null, params.get('provider_id'))
			: parseGroupedSelection(params.get('provider_kind'), null);
	return { models, providers };
}

export function writeRouteCatalogFilters(params: URLSearchParams, models: GroupedSelection, providers: GroupedSelection) {
	for (const key of ['vendor', 'model_id', 'provider_kind', 'provider_id', 'model_vendors', 'model_ids', 'provider_kinds', 'provider_ids']) params.delete(key);
	for (const [key, values] of [
		['model_vendors', models.groups], ['model_ids', models.items],
		['provider_kinds', providers.groups], ['provider_ids', providers.items],
	] as const) {
		if (values.length) params.set(key, values.join(','));
	}
	return params;
}
