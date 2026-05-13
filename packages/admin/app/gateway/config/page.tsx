'use client';

/**
 * `system_config`：`MASTER_KEY`（置顶）、`BUSINESS_TIMEZONE`、`BILLING_CURRENCY` 与 Add 均为卡片，
 * 左栏标题+描述、右栏表单与按钮。敏感值掩码展示。
 */
import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import {
	ClipboardDocumentIcon,
	EyeIcon,
	EyeSlashIcon,
	PlusIcon,
} from '@heroicons/react/24/outline';
import { readApiJson } from '@/lib/api-json';
import type { SystemConfigRow } from '@/lib/types';
import { BILLING_CURRENCY_KEY, BILLING_CURRENCY_OPTIONS } from '@/lib/billing-currency-options';
import {
	BUSINESS_TIMEZONE_KEY,
	BUSINESS_TIMEZONE_OPTIONS,
} from '@/lib/business-timezone-options';
import {
	ALERT_WEBHOOK_FEISHU_URL_KEY,
	ALERT_WEBHOOK_WECOM_URL_KEY,
} from '@octafuse/core/lib/alert-webhook-system-config';

function maskSecret(value: string): string {
  if (!value || value.length < 12) return '***';
  return value.slice(0, 6) + '…' + value.slice(-4);
}

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

