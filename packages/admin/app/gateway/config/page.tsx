'use client';

/**
 * `system_config`：`BUSINESS_TIMEZONE`、`BILLING_CURRENCY`、
 * `USER_CHARGED_COST_FACTOR_MODE`、`ROUTE_STRATEGY`、错误 Webhook 均为专用卡片；敏感字段支持 Show/Hide。
 * 产品工具配置见 `/gateway/tools`。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { ConfigCardShell } from '@/components/ConfigCardShell';
import { InfoHintPopover } from '@/components/InfoHintPopover';
import { readApiJson } from '@/lib/api-json';
import type { SystemConfigRow } from '@/lib/types';
import { BILLING_CURRENCY_KEY, getBillingCurrencyOptions } from '@/lib/billing-currency-options';
import {
  BUSINESS_TIMEZONE_KEY,
  BUSINESS_TIMEZONE_VALUES,
  getBusinessTimezoneOptions,
} from '@/lib/business-timezone-options';
import {
  DEFAULT_ROUTE_STRATEGY,
  ROUTE_STRATEGY_NAMES,
  isRouteStrategyName,
} from '@octafuse/core/db/model-route-policy';
import { ROUTE_STRATEGY_KEY } from '@octafuse/core/lib/route-strategy-system-config';
import {
  DEFAULT_USER_CHARGED_COST_FACTOR_MODE,
  USER_CHARGED_COST_FACTOR_MODE_KEY,
  USER_CHARGED_COST_FACTOR_MODES,
  isUserChargedCostFactorMode,
  type UserChargedCostFactorMode,
} from '@octafuse/core/lib/user-charged-cost-factor-mode';
import {
  ALERT_WEBHOOK_FEISHU_URL_KEY,
  ALERT_WEBHOOK_WECOM_URL_KEY,
} from '@octafuse/core/lib/alert-webhook-system-config';
import { useTranslations } from 'next-intl';
import { useBusinessTimezoneContext } from '@/components/BusinessTimezoneProvider';
import { GlobalRouteStrategySection } from './global-route-strategy-section';

const OTHER_TZ = '__other__';

function syncBillingCurrencyUi(rows: SystemConfigRow[], setSelect: (v: string) => void) {
  const row = rows.find((r) => r.key === BILLING_CURRENCY_KEY);
  const v = row?.value?.trim().toUpperCase() || 'USD';
  /** 历史非法或非白名单值在 UI 上归一为 USD，保存时需用户显式选 CNY 再写入。 */
  setSelect(v === 'CNY' ? 'CNY' : 'USD');
}

function syncRouteStrategyUi(rows: SystemConfigRow[], setSelect: (v: string) => void) {
  const row = rows.find((r) => r.key === ROUTE_STRATEGY_KEY);
  const v = (row?.value ?? '').trim().toLowerCase();
  setSelect(isRouteStrategyName(v) ? v : DEFAULT_ROUTE_STRATEGY);
}

function syncUserChargedCostFactorModeUi(rows: SystemConfigRow[], setSelect: (v: UserChargedCostFactorMode) => void) {
  const row = rows.find((r) => r.key === USER_CHARGED_COST_FACTOR_MODE_KEY);
  const v = (row?.value ?? '').trim().toLowerCase();
  setSelect(isUserChargedCostFactorMode(v) ? v : DEFAULT_USER_CHARGED_COST_FACTOR_MODE);
}

function syncBusinessTimezoneUi(
  rows: SystemConfigRow[],
  setSelect: (v: string) => void,
  setOther: (v: string) => void
) {
  const row = rows.find((r) => r.key === BUSINESS_TIMEZONE_KEY);
  const v = row?.value?.trim() || 'UTC';
  if ((BUSINESS_TIMEZONE_VALUES as readonly string[]).includes(v)) {
    setSelect(v);
    setOther('');
  } else {
    setSelect(OTHER_TZ);
    setOther(v);
  }
}

function isValidIanaTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Webhook URL：默认隐藏，可显式展开为可换行的文本框。 */
function WebhookUrlField({
  showLabel,
  hideLabel,
  id,
  label,
  optionalHint,
  value,
  onChange,
  placeholder,
  visible,
  disabled,
  onToggleVisible,
}: {
  showLabel: string;
  hideLabel: string;
  id: string;
  label: string;
  optionalHint: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  visible: boolean;
  disabled: boolean;
  onToggleVisible: () => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className="block text-xs font-medium text-gray-600">
          {label} <span className="ml-1 text-[11px] font-normal text-gray-400">{optionalHint}</span>
        </label>
        <button
          type="button"
          onClick={onToggleVisible}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          aria-pressed={visible}
        >
          {visible ? (
            <>
              <EyeSlashIcon className="h-4 w-4" aria-hidden />
              {hideLabel}
            </>
          ) : (
            <>
              <EyeIcon className="h-4 w-4" aria-hidden />
              {showLabel}
            </>
          )}
        </button>
      </div>
      {visible ? (
        <textarea
          id={id}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          rows={2}
          className="w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm font-mono leading-relaxed text-gray-900 shadow-sm break-all"
        />
      ) : (
        <input
          id={id}
          type="password"
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono shadow-sm"
        />
      )}
    </div>
  );
}

function ConfigSaveActions({
  dirty,
  saving,
  section,
  saveLabel,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  section: string;
  saveLabel: string;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations('config.ux');
  const tCommon = useTranslations('common');
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className={`text-xs ${dirty ? 'text-amber-700' : 'text-gray-400'}`} role="status">
        {dirty ? t('unsaved') : t('saved')}
      </span>
      <div className="flex items-center gap-2">
        {dirty && (
          <button
            type="button"
            disabled={saving}
            onClick={onDiscard}
            aria-label={t('discardSection', { section })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {t('discard')}
          </button>
        )}
        <button
          type="button"
          disabled={saving || !dirty}
          onClick={onSave}
          aria-label={saveLabel}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? tCommon('saving') : tCommon('save')}
        </button>
      </div>
    </div>
  );
}

