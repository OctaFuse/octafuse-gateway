'use client';
import { useTranslations } from 'next-intl';
import type { ProxyUrlSource } from '@/lib/proxy-base-url';

export function ProxyConnectionHint({
	source,
	canReset,
	onReset,
	disabled,
}: {
	source: ProxyUrlSource;
	canReset: boolean;
	onReset: () => void;
	disabled?: boolean;
}) {
	const t = useTranslations('proxyConnection');
	return (
		<div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs leading-5 text-gray-500">
			<span>{t(`source.${source}`)}</span>
			{canReset ? (
				<button
					type="button"
					disabled={disabled}
					onClick={onReset}
					className="rounded text-gray-600 underline underline-offset-4 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 disabled:opacity-50"
				>
					{t('reset')}
				</button>
			) : null}
		</div>
	);
}
