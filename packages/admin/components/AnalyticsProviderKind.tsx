'use client';

import { useLocale, useTranslations } from 'next-intl';
import { GATEWAY_TOOLS_PROVIDER_ID } from '@/lib/gateway-tools';
import { providerKindDisplayLabel, providerKindFilterKey } from '@/lib/provider-kind';
import type { GatewayProvider } from '@/lib/types';

type Kind = { key: string; label: string };

/** Type is independent of account name, even when the two labels happen to match. */
export function useAnalyticsProviderKind(catalog: ReadonlyMap<string, GatewayProvider>) {
  const locale = useLocale();
  const t = useTranslations('analytics.providerDimensions');
  const tKind = useTranslations('providers.kind');
  return (providerId: string | null | undefined): Kind => {
    if (providerId === GATEWAY_TOOLS_PROVIDER_ID) return { key: 'gateway-tools', label: t('gatewayTools') };
    const provider = providerId ? catalog.get(providerId) : undefined;
    // Logs snapshot the account name, not its kind. Never infer a deleted provider's type from its name.
    if (!provider) return { key: 'unknown', label: t('unknown') };
    return {
      key: `kind:${providerKindFilterKey(provider.kind)}`,
      label: providerKindDisplayLabel(provider, locale, tKind('custom')) || tKind('unclassified'),
    };
  };
}

export function AnalyticsProviderKindFilter({ value, onChange, kinds }: {
  value: string; onChange: (value: string) => void; kinds: Kind[];
}) {
  const t = useTranslations('analytics.providerDimensions');
  const tA = useTranslations('analytics.columns');
  const options = [...new Map(kinds.map(kind => [kind.key, kind])).values()];
  options.sort((a, b) => a.label.localeCompare(b.label));
  return <label className="flex items-center gap-2 text-sm text-gray-600">
    <span className="whitespace-nowrap">{tA('providerKind')}</span>
    <select aria-label={tA('providerKind')} value={value} onChange={event => onChange(event.target.value)}
      className="min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
      <option value="">{t('all')}</option>
      {value && !options.some(option => option.key === value) && <option value={value}>{t('noMatchingKind')}</option>}
      {options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
    </select>
  </label>;
}
