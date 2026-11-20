'use client';

import { useEffect, useRef } from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';

interface Props {
  remainingSeconds: number;
  onClose: () => void;
}

export default function LoginLockoutDialog({ remainingSeconds, onClose }: Props) {
  const t = useTranslations('auth');
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    buttonRef.current?.focus();
    return () => previous?.focus();
  }, []);

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = String(remainingSeconds % 60).padStart(2, '0');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/50 px-4 py-6"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
        if (event.key === 'Tab') { event.preventDefault(); buttonRef.current?.focus(); }
      }}>
      <section role="dialog" aria-modal="true" aria-labelledby="login-lockout-title"
        aria-describedby="login-lockout-description"
        className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-xl sm:p-8">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
          <ExclamationTriangleIcon className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 id="login-lockout-title" className="text-xl font-semibold text-gray-950">{t('lockedOutTitle')}</h2>
        <p id="login-lockout-description" className="mt-2 text-sm leading-6 text-gray-600">{t('lockedOutDescription')}</p>
        <p className="mt-5 rounded-lg bg-gray-50 px-4 py-3 font-mono text-lg tabular-nums text-gray-950" aria-live="polite">
          {t('lockedOutCountdown', { time: `${minutes}:${seconds}` })}
        </p>
        <button ref={buttonRef} type="button" onClick={onClose}
          className="admin-primary mt-6 h-11 w-full rounded-lg px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2">
          {t('lockoutAcknowledge')}
        </button>
      </section>
    </div>
  );
}
