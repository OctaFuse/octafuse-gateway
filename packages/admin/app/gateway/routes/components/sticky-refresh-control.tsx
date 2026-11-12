'use client';

import { useTranslations } from 'next-intl';
import { AutoRefreshControl } from '@/components/AutoRefreshControl';
import { type StickyRefreshIntervalMs, writeStickyRefreshInterval } from '../sticky-refresh-preference';
import { useStickyRefreshControls } from '../sticky-summary-store';

export function StickyRefreshControl({ intervalMs }: { intervalMs: StickyRefreshIntervalMs }) {
	const t = useTranslations('routes.workspace');
	const { refreshAll, registeredCount, ...state } = useStickyRefreshControls();
	return <AutoRefreshControl {...state} intervalMs={intervalMs}
		onIntervalChange={writeStickyRefreshInterval} refresh={refreshAll} disabled={registeredCount === 0}
		label={t('stickyRefreshLabel')} refreshLabel={t('stickyRefreshNow')} disabledHint={t('stickyRefreshEmptyHint')} />;
}
