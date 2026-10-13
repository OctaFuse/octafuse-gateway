'use client';
import { ToolPricingEditor } from '@/components/tool-pricing-editor';
import { restFactorDraft, restPricingDraftChanged, type RestToolPricingDraft } from '../tool-pricing-draft';
export function RestToolPricingEditor({
	value,
	currency,
	unitLabel,
	onChange,
}: {
	value: RestToolPricingDraft;
	currency: string;
	unitLabel?: string;
	onChange: (patch: RestToolPricingDraft) => void;
}) {
	return (
		<ToolPricingEditor
			value={restFactorDraft(value)}
			currency={currency}
			unitLabel={unitLabel}
			onChange={(draft) => onChange(restPricingDraftChanged(draft))}
		/>
	);
}
