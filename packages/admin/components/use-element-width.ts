"use client";

import { useLayoutEffect, useState, type RefObject } from 'react';

/** Measure usable layout space rather than the browser viewport. */
export function useElementWidth(ref: RefObject<HTMLElement | null>, parent = false) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = parent ? ref.current?.parentElement : ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, parent]);
  return width;
}
