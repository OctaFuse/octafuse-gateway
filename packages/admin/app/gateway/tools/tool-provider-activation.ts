import type { ProviderCardStatusFlags } from './components/provider-card-state';

export function providerActivationBlock(item: {
	savedConfigured: boolean;
	status: ProviderCardStatusFlags;
}): 'unavailable' | 'unsaved' | 'missing' | null {
	if (!item.status.isImplemented) return 'unavailable';
	if (item.status.isDirty) return 'unsaved';
	return item.savedConfigured ? null : 'missing';
}

type WriteResult = { ok: true; message?: string } | { ok: false; message: string };
/** Existing catalogs only need an ACTIVE write. Legacy initialization uses saved snapshots, never editor drafts. */
export async function activateSavedToolProvider(input: {
	providerId: string;
	activeKey: string;
	catalogKey: string;
	hasSavedCatalog: boolean;
	savedCatalog: string | null;
	write: (key: string, value: string) => Promise<WriteResult>;
}) {
	let catalogInitialized = false;
	try {
		if (!input.hasSavedCatalog) {
			if (input.savedCatalog == null) return { ok: false as const, catalogInitialized, message: undefined };
			const result = await input.write(input.catalogKey, input.savedCatalog);
			if (!result.ok) return { ok: false as const, catalogInitialized, message: result.message };
			catalogInitialized = true;
		}
		const result = await input.write(input.activeKey, input.providerId);
		return { ...result, catalogInitialized };
	} catch {
		return { ok: false as const, catalogInitialized, message: undefined };
	}
}
