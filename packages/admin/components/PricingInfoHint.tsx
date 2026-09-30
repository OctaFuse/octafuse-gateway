'use client';

import { useTranslations } from 'next-intl';
import { InfoHintPopover } from './InfoHintPopover';

type PricingHelpKind =
	| 'routeFactors'
	| 'unitPrices'
	| 'catalog'
	| 'amounts'
	| 'profit'
	| 'playground'
	| 'simulator';

/** Shared terminology for configuration, unit-price previews and recorded amounts. */
export function PricingInfoHint({ kind, align = 'end' }: { kind: PricingHelpKind; align?: 'start' | 'end' }) {
	const t = useTranslations('pricing.help');
	return (
		<InfoHintPopover label={t(`${kind}.title`)} openOnHover portal align={align}>
			<p className="whitespace-pre-line leading-6">{t(`${kind}.body`)}</p>
		</InfoHintPopover>
	);
}
