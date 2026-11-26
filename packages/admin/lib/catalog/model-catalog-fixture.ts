import { listStaticModelPresetCatalogForAdmin as projectCatalog } from '../services/admin/models-service';
import { buildModelCatalogPresentation } from '../model-preset';
import { listStaticModelPresets } from './local-model-catalog';

export * from '../model-preset';
export { listStaticModelPresets };
const { retiredByModelId } = buildModelCatalogPresentation(listStaticModelPresets());
export function getStaticModelPresetRetired(id: string) {
	return retiredByModelId.get(id.trim()) ?? null;
}

export function listStaticModelPresetCatalogForAdmin(billing?: Parameters<typeof projectCatalog>[1]) {
	return projectCatalog(listStaticModelPresets(), billing);
}
