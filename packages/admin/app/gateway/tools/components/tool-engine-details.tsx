'use client';

import { useTranslations } from 'next-intl';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { toolEngineGuide } from '../tool-engine-guide';

/** Row-scoped engine behavior, based on the adapters implemented in this gateway. */
export function ToolEngineDetails({ toolId, providerId }: { toolId: string; providerId: string }) {
	const t = useTranslations('tools.engineGuide');
	const guide = toolEngineGuide(toolId, providerId);
	if (!guide) return null;
	return (
		<div className="min-w-0 space-y-3">
			<div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
				<p className="min-w-0 flex-1 text-sm leading-6 text-gray-700">{t(`items.${guide.copyKey}.summary`)}</p>
				<a
					href={guide.docsHref}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex shrink-0 items-center gap-1.5 rounded text-xs text-gray-600 hover:text-gray-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
				>
					{t('docs')}
					<ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" aria-hidden="true" />
				</a>
			</div>
			<p className="text-xs leading-6 text-gray-500">
				<span className="mr-2 font-medium text-gray-600">{t('integration')}</span>
				{t(`items.${guide.copyKey}.note`)}
			</p>
		</div>
	);
}
