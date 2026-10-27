'use client';

import { useTranslations } from 'next-intl';
import { VendorIcon } from '@/components/model-vendor-icon';
import type { ProviderStickyIdentity } from '../types';

export function StickyProviderIdentity({
	identity,
	fallbackName,
	enabled,
}: {
	identity?: ProviderStickyIdentity;
	fallbackName: string;
	enabled?: boolean;
}) {
	const t = useTranslations('routes.providerSticky');
	const name = identity?.accountName || fallbackName;
	return (
		<div className="flex min-w-0 items-center gap-2">
			<VendorIcon
				vendor={identity?.vendorKey}
				iconKey={identity?.iconKey}
				size="compact"
				className={enabled === false ? 'opacity-60 grayscale' : ''}
			/>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5">
					<span title={name} className="truncate text-xs font-medium text-gray-800">
						{name}
					</span>
					{enabled === false ? (
						<span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
							{t('targetDisabled')}
						</span>
					) : null}
				</div>
				{identity?.kindLabel ? (
					<p title={identity.kindLabel} className="mt-0.5 truncate text-[11px] text-gray-500">
						{identity.kindLabel}
					</p>
				) : null}
			</div>
		</div>
	);
}
