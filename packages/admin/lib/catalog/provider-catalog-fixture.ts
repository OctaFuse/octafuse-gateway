import { createProviderCatalog } from '../provider-catalog';
import { localProviderRows } from './local-provider-catalog';

export * from '../provider-catalog-pure';
export const {
	inferStaticProviderVendorKey,
	inferStaticProviderIconKey,
	lookupStaticProviderCatalogLinks,
	resolveStoredProviderPresentation,
	isKnownProviderKind,
	getStaticProviderPresetByKind,
	suggestStaticProviderKindByEndpoints,
	listProviderKindChoices,
	listStaticProviderImportPresets,
	listStaticProviderImportCatalogForAdmin,
} = createProviderCatalog(localProviderRows);
