'use client';

import { AdjustmentsHorizontalIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { useId, useState, type ReactNode } from 'react';

/** Keep secondary filters available without pushing results below the first mobile screen. */
export function FilterDisclosure({ children, activeCount = 0, className = '', label }: {
  children: ReactNode;
  activeCount?: number;
  className?: string;
  label?: string;
}) {
  const t = useTranslations('responsive');
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();

  return (
    <div className={`min-w-0 ${className}`}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm font-medium text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 md:hidden"
      >
        <AdjustmentsHorizontalIcon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">{label ?? t('filters')}</span>
        {activeCount > 0 && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
            {t('activeFilters', { count: activeCount })}
          </span>
        )}
        <ChevronDownIcon className={`h-4 w-4 shrink-0 ${expanded ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <div id={contentId} className={`${expanded ? 'block' : 'hidden'} pt-3 md:block md:pt-0`}>
        {children}
      </div>
    </div>
  );
}