export default function GatewayConfigPage() {
  const t = useTranslations('config');
  const tCommon = useTranslations('common');
  const tOptions = useTranslations('options');
  const { refresh: refreshBusinessTimezone } = useBusinessTimezoneContext();
  const businessTimezoneOptions = getBusinessTimezoneOptions((k) => tOptions(k));
  const billingCurrencyOptions = getBillingCurrencyOptions((k) => tOptions(k));
  const [config, setConfig] = useState<SystemConfigRow[]>([]);
  const [loadError, setLoadError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [bizSelectValue, setBizSelectValue] = useState('UTC');
  const [bizOtherValue, setBizOtherValue] = useState('');
  const [bizSaving, setBizSaving] = useState(false);
  const [billSelectValue, setBillSelectValue] = useState('USD');
  const [billSaving, setBillSaving] = useState(false);
  const [userChargedModeValue, setUserChargedModeValue] = useState<UserChargedCostFactorMode>(
    DEFAULT_USER_CHARGED_COST_FACTOR_MODE
  );
  const [userChargedModeSaving, setUserChargedModeSaving] = useState(false);
  const [routeStrategyValue, setRouteStrategyValue] = useState<string>(DEFAULT_ROUTE_STRATEGY);
  const [routeStrategySaving, setRouteStrategySaving] = useState(false);
  const saveSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [wecomWebhookDraft, setWecomWebhookDraft] = useState('');
  const [feishuWebhookDraft, setFeishuWebhookDraft] = useState('');
  const [alertWebhooksSaving, setAlertWebhooksSaving] = useState(false);
  const [webhookWecomVisible, setWebhookWecomVisible] = useState(false);
  const [webhookFeishuVisible, setWebhookFeishuVisible] = useState(false);

  const savedTimezone = config.find((row) => row.key === BUSINESS_TIMEZONE_KEY)?.value?.trim() || 'UTC';
  const savedCurrencyRaw = config
    .find((row) => row.key === BILLING_CURRENCY_KEY)
    ?.value?.trim()
    .toUpperCase();
  const savedCurrency = savedCurrencyRaw === 'CNY' ? 'CNY' : 'USD';
  const savedModeRaw =
    config.find((row) => row.key === USER_CHARGED_COST_FACTOR_MODE_KEY)?.value?.trim().toLowerCase() ?? '';
  const savedMode = isUserChargedCostFactorMode(savedModeRaw) ? savedModeRaw : DEFAULT_USER_CHARGED_COST_FACTOR_MODE;
  const savedWecom = config.find((row) => row.key === ALERT_WEBHOOK_WECOM_URL_KEY)?.value ?? '';
  const savedFeishu = config.find((row) => row.key === ALERT_WEBHOOK_FEISHU_URL_KEY)?.value ?? '';
  const timezoneDirty = (bizSelectValue === OTHER_TZ ? bizOtherValue.trim() : bizSelectValue) !== savedTimezone;
  const currencyDirty = billSelectValue !== savedCurrency;
  const modeDirty = userChargedModeValue !== savedMode;
  const webhooksDirty =
    wecomWebhookDraft.trim() !== savedWecom.trim() || feishuWebhookDraft.trim() !== savedFeishu.trim();
  const hasUnsavedChanges = !isLoading && !loadError && (timezoneDirty || currencyDirty || modeDirty || webhooksDirty);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const fetchConfig = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError('');
      const response = await fetch('/api/admin/config');
      const data = await readApiJson<SystemConfigRow[]>(response);
      if (data.success && Array.isArray(data.data)) {
        setConfig(data.data);
        syncBusinessTimezoneUi(data.data, setBizSelectValue, setBizOtherValue);
        syncBillingCurrencyUi(data.data, setBillSelectValue);
        syncUserChargedCostFactorModeUi(data.data, setUserChargedModeValue);
        syncRouteStrategyUi(data.data, setRouteStrategyValue);
        const wecomRow = data.data.find((r) => r.key === ALERT_WEBHOOK_WECOM_URL_KEY);
        const feishuRow = data.data.find((r) => r.key === ALERT_WEBHOOK_FEISHU_URL_KEY);
        setWecomWebhookDraft(wecomRow?.value ?? '');
        setFeishuWebhookDraft(feishuRow?.value ?? '');
      } else {
        setLoadError(data.message || tCommon('requestFailed'));
      }
    } catch (error) {
      console.error('Fetch config error:', error);
      setLoadError(tCommon('requestFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [tCommon]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    return () => {
      if (saveSuccessTimerRef.current != null) {
        clearTimeout(saveSuccessTimerRef.current);
      }
    };
  }, []);

  const clearSaveSuccess = useCallback(() => {
    if (saveSuccessTimerRef.current != null) {
      clearTimeout(saveSuccessTimerRef.current);
      saveSuccessTimerRef.current = null;
    }
    setSaveSuccess('');
  }, []);

  const flashSaveSuccess = useCallback(
    (message?: string) => {
      if (saveSuccessTimerRef.current != null) {
        clearTimeout(saveSuccessTimerRef.current);
        saveSuccessTimerRef.current = null;
      }
      setSaveError('');
      setSaveSuccess(message ?? tCommon('configUpdated'));
      saveSuccessTimerRef.current = setTimeout(() => {
        setSaveSuccess('');
        saveSuccessTimerRef.current = null;
      }, 2500);
    },
    [tCommon]
  );

  const handleSaveBillingCurrency = async () => {
    const raw = billSelectValue;
    if (raw !== 'USD' && raw !== 'CNY') {
      clearSaveSuccess();
      setSaveError(tCommon('billingCurrencyMustBeUsdOrCny'));
      return;
    }
    setSaveError('');
    clearSaveSuccess();
    setBillSaving(true);
    try {
      const response = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: BILLING_CURRENCY_KEY, value: raw }),
      });
      const data = await readApiJson(response);
      if (data.success) {
        flashSaveSuccess(data.message);
        setConfig((prev) => {
          const idx = prev.findIndex((r) => r.key === BILLING_CURRENCY_KEY);
          const desc =
            prev[idx]?.description ??
            'ISO 4217 code for pricing_profile and api_keys budget amounts (per-million-token unit).';
          const nextRow: SystemConfigRow = { key: BILLING_CURRENCY_KEY, value: raw, description: desc };
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = nextRow;
            return copy;
          }
          return [...prev, nextRow];
        });
        setBillSelectValue(raw === 'CNY' ? 'CNY' : 'USD');
      } else {
        clearSaveSuccess();
        setSaveError(data.message || tCommon('saveFailed'));
      }
    } catch {
      clearSaveSuccess();
      setSaveError(tCommon('requestFailed'));
    } finally {
      setBillSaving(false);
    }
  };

  const handleSaveUserChargedCostFactorMode = async () => {
    const raw = userChargedModeValue;
    if (!isUserChargedCostFactorMode(raw)) {
      clearSaveSuccess();
      setSaveError(`USER_CHARGED_COST_FACTOR_MODE must be one of: ${USER_CHARGED_COST_FACTOR_MODES.join(', ')}`);
      return;
    }
    setUserChargedModeSaving(true);
    setSaveError('');
    try {
      const response = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: USER_CHARGED_COST_FACTOR_MODE_KEY, value: raw }),
      });
      const data = await readApiJson(response);
      if (data.success) {
        flashSaveSuccess(data.message);
        setConfig((prev) => {
          const idx = prev.findIndex((r) => r.key === USER_CHARGED_COST_FACTOR_MODE_KEY);
          const desc =
            prev[idx]?.description ??
            'How users.charged_cost_factors combine with the route charged factor: multiply (default) or min.';
          const nextRow: SystemConfigRow = {
            key: USER_CHARGED_COST_FACTOR_MODE_KEY,
            value: raw,
            description: desc,
          };
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = nextRow;
            return copy;
          }
          return [...prev, nextRow];
        });
        setUserChargedModeValue(raw);
      } else {
        clearSaveSuccess();
        setSaveError(data.message || tCommon('saveFailed'));
      }
    } catch {
      clearSaveSuccess();
      setSaveError(tCommon('requestFailed'));
    } finally {
      setUserChargedModeSaving(false);
    }
  };

  const handleSaveRouteStrategy = async (nextValue: string): Promise<boolean> => {
    const raw = nextValue.trim().toLowerCase();
    if (!isRouteStrategyName(raw)) {
      clearSaveSuccess();
      setSaveError(`ROUTE_STRATEGY must be one of: ${ROUTE_STRATEGY_NAMES.join(', ')}`);
      return false;
    }
    setSaveError('');
    clearSaveSuccess();
    setRouteStrategySaving(true);
    try {
      const response = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: ROUTE_STRATEGY_KEY, value: raw }),
      });
      const data = await readApiJson(response);
      if (data.success) {
        flashSaveSuccess(data.message);
        setConfig((prev) => {
          const idx = prev.findIndex((r) => r.key === ROUTE_STRATEGY_KEY);
          const desc =
            prev[idx]?.description ?? 'Global model route strategy when models.route_policy does not override.';
          const nextRow: SystemConfigRow = { key: ROUTE_STRATEGY_KEY, value: raw, description: desc };
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = nextRow;
            return copy;
          }
          return [...prev, nextRow];
        });
        setRouteStrategyValue(raw);
        return true;
      }
      clearSaveSuccess();
      setSaveError(data.message || tCommon('saveFailed'));
      return false;
    } catch {
      clearSaveSuccess();
      setSaveError(tCommon('requestFailed'));
      return false;
    } finally {
      setRouteStrategySaving(false);
    }
  };

  const handleSaveBusinessTimezone = async () => {
    const raw = bizSelectValue === OTHER_TZ ? bizOtherValue.trim() : bizSelectValue;
    if (!raw) {
      clearSaveSuccess();
      setSaveError(tCommon('businessTimezoneCannotBeEmpty'));
      return;
    }
    if (!isValidIanaTimeZone(raw)) {
      clearSaveSuccess();
      setSaveError(t('errors.invalidIanaTimezone'));
      return;
    }
    setSaveError('');
    clearSaveSuccess();
    setBizSaving(true);
    try {
      const response = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: BUSINESS_TIMEZONE_KEY, value: raw }),
      });
      const data = await readApiJson(response);
      if (data.success) {
        flashSaveSuccess(data.message);
        setConfig((prev) => {
          const idx = prev.findIndex((r) => r.key === BUSINESS_TIMEZONE_KEY);
          const desc = prev[idx]?.description ?? 'IANA timezone for day-boundary logic (today stats, analytics)';
          const nextRow: SystemConfigRow = { key: BUSINESS_TIMEZONE_KEY, value: raw, description: desc };
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = nextRow;
            return copy;
          }
          return [...prev, nextRow];
        });
        if ((BUSINESS_TIMEZONE_VALUES as readonly string[]).includes(raw)) {
          setBizSelectValue(raw);
          setBizOtherValue('');
        } else {
          setBizSelectValue(OTHER_TZ);
          setBizOtherValue(raw);
        }
        void refreshBusinessTimezone();
      } else {
        clearSaveSuccess();
        setSaveError(data.message || tCommon('saveFailed'));
      }
    } catch {
      clearSaveSuccess();
      setSaveError(tCommon('requestFailed'));
    } finally {
      setBizSaving(false);
    }
  };

  const handleSaveAlertWebhooks = async () => {
    setSaveError('');
    clearSaveSuccess();
    setAlertWebhooksSaving(true);
    try {
      const wecom = wecomWebhookDraft.trim();
      const feishu = feishuWebhookDraft.trim();
      const results = await Promise.all([
        fetch('/api/admin/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: ALERT_WEBHOOK_WECOM_URL_KEY, value: wecom }),
        }),
        fetch('/api/admin/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: ALERT_WEBHOOK_FEISHU_URL_KEY, value: feishu }),
        }),
      ]);
      let successMessage = tCommon('configUpdated');
      for (const response of results) {
        const data = await readApiJson(response);
        if (!data.success) {
          clearSaveSuccess();
          setSaveError(data.message || tCommon('saveFailed'));
          return;
        }
        if (data.message) {
          successMessage = data.message;
        }
      }
      setConfig((prev) => {
        const next = [...prev];
        const upsert = (key: string, value: string, description: string | null) => {
          const idx = next.findIndex((r) => r.key === key);
          if (idx >= 0) {
            next[idx] = { ...next[idx], value };
          } else {
            next.push({ key, value, description: description ?? null });
          }
        };
        upsert(
          ALERT_WEBHOOK_WECOM_URL_KEY,
          wecom,
          'WeCom group robot webhook URL; Proxy POSTs on api_key_request_logs status=error when non-empty.'
        );
        upsert(
          ALERT_WEBHOOK_FEISHU_URL_KEY,
          feishu,
          'Feishu custom bot webhook URL; Proxy POSTs on api_key_request_logs status=error when non-empty.'
        );
        return next;
      });
      flashSaveSuccess(successMessage);
    } catch {
      clearSaveSuccess();
      setSaveError(tCommon('requestFailed'));
    } finally {
      setAlertWebhooksSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600">{tCommon('loading')}</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5" role="alert">
          <p className="font-medium text-red-800">{t('ux.loadFailed')}</p>
          <p className="mt-1 text-sm text-red-700">{loadError}</p>
          <button
            type="button"
            onClick={() => void fetchConfig()}
            className="mt-4 rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-800"
          >
            {tCommon('retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('ux.subtitle')}</p>
      </div>
      {saveError && (
        <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
          {saveError}
        </div>
      )}
      {saveSuccess && (
        <div className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-700" role="status">
          {saveSuccess}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-2">
        <ConfigCardShell
          id="config-timezone"
          title={t('businessTimezone.title')}
          description={t('ux.timezoneHint')}
          hint={<p>{t('businessTimezone.description')}</p>}
          footer={
            <ConfigSaveActions
              dirty={timezoneDirty}
              saving={bizSaving}
              section={t('businessTimezone.title')}
              saveLabel={t('saveTimezone')}
              onSave={() => void handleSaveBusinessTimezone()}
              onDiscard={() => syncBusinessTimezoneUi(config, setBizSelectValue, setBizOtherValue)}
            />
          }
        >
          <label htmlFor="config-timezone-select" className="mb-1 block text-sm font-medium text-gray-700">
            {t('businessTimezone.timezone')}
          </label>
          <select
            id="config-timezone-select"
            value={bizSelectValue}
            disabled={bizSaving}
            onChange={(e) => {
              setBizSelectValue(e.target.value);
              if (e.target.value !== OTHER_TZ) setBizOtherValue('');
            }}
            className="w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
          >
            {businessTimezoneOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            <option value={OTHER_TZ}>{t('businessTimezone.otherManual')}</option>
          </select>
          {bizSelectValue === OTHER_TZ && (
            <div className="mt-3">
              <label htmlFor="config-timezone-custom" className="mb-1 block text-sm font-medium text-gray-700">
                {t('businessTimezone.ianaIdentifier')}
              </label>
              <input
                id="config-timezone-custom"
                type="text"
                disabled={bizSaving}
                value={bizOtherValue}
                onChange={(e) => setBizOtherValue(e.target.value)}
                placeholder={t('businessTimezone.ianaPlaceholder')}
                className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm"
              />
            </div>
          )}
        </ConfigCardShell>

        <ConfigCardShell
          id="config-currency"
          title={t('billingCurrency.title')}
          description={t('ux.currencyHint')}
          hint={<p>{t('billingCurrency.description')}</p>}
          footer={
            <ConfigSaveActions
              dirty={currencyDirty}
              saving={billSaving}
              section={t('billingCurrency.title')}
              saveLabel={t('saveCurrency')}
              onSave={() => void handleSaveBillingCurrency()}
              onDiscard={() => syncBillingCurrencyUi(config, setBillSelectValue)}
            />
          }
        >
          <label htmlFor="config-currency-select" className="mb-1 block text-sm font-medium text-gray-700">
            {t('billingCurrency.currency')}
          </label>
          <select
            id="config-currency-select"
            value={billSelectValue}
            disabled={billSaving}
            onChange={(e) => setBillSelectValue(e.target.value)}
            className="w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
          >
            {billingCurrencyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </ConfigCardShell>

        <ConfigCardShell
          id="config-routing"
          title={t('routeStrategy.title')}
          description={t('ux.routeHint')}
          hint={<p>{t('routeStrategy.description')}</p>}
        >
          <GlobalRouteStrategySection
            value={routeStrategyValue}
            saving={routeStrategySaving}
            onSave={handleSaveRouteStrategy}
          />
        </ConfigCardShell>

        <ConfigCardShell
          id="config-multipliers"
          title={t('userChargedCostFactorMode.title')}
          description={t('ux.billingModeHint')}
          hint={<p>{t('userChargedCostFactorMode.description')}</p>}
          footer={
            <ConfigSaveActions
              dirty={modeDirty}
              saving={userChargedModeSaving}
              section={t('userChargedCostFactorMode.title')}
              saveLabel={t('saveUserChargedCostFactorMode')}
              onSave={() => void handleSaveUserChargedCostFactorMode()}
              onDiscard={() => syncUserChargedCostFactorModeUi(config, setUserChargedModeValue)}
            />
          }
        >
          <div
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            role="radiogroup"
            aria-label={t('userChargedCostFactorMode.title')}
          >
            {USER_CHARGED_COST_FACTOR_MODES.map((mode) => (
              <div
                key={mode}
                className={`rounded-lg border p-3 ${
                  userChargedModeValue === mode ? 'border-indigo-300 bg-indigo-50/50' : 'border-gray-200 bg-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    id={`config-multiplier-${mode}`}
                    type="radio"
                    name="user-charged-cost-factor-mode"
                    value={mode}
                    checked={userChargedModeValue === mode}
                    disabled={userChargedModeSaving}
                    onChange={() => setUserChargedModeValue(mode)}
                  />
                  <label
                    htmlFor={`config-multiplier-${mode}`}
                    className="flex-1 cursor-pointer text-sm font-medium text-gray-900"
                  >
                    {t(`userChargedCostFactorMode.${mode}Title`)}
                  </label>
                  <InfoHintPopover label={t(`userChargedCostFactorMode.${mode}Title`)} portal openOnHover align="start">
                    <p>{t(`userChargedCostFactorMode.${mode}Help`)}</p>
                  </InfoHintPopover>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-gray-600">{t(`ux.${mode}Summary`)}</p>
              </div>
            ))}
          </div>
        </ConfigCardShell>

        <div className="min-w-0 xl:col-span-2">
          <ConfigCardShell
            id="config-webhooks"
            title={t('errorWebhooks.title')}
            description={t('ux.webhookHint')}
            hint={<p>{t('errorWebhooks.description')}</p>}
            footer={
              <ConfigSaveActions
                dirty={webhooksDirty}
                saving={alertWebhooksSaving}
                section={t('errorWebhooks.title')}
                saveLabel={t('saveErrorWebhooks')}
                onSave={() => void handleSaveAlertWebhooks()}
                onDiscard={() => {
                  setWecomWebhookDraft(savedWecom);
                  setFeishuWebhookDraft(savedFeishu);
                }}
              />
            }
          >
            <div className="grid grid-cols-1 items-start gap-4 sm:gap-6 xl:grid-cols-2">
              <WebhookUrlField
                showLabel={tCommon('show')}
                hideLabel={tCommon('hide')}
                id="alert-webhook-wecom"
                label={t('errorWebhooks.wecomLabel')}
                optionalHint={tCommon('optional')}
                value={wecomWebhookDraft}
                onChange={setWecomWebhookDraft}
                placeholder={t('errorWebhooks.wecomPlaceholder')}
                visible={webhookWecomVisible}
                disabled={alertWebhooksSaving}
                onToggleVisible={() => setWebhookWecomVisible((value) => !value)}
              />
              <WebhookUrlField
                showLabel={tCommon('show')}
                hideLabel={tCommon('hide')}
                id="alert-webhook-feishu"
                label={t('errorWebhooks.feishuLabel')}
                optionalHint={tCommon('optional')}
                value={feishuWebhookDraft}
                onChange={setFeishuWebhookDraft}
                placeholder={t('errorWebhooks.feishuPlaceholder')}
                visible={webhookFeishuVisible}
                disabled={alertWebhooksSaving}
                onToggleVisible={() => setWebhookFeishuVisible((value) => !value)}
              />
            </div>
            <p className="mt-3 text-xs text-gray-500">{t('errorWebhooks.urlsNote')}</p>
          </ConfigCardShell>
        </div>
      </div>
    </div>
  );
}
