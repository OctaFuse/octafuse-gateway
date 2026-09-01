'use client';

import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import {
	providerCatalogOutboundRel,
	resolveProviderCatalogOutbound,
	type ProviderCatalogLinks,
} from '@/lib/provider-import-preset';

type ProviderCatalogOutboundLinkProps = {
	links: ProviderCatalogLinks | null | undefined;
	className?: string;
	/** When the parent card swallows clicks, keep this link above it. */
	stopPropagation?: boolean;
};

export function ProviderCatalogOutboundLink(props: ProviderCatalogOutboundLinkProps) {
	const { links, className, stopPropagation } = props;
	const t = useTranslations('providers.outbound');
	const outbound = resolveProviderCatalogOutbound(links);
	if (!outbound) return null;

	return (
		<a
			href={outbound.href}
			target="_blank"
			rel={providerCatalogOutboundRel(outbound.kind)}
			className={className}
			onClick={
				stopPropagation
					? (event) => {
							event.stopPropagation();
						}
					: undefined
			}
			onKeyDown={
				stopPropagation
					? (event) => {
							event.stopPropagation();
						}
					: undefined
			}
		>
			{t('go')}
			<ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
		</a>
	);
}
