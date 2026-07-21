'use client';

/**
 * `system_config`：`MASTER_KEY`（置顶）、`BUSINESS_TIMEZONE`、`BILLING_CURRENCY`、
 * 错误 Webhook 与 Add 均为卡片；敏感字段支持 Show/Hide。
 * 产品工具配置见 `/gateway/tools`。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
	EyeIcon,
	EyeSlashIcon,
	PlusIcon,
} from '@heroicons/react/24/outline';
import { ConfigCardShell } from '@/components/ConfigCardShell';
import { readApiJson } from '@/lib/api-json';
import type { SystemConfigRow } from '@/lib/types';
import { BILLING_CURRENCY_KEY, getBillingCurrencyOptions } from '@/lib/billing-currency-options';
import {
	BUSINESS_TIMEZONE_KEY,
	BUSINESS_TIMEZONE_VALUES,
	getBusinessTimezoneOptions,
} from '@/lib/business-timezone-options';
import {
	ALERT_WEBHOOK_FEISHU_URL_KEY,
	ALERT_WEBHOOK_WECOM_URL_KEY,
} from '@octafuse/core/lib/alert-webhook-system-config';
import {
	WEB_SEARCH_ACTIVE_KEY,
	WEB_SEARCH_API_KEY_KEY,
	WEB_SEARCH_CATALOG_KEY,
	WEB_SEARCH_COST_KEY,
	WEB_SEARCH_PROVIDER_KEY,
} from '@/lib/web-search-options';
import {
	WEB_FETCH_ACTIVE_KEY,
	WEB_FETCH_API_KEY_KEY,
	WEB_FETCH_CATALOG_KEY,
	WEB_FETCH_COST_KEY,
	WEB_FETCH_PROVIDER_KEY,
} from '@/lib/web-fetch-options';
import { useTranslations } from 'next-intl';
import { useBusinessTimezoneContext } from '@/components/BusinessTimezoneProvider';

const OTHER_TZ = '__other__';

const MASTER_KEY_KEY = 'MASTER_KEY';

const MASTER_KEY_DEFAULT_DESCRIPTION =
	'Bearer token for Gateway admin API. Set in Admin Config.';

function syncBillingCurrencyUi(rows: SystemConfigRow[], setSelect: (v: string) => void) {
	const row = rows.find((r) => r.key === BILLING_CURRENCY_KEY);
	const v = row?.value?.trim().toUpperCase() || 'USD';
	/** 历史非法或非白名单值在 UI 上归一为 USD，保存时需用户显式选 CNY 再写入。 */
	setSelect(v === 'CNY' ? 'CNY' : 'USD');
}


function syncBusinessTimezoneUi(
	rows: SystemConfigRow[],
	setSelect: (v: string) => void,
	setOther: (v: string) => void,
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

/** Webhook URL：默认明文展示（textarea 换行），可一键隐藏为密码样式以防投屏泄露。 */
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
	onToggleVisible: () => void;
}) {
	return (
		<div>
			<div className="mb-1 flex max-w-3xl items-center justify-between gap-2">
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
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder={placeholder}
					spellCheck={false}
					autoComplete="off"
					rows={3}
					className="w-full max-w-3xl resize-y rounded-md border border-gray-300 px-3 py-2 text-sm font-mono leading-relaxed text-gray-900 shadow-sm break-all"
				/>
			) : (
				<input
					id={id}
					type="password"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder={placeholder}
					autoComplete="off"
					className="w-full max-w-3xl rounded-md border border-gray-300 px-3 py-2 text-sm font-mono shadow-sm"
				/>
			)}
		</div>
	);
}

