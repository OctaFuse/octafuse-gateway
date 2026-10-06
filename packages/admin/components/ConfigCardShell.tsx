'use client';

import { useId, type ReactNode } from 'react';
import { InfoHintPopover } from './InfoHintPopover';

/** Compact settings card with an optional explanation and independent save footer. */
export function ConfigCardShell({
  title,
  description,
  hint,
  children,
  footer,
  id,
}: {
  title: string;
  description: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  id?: string;
}) {
  const titleId = useId();
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className="flex min-w-0 flex-col rounded-xl border border-gray-200 bg-white p-4 sm:p-6"
    >
      <div className="mb-5">
        <div className="flex items-center gap-2">
          <h2 id={titleId} className="text-base font-semibold text-gray-900">
            {title}
          </h2>
          {hint && (
            <InfoHintPopover label={title} portal openOnHover align="start">
              {hint}
            </InfoHintPopover>
          )}
        </div>
        <div className="mt-1 text-sm leading-relaxed text-gray-500">{description}</div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      {footer && <div className="mt-5 border-t border-gray-100 pt-4">{footer}</div>}
    </section>
  );
}
