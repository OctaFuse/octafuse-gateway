'use client';

import { useTranslations } from 'next-intl';
import { CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';

/** Saved usage status; draft credentials must not imply that a provider is serving traffic. */
export function ToolProviderUsage({
	active,
	configured,
	implemented = true,
}: {
	active: boolean;
	configured: boolean;
	implemented?: boolean;
}) {
	const t = useTranslations('tools.serviceList');
	const state = !implemented
		? 'unavailable'
		: active && configured
		? 'inUse'
		: active
		? 'needsCredentials'
		: configured
		? 'standby'
		: 'needsSetup';
	const tone =
		state === 'inUse'
			? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15'
			: state === 'needsSetup' || state === 'needsCredentials'
			? 'bg-amber-50 text-amber-800 ring-amber-600/15'
			: 'bg-gray-100 text-gray-600 ring-gray-500/10';
	return (
		<span
			className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${tone}`}
		>
			{state === 'inUse' ? (
				<CheckCircleIcon className="h-3.5 w-3.5" aria-hidden="true" />
			) : state === 'needsCredentials' ? (
				<ExclamationCircleIcon className="h-3.5 w-3.5" aria-hidden="true" />
			) : null}
			{t(state)}
		</span>
	);
}