export default function GatewayConfigPage() {
  const t = useTranslations('config');
  const tBrand = useTranslations('brand');
  const tCommon = useTranslations('common');
  const tOptions = useTranslations('options');
  const { refresh: refreshBusinessTimezone } = useBusinessTimezoneContext();
  const businessTimezoneOptions = getBusinessTimezoneOptions((k) => tOptions(k));
  const billingCurrencyOptions = getBillingCurrencyOptions((k) => tOptions(k));
  const [config, setConfig] = useState<SystemConfigRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [bizSelectValue, setBizSelectValue] = useState('UTC');
  const [bizOtherValue, setBizOtherValue] = useState('');
  const [bizSaving, setBizSaving] = useState(false);
  const [billSelectValue, setBillSelectValue] = useState('USD');
  const [billSaving, setBillSaving] = useState(false);
  const [masterKeyDraft, setMasterKeyDraft] = useState('');
  const [masterKeyVisible, setMasterKeyVisible] = useState(false);
  const [masterSaving, setMasterSaving] = useState(false);
  const saveSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [wecomWebhookDraft, setWecomWebhookDraft] = useState('');
  const [feishuWebhookDraft, setFeishuWebhookDraft] = useState('');
  const [alertWebhooksSaving, setAlertWebhooksSaving] = useState(false);
  const [webhookWecomVisible, setWebhookWecomVisible] = useState(true);
  const [webhookFeishuVisible, setWebhookFeishuVisible] = useState(true);

  const fetchConfig = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/admin/config');
      const data = await readApiJson<SystemConfigRow[]>(response);
      if (data.success && Array.isArray(data.data)) {
        setConfig(data.data);
        syncBusinessTimezoneUi(data.data, setBizSelectValue, setBizOtherValue);
        syncBillingCurrencyUi(data.data, setBillSelectValue);
        const masterRow = data.data.find((r) => r.key === MASTER_KEY_KEY);
        setMasterKeyDraft(masterRow?.value ?? '');
        const wecomRow = data.data.find((r) => r.key === ALERT_WEBHOOK_WECOM_URL_KEY);
        const feishuRow = data.data.find((r) => r.key === ALERT_WEBHOOK_FEISHU_URL_KEY);
        setWecomWebhookDraft(wecomRow?.value ?? '');
        setFeishuWebhookDraft(feishuRow?.value ?? '');
      }
    } catch (error) {
      console.error('Fetch config error:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

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

  const flashSaveSuccess = useCallback((message?: string) => {
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
  }, [tCommon]);

  const handleAdd = async () => {
    const k = newKey.trim();
    if (!k) return;
    if (k === BUSINESS_TIMEZONE_KEY) {
      clearSaveSuccess();
      setSaveError(t('errors.useBusinessTimezoneSection'));
      return;
    }
    if (k === BILLING_CURRENCY_KEY) {
      clearSaveSuccess();
      setSaveError(t('errors.useBillingCurrencySection'));
      return;
    }
    if (k === MASTER_KEY_KEY) {
      clearSaveSuccess();
      setSaveError(t('errors.useMasterKeySection'));
      return;
    }
    if (k === ALERT_WEBHOOK_WECOM_URL_KEY || k === ALERT_WEBHOOK_FEISHU_URL_KEY) {
      clearSaveSuccess();
      setSaveError(t('errors.useWebhooksSection'));
      return;
    }
    if (
      k === WEB_SEARCH_PROVIDER_KEY ||
      k === WEB_SEARCH_API_KEY_KEY ||
      k === WEB_SEARCH_COST_KEY ||
      k === WEB_SEARCH_ACTIVE_KEY ||
      k === WEB_SEARCH_CATALOG_KEY ||
      k === WEB_FETCH_PROVIDER_KEY ||
      k === WEB_FETCH_API_KEY_KEY ||
      k === WEB_FETCH_COST_KEY ||
      k === WEB_FETCH_ACTIVE_KEY ||
      k === WEB_FETCH_CATALOG_KEY
    ) {
      clearSaveSuccess();
      setSaveError(t('errors.useToolsSection'));
      return;
    }
    setSaveError('');
    clearSaveSuccess();
    setIsSaving(true);
    try {
      const response = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: k, value: newValue }),
      });
      const data = await readApiJson(response);
      if (data.success) {
        flashSaveSuccess(data.message);
        setConfig((prev) => {
          const idx = prev.findIndex((r) => r.key === k);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = { ...copy[idx], value: newValue };
            return copy;
          }
          return [...prev, { key: k, value: newValue, description: null }];
        });
        setNewKey('');
        setNewValue('');
        setShowAdd(false);
      } else {
        clearSaveSuccess();
        setSaveError(data.message || tCommon('saveFailed'));
      }
    } catch (error) {
      clearSaveSuccess();
      setSaveError(tCommon('requestFailed'));
    } finally {
      setIsSaving(false);
    }
  };

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
          const desc =
            prev[idx]?.description ??
            'IANA timezone for day-boundary logic (today stats, analytics)';
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

  const handleSaveMasterKey = async () => {
    const raw = masterKeyDraft.trim();
    if (!raw) {
      clearSaveSuccess();
      setSaveError(tCommon('masterKeyCannotBeEmpty'));
      return;
    }
    setSaveError('');
    clearSaveSuccess();
    setMasterSaving(true);
    try {
      const response = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: MASTER_KEY_KEY, value: raw }),
      });
      const data = await readApiJson(response);
      if (data.success) {
        flashSaveSuccess(data.message);
        setConfig((prev) => {
          const idx = prev.findIndex((r) => r.key === MASTER_KEY_KEY);
          const desc = prev[idx]?.description ?? MASTER_KEY_DEFAULT_DESCRIPTION;
          const nextRow: SystemConfigRow = { key: MASTER_KEY_KEY, value: raw, description: desc };
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = nextRow;
            return copy;
          }
          return [...prev, nextRow];
        });
      } else {
        clearSaveSuccess();
        setSaveError(data.message || tCommon('saveFailed'));
      }
    } catch {
      clearSaveSuccess();
      setSaveError(tCommon('requestFailed'));
    } finally {
      setMasterSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600">{tCommon('loading')}</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {t('subtitle', { product: tBrand('product') })}
          </p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setSaveError(''); clearSaveSuccess(); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          <PlusIcon className="h-5 w-5" />
          {t('add')}
        </button>
      </div>

      {saveError && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-md text-sm">{saveError}</div>
      )}

      {saveSuccess && (
        <div className="mb-4 p-3 bg-green-50 text-green-700 rounded-md text-sm" role="status">
          {saveSuccess}
        </div>
      )}

      <ConfigCardShell
        title={t('masterKey.title')}
        description={t('masterKey.description')}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1 max-w-md">
            <div className="mb-1 flex items-center justify-between gap-2">
              <label htmlFor="master-key" className="block text-xs font-medium text-gray-600">
                {t('masterKey.label')}
              </label>
              <button
                type="button"
                onClick={() => setMasterKeyVisible((v) => !v)}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
                aria-pressed={masterKeyVisible}
              >
                {masterKeyVisible ? (
                  <>
                    <EyeSlashIcon className="h-4 w-4" aria-hidden />
                    {tCommon('hide')}
                  </>
                ) : (
                  <>
                    <EyeIcon className="h-4 w-4" aria-hidden />
                    {tCommon('show')}
                  </>
                )}
              </button>
            </div>
            <input
              id="master-key"
              type={masterKeyVisible ? 'text' : 'password'}
              value={masterKeyDraft}
              onChange={(e) => setMasterKeyDraft(e.target.value)}
              placeholder={t('masterKey.placeholder')}
              autoComplete="new-password"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono text-gray-900 shadow-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleSaveMasterKey()}
            disabled={masterSaving}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {masterSaving ? tCommon('saving') : t('saveMasterKey')}
          </button>
        </div>
      </ConfigCardShell>

      <ConfigCardShell
        title={t('businessTimezone.title')}
        description={t('businessTimezone.description')}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('businessTimezone.timezone')}</label>
            <select
              value={bizSelectValue}
              onChange={(e) => {
                setBizSelectValue(e.target.value);
                if (e.target.value !== OTHER_TZ) {
                  setBizOtherValue('');
                }
              }}
              className="min-w-[16rem] rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm"
            >
              {businessTimezoneOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              <option value={OTHER_TZ}>{t('businessTimezone.otherManual')}</option>
            </select>
          </div>
          {bizSelectValue === OTHER_TZ && (
            <div className="min-w-[12rem] flex-1 max-w-md">
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('businessTimezone.ianaIdentifier')}</label>
              <input
                type="text"
                value={bizOtherValue}
                onChange={(e) => setBizOtherValue(e.target.value)}
                placeholder={t('businessTimezone.ianaPlaceholder')}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
              />
            </div>
          )}
          <button
            type="button"
            onClick={handleSaveBusinessTimezone}
            disabled={bizSaving}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {bizSaving ? tCommon('saving') : t('saveTimezone')}
          </button>
        </div>
      </ConfigCardShell>

      <ConfigCardShell
        title={t('billingCurrency.title')}
        description={t('billingCurrency.description')}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('billingCurrency.currency')}</label>
            <select
              value={billSelectValue}
              onChange={(e) => {
                setBillSelectValue(e.target.value);
              }}
              className="min-w-[16rem] rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm"
            >
              {billingCurrencyOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleSaveBillingCurrency}
            disabled={billSaving}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {billSaving ? tCommon('saving') : t('saveCurrency')}
          </button>
        </div>
      </ConfigCardShell>

      <ConfigCardShell
        title={t('errorWebhooks.title')}
        description={t('errorWebhooks.description')}
      >
        <div className="flex flex-col gap-4">
          <p className="max-w-3xl text-xs text-gray-500">
            {t('errorWebhooks.urlsNote')}
          </p>
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
            onToggleVisible={() => setWebhookWecomVisible((v) => !v)}
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
            onToggleVisible={() => setWebhookFeishuVisible((v) => !v)}
          />
          <button
            type="button"
            onClick={() => void handleSaveAlertWebhooks()}
            disabled={alertWebhooksSaving}
            className="self-start rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {alertWebhooksSaving ? tCommon('saving') : t('saveErrorWebhooks')}
          </button>
        </div>
      </ConfigCardShell>

      {showAdd && (
        <ConfigCardShell
          title={t('addKey.title')}
          description={t('addKey.description')}
        >
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('addKey.key')}</label>
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder={t('addKey.keyPlaceholder')}
                className="min-w-[12rem] rounded-md border border-gray-300 px-3 py-2 text-sm font-mono shadow-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('addKey.value')}</label>
              <input
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder={t('addKey.valuePlaceholder')}
                className="min-w-[12rem] rounded-md border border-gray-300 px-3 py-2 text-sm font-mono shadow-sm"
              />
            </div>
            <button
              type="button"
              onClick={handleAdd}
              disabled={isSaving || !newKey.trim()}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {isSaving ? tCommon('saving') : tCommon('save')}
            </button>
            <button
              type="button"
              onClick={() => { setShowAdd(false); setNewKey(''); setNewValue(''); setSaveError(''); clearSaveSuccess(); }}
              className="text-sm text-gray-600 hover:text-gray-800"
            >
              {tCommon('cancel')}
            </button>
          </div>
        </ConfigCardShell>
      )}
    </div>
  );
}
