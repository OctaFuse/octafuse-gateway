"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AdjustmentsHorizontalIcon } from '@heroicons/react/24/outline';
import { AdminDialog } from './admin-dialog';
import { useElementWidth } from './use-element-width';

/** Common secondary filters surface when space allows; rare filters stay in the dialog.
 * Keep an open dialog intact while resizing, then return focus to a visible control. */
export function AdaptiveFilterGroup({
  label, children, extra, activeCount = 0, extraCount = 0,
  inlineAt = 1280, inlineClassName = 'flex flex-wrap items-end gap-3', size = 'md',
}: {
  label: string;
  children: ReactNode;
  extra?: ReactNode;
  activeCount?: number;
  extraCount?: number;
  inlineAt?: number;
  inlineClassName?: string;
  size?: 'md' | 'lg';
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fallbackFocusRef = useRef<HTMLElement | null>(null);
  const wide = useElementWidth(rootRef, true) >= inlineAt;
  const [open, setOpen] = useState(false);
  const [includeCommon, setIncludeCommon] = useState(true);
  useLayoutEffect(() => {
    fallbackFocusRef.current = rootRef.current?.parentElement?.querySelector<HTMLElement>('input, select') ?? null;
  }, []);
  const count = open ? (includeCommon ? activeCount : extraCount) : wide ? extraCount : activeCount;
  const title = `${label}${count ? ` · ${count}` : ''}`;
  return (
    <div ref={rootRef} className="contents" data-adaptive-filters={wide ? 'expanded' : 'collapsed'}>
      {wide && (!open || !includeCommon) && <div className={`admin-adaptive-fields min-w-0 ${inlineClassName}`}>{children}</div>}
      {(!wide || extra) && (
        <button type="button" onClick={() => { setIncludeCommon(!wide); setOpen(true); }} aria-haspopup="dialog" aria-expanded={open}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 hover:bg-gray-50 focus-visible:outline-gray-500">
          <AdjustmentsHorizontalIcon className="h-4 w-4" aria-hidden />
          {title}
        </button>
      )}
      <AdminDialog open={open} title={title} size={size} onClose={() => setOpen(false)} fallbackFocusRef={fallbackFocusRef}>
        <div className="space-y-4">
          {includeCommon && children}
          {extra}
        </div>
      </AdminDialog>
    </div>
  );
}
