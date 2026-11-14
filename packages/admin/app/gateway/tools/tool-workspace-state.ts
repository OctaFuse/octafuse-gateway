import type { PriceTripleDraft, ProviderCardStatusFlags } from './components/provider-card-state';

type ConfigurationItem = {
	savedPrices: PriceTripleDraft;
	savedConfigured: boolean;
	status: ProviderCardStatusFlags;
};
/** The overview describes applied configuration, even when an editor holds unsaved credentials or prices. */
export function toolConfigurationState<T extends ConfigurationItem>(items: readonly T[]) {
	const active = items.find((item) => item.status.isActive);
	return {
		active,
		ready: Boolean(active?.savedConfigured && active.status.isImplemented),
		dirty: items.some((item) => item.status.isDirty),
	};
}