function syncBusinessTimezoneUi(rows: SystemConfigRow[], setSelect: (v: string) => void, setOther: (v: string) => void) {
  const row = rows.find((r) => r.key === BUSINESS_TIMEZONE_KEY);
  const v = row?.value?.trim() || 'UTC';
  if (BUSINESS_TIMEZONE_OPTIONS.some((o) => o.value === v)) {
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
	id,
	label,
	optionalHint,
	value,
	onChange,
	placeholder,
	visible,
	onToggleVisible,
}: {
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
					{label} <span className="text-gray-400">{optionalHint}</span>
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
							Hide
						</>
					) : (
						<>
							<EyeIcon className="h-4 w-4" aria-hidden />
							Show
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

/** 左栏标题与说明，右栏控件与操作（大屏横向，小屏纵向堆叠）。 */
function ConfigCardShell({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
        <div className="min-w-0 lg:w-[min(100%,22rem)] xl:w-96 shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <div className="mt-2 text-sm text-gray-500 leading-relaxed">{description}</div>
        </div>
        <div className="min-w-0 flex-1 border-t border-gray-100 pt-6 lg:border-t-0 lg:border-l lg:border-gray-200 lg:pl-8 lg:pt-0">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function GatewayConfigPage() {
  const [config, setConfig] = useState<SystemConfigRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [bizSelectValue, setBizSelectValue] = useState('UTC');
  const [bizOtherValue, setBizOtherValue] = useState('');
  const [bizSaving, setBizSaving] = useState(false);
  const [billSelectValue, setBillSelectValue] = useState('USD');
  const [billSaving, setBillSaving] = useState(false);
  const [masterKeyDraft, setMasterKeyDraft] = useState('');
  const [masterKeyEditing, setMasterKeyEditing] = useState(false);
  const [masterSaving, setMasterSaving] = useState(false);
  const [copyMasterKeyHint, setCopyMasterKeyHint] = useState(false);
  const copyMasterKeyHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [wecomWebhookDraft, setWecomWebhookDraft] = useState('');
  const [feishuWebhookDraft, setFeishuWebhookDraft] = useState('');
  const [alertWebhooksSaving, setAlertWebhooksSaving] = useState(false);
  const [webhookWecomVisible, setWebhookWecomVisible] = useState(true);
  const [webhookFeishuVisible, setWebhookFeishuVisible] = useState(true);

  const masterRow = useMemo(
    () => config.find((r) => r.key === MASTER_KEY_KEY),
    [config]
  );
  const hasMasterKey = Boolean(masterRow?.value?.trim());

  const fetchConfig = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/admin/config');
      const data = await readApiJson<SystemConfigRow[]>(response);
      if (data.success && Array.isArray(data.data)) {
        setConfig(data.data);
        syncBusinessTimezoneUi(data.data, setBizSelectValue, setBizOtherValue);
        syncBillingCurrencyUi(data.data, setBillSelectValue);
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
      if (copyMasterKeyHintTimerRef.current != null) {
        clearTimeout(copyMasterKeyHintTimerRef.current);
      }
    };
  }, []);

  const handleAdd = async () => {
    const k = newKey.trim();
    if (!k) return;
    if (k === BUSINESS_TIMEZONE_KEY) {
      setSaveError(`Use the "Business timezone" section for ${BUSINESS_TIMEZONE_KEY}.`);
      return;
    }
    if (k === BILLING_CURRENCY_KEY) {
      setSaveError(`Use the "Billing currency" section for ${BILLING_CURRENCY_KEY}.`);
      return;
    }
    if (k === MASTER_KEY_KEY) {
      setSaveError(`Use the "Admin API master key" section for ${MASTER_KEY_KEY}.`);
      return;
    }
    if (k === ALERT_WEBHOOK_WECOM_URL_KEY || k === ALERT_WEBHOOK_FEISHU_URL_KEY) {
      setSaveError(
        `Use the "Proxy error webhooks" section for ${ALERT_WEBHOOK_WECOM_URL_KEY} / ${ALERT_WEBHOOK_FEISHU_URL_KEY}.`
      );
      return;
    }
    setSaveError('');
    setIsSaving(true);
    try {
      const response = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: k, value: newValue }),
      });
      const data = await readApiJson(response);
      if (data.success) {
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
        setSaveError(data.message || 'Save failed');
      }
    } catch (error) {
      setSaveError('Request failed');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveBillingCurrency = async () => {
    const raw = billSelectValue;
    if (raw !== 'USD' && raw !== 'CNY') {
      setSaveError('Billing currency must be USD or CNY');
      return;
    }
    setSaveError('');
    setBillSaving(true);
    try {
      const response = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: BILLING_CURRENCY_KEY, value: raw }),
      });
      const data = await readApiJson(response);
      if (data.success) {
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
        setSaveError(data.message || 'Save failed');
      }
    } catch {
      setSaveError('Request failed');
    } finally {
      setBillSaving(false);
    }
  };

  const handleSaveBusinessTimezone = async () => {
    const raw = bizSelectValue === OTHER_TZ ? bizOtherValue.trim() : bizSelectValue;
    if (!raw) {
      setSaveError('Business timezone cannot be empty');
      return;
    }
    if (!isValidIanaTimeZone(raw)) {
      setSaveError('Invalid IANA timezone (e.g. Asia/Shanghai, America/New_York)');
      return;
    }
    setSaveError('');
    setBizSaving(true);
    try {
      const response = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: BUSINESS_TIMEZONE_KEY, value: raw }),
      });
      const data = await readApiJson(response);
      if (data.success) {
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
        if (BUSINESS_TIMEZONE_OPTIONS.some((o) => o.value === raw)) {
          setBizSelectValue(raw);
          setBizOtherValue('');
        } else {
          setBizSelectValue(OTHER_TZ);
          setBizOtherValue(raw);
        }
      } else {
        setSaveError(data.message || 'Save failed');
      }
    } catch {
      setSaveError('Request failed');
    } finally {
      setBizSaving(false);
    }
  };

  const handleSaveAlertWebhooks = async () => {
    setSaveError('');
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
      for (const response of results) {
        const data = await readApiJson(response);
        if (!data.success) {
          setSaveError(data.message || 'Save failed');
          return;
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
    } catch {
      setSaveError('Request failed');
    } finally {
      setAlertWebhooksSaving(false);
    }
  };

  const handleSaveMasterKey = async () => {
    const raw = masterKeyDraft.trim();
    if (!raw) {
      setSaveError('Master key cannot be empty');
      return;
    }
    setSaveError('');
    setMasterSaving(true);
    try {
      const response = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: MASTER_KEY_KEY, value: raw }),
      });
      const data = await readApiJson(response);
      if (data.success) {
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
        setMasterKeyEditing(false);
        setMasterKeyDraft('');
      } else {
        setSaveError(data.message || 'Save failed');
      }
    } catch {
      setSaveError('Request failed');
    } finally {
      setMasterSaving(false);
    }
  };

  const handleCopyMasterKey = async () => {
    const text = masterRow?.value ?? '';
    if (!text.trim()) {
      return;
    }
    if (copyMasterKeyHintTimerRef.current != null) {
      clearTimeout(copyMasterKeyHintTimerRef.current);
      copyMasterKeyHintTimerRef.current = null;
    }
    try {
      await navigator.clipboard.writeText(text);
      setSaveError('');
      setCopyMasterKeyHint(true);
      copyMasterKeyHintTimerRef.current = setTimeout(() => {
        setCopyMasterKeyHint(false);
        copyMasterKeyHintTimerRef.current = null;
      }, 2500);
    } catch {
      setCopyMasterKeyHint(false);
      setSaveError('Could not copy to clipboard (check permissions or HTTPS).');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Gateway Config</h1>
          <p className="text-sm text-gray-500 mt-1">Key-value config shared by Gateway and Admin (no duplicate env vars)</p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setSaveError(''); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          <PlusIcon className="h-5 w-5" />
          Add
        </button>
      </div>

      {saveError && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-md text-sm">{saveError}</div>
      )}

      <ConfigCardShell
        title="Admin API master key"
        description={
          <>
            Bearer secret for <code className="rounded bg-gray-100 px-1 text-xs">Authorization</code> on{' '}
            <code className="rounded bg-gray-100 px-1 text-xs">/api/admin/*</code> (this console and server-side
            callers). Set the same value as <code className="rounded bg-gray-100 px-1 text-xs">GATEWAY_MASTER_KEY</code>{' '}
            on portals (e.g. your-portal) that call the Gateway Admin API.
          </>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          {hasMasterKey && !masterKeyEditing ? (
            <>
              <div className="min-w-0 flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">Current key</label>
                <span className="block text-sm font-mono text-gray-700">{maskSecret(masterRow?.value ?? '')}</span>
              </div>
              <button
                type="button"
                onClick={() => void handleCopyMasterKey()}
                className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50"
                title="Copy full key to clipboard"
              >
                <ClipboardDocumentIcon className="h-4 w-4 shrink-0" />
                Copy key
              </button>
              <button
                type="button"
                onClick={() => {
                  if (copyMasterKeyHintTimerRef.current != null) {
                    clearTimeout(copyMasterKeyHintTimerRef.current);
                    copyMasterKeyHintTimerRef.current = null;
                  }
                  setCopyMasterKeyHint(false);
                  setSaveError('');
                  setMasterKeyEditing(true);
                  setMasterKeyDraft(masterRow?.value ?? '');
                }}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50"
              >
                Change key
              </button>
              {copyMasterKeyHint && (
                <span className="self-center text-sm font-medium text-green-700" role="status">
                  Copied to clipboard
                </span>
              )}
            </>
          ) : (
            <>
              <div className="min-w-[12rem] flex-1 max-w-md">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {hasMasterKey ? 'New master key' : 'Master key'}
                </label>
                <input
                  type="password"
                  value={masterKeyDraft}
                  onChange={(e) => setMasterKeyDraft(e.target.value)}
                  placeholder={hasMasterKey ? 'Enter new key' : 'Enter admin Bearer secret'}
                  autoComplete="new-password"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              {hasMasterKey && masterKeyEditing && (
                <button
                  type="button"
                  onClick={() => {
                    setMasterKeyEditing(false);
                    setMasterKeyDraft('');
                    setSaveError('');
                  }}
                  className="text-sm text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                onClick={handleSaveMasterKey}
                disabled={masterSaving}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {masterSaving ? 'Saving…' : 'Save master key'}
              </button>
            </>
          )}
        </div>
      </ConfigCardShell>

      <ConfigCardShell
        title="Business timezone"
        description={
          <>
            IANA name (e.g. <code className="rounded bg-gray-100 px-1 text-xs">Asia/Shanghai</code>). Controls the
            calendar day for free-tier daily quota and &quot;today&quot; stats on the dashboard. Invalid values fall back
            to UTC on the Gateway.
          </>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Timezone</label>
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
              {BUSINESS_TIMEZONE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              <option value={OTHER_TZ}>Other (manual IANA)…</option>
            </select>
          </div>
          {bizSelectValue === OTHER_TZ && (
            <div className="min-w-[12rem] flex-1 max-w-md">
              <label className="block text-xs font-medium text-gray-600 mb-1">IANA identifier</label>
              <input
                type="text"
                value={bizOtherValue}
                onChange={(e) => setBizOtherValue(e.target.value)}
                placeholder="e.g. Europe/Zurich"
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
            {bizSaving ? 'Saving…' : 'Save timezone'}
          </button>
        </div>
      </ConfigCardShell>

      <ConfigCardShell
        title="Billing currency"
        description={
          <>
            Only <code className="rounded bg-gray-100 px-1 text-xs">USD</code> or{' '}
            <code className="rounded bg-gray-100 px-1 text-xs">CNY</code>. Applies to{' '}
            <code className="rounded bg-gray-100 px-1 text-xs">pricing_profile</code> unit prices and{' '}
            <code className="rounded bg-gray-100 px-1 text-xs">api_keys</code> budget fields (per-million-token
            pricing). Exposed on <code className="rounded bg-gray-100 px-1 text-xs">GET /v1/me</code> as{' '}
            <code className="rounded bg-gray-100 px-1 text-xs">billing_currency</code>.
          </>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Currency</label>
            <select
              value={billSelectValue}
              onChange={(e) => {
                setBillSelectValue(e.target.value);
              }}
              className="min-w-[16rem] rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm"
            >
              {BILLING_CURRENCY_OPTIONS.map((o) => (
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
            {billSaving ? 'Saving…' : 'Save currency'}
          </button>
        </div>
      </ConfigCardShell>

      <ConfigCardShell
        title="Proxy error webhooks"
        description={
          <>
            When the Proxy persists a row with <code className="rounded bg-gray-100 px-1 text-xs">api_key_request_logs.status = error</code>{' '}
            (after billing write succeeds), it optionally POSTs to the configured robot URLs. Leave a field empty to
            disable that channel. Keys:{' '}
            <code className="rounded bg-gray-100 px-1 text-xs">{ALERT_WEBHOOK_WECOM_URL_KEY}</code>,{' '}
            <code className="rounded bg-gray-100 px-1 text-xs">{ALERT_WEBHOOK_FEISHU_URL_KEY}</code>.
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="max-w-3xl text-xs text-gray-500">
            URLs contain webhook secrets; use Hide before screen sharing if needed.
          </p>
          <WebhookUrlField
            id="alert-webhook-wecom"
            label="WeCom robot webhook URL"
            optionalHint="(optional)"
            value={wecomWebhookDraft}
            onChange={setWecomWebhookDraft}
            placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…"
            visible={webhookWecomVisible}
            onToggleVisible={() => setWebhookWecomVisible((v) => !v)}
          />
          <WebhookUrlField
            id="alert-webhook-feishu"
            label="Feishu bot webhook URL"
            optionalHint="(optional)"
            value={feishuWebhookDraft}
            onChange={setFeishuWebhookDraft}
            placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/…"
            visible={webhookFeishuVisible}
            onToggleVisible={() => setWebhookFeishuVisible((v) => !v)}
          />
          <button
            type="button"
            onClick={() => void handleSaveAlertWebhooks()}
            disabled={alertWebhooksSaving}
            className="self-start rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {alertWebhooksSaving ? 'Saving…' : 'Save error webhooks'}
          </button>
        </div>
      </ConfigCardShell>

      {showAdd && (
        <ConfigCardShell
          title="Add config key"
          description={
            <>
              Upsert any other <code className="rounded bg-gray-100 px-1 text-xs">system_config</code> key. Keys reserved
              for the dedicated sections on this page (including{' '}
              <code className="rounded bg-gray-100 px-1 text-xs">{ALERT_WEBHOOK_WECOM_URL_KEY}</code> /{' '}
              <code className="rounded bg-gray-100 px-1 text-xs">{ALERT_WEBHOOK_FEISHU_URL_KEY}</code>) cannot be added
              here.
            </>
          }
        >
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Key</label>
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="e.g. MY_FEATURE_FLAG"
                className="min-w-[12rem] rounded-md border border-gray-300 px-3 py-2 text-sm font-mono shadow-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Value</label>
              <input
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="e.g. 20"
                className="min-w-[12rem] rounded-md border border-gray-300 px-3 py-2 text-sm font-mono shadow-sm"
              />
            </div>
            <button
              type="button"
              onClick={handleAdd}
              disabled={isSaving || !newKey.trim()}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => { setShowAdd(false); setNewKey(''); setNewValue(''); setSaveError(''); }}
              className="text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
          </div>
        </ConfigCardShell>
      )}
    </div>
  );
}
