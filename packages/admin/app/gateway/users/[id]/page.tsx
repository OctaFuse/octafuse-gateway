'use client';

/**
 * 单个网关用户：预算计划、关联密钥、请求日志与用户审计。
 */
import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ClipboardDocumentIcon, MagnifyingGlassIcon, PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { InfoHintPopover } from '@/components/InfoHintPopover';
import { useFeedback } from '@/components/feedback';
import { readApiJson } from '@/lib/api-json';
import { instantToZonedDatetimeLocalInput, zonedDatetimeLocalInputToInstant } from '@/lib/business-timezone-client';
import { parseGatewayDateTime } from '@/lib/datetime';
import { formatGatewayMoneyCode, getGatewayCurrencySymbol } from '@/lib/format-gateway-currency';
import { ModelVendorIcon } from '@/components/model-vendor-icon';
import { getModelVendorLabel, normalizeModelVendorInput } from '@/lib/model-vendor';
import {
  API_KEY_BUDGET_AUDIT_EVENT_TYPES,
  type GatewayApiKeyBudgetAuditLog,
  type GatewayModel,
  type GatewayRequestLog,
} from '@/lib/types';
import { NewApiKeySecretBanner } from '@/lib/new-api-key-secret-banner';
import { normalizeMetadataClient } from '@/lib/normalize-metadata-client';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';
import { AuditChangeDetailModal, AuditLogSharedCells } from '@/components/AuditLogSharedCells';
import { summarizeMetadata } from '@/lib/summarize-metadata';
import { compareRouteGroupsForDisplay, normalizeRouteGroup, routeGroupBadgeClass } from '@/lib/route-group-ui';
import { pickChangedUserFields } from '../user-detail-form';
import { UserFactorEditor } from '../user-factor-editor';

/** 用户详情近期审计与全站页默认一致：不含用量扣费 */
const USER_DETAIL_AUDIT_EVENT_TYPES = API_KEY_BUDGET_AUDIT_EVENT_TYPES.filter((type) => type !== 'usage_charge');

/** `*` 表示该模型全部分组；具体值为 route group。 */
const ALL_ROUTE_GROUPS = '*';

type ChargedCostFactorValue = number | Record<string, number>;

type ChargedCostFactorRow = { modelId: string; routeGroup: string; factor: string };

type CatalogModelOption = Pick<GatewayModel, 'id' | 'display_name' | 'vendor'>;

function catalogModelLabel(model: CatalogModelOption | undefined, modelId: string): string {
  const name = model?.display_name?.trim();
  return name || modelId;
}

type UserDetail = {
  id: string;
  email: string;
  external_system: string | null;
  external_user_id: string | null;
  budget_max: number | null;
  budget_base: number;
  budget_spent: number;
  budget_period: string;
  budget_reset_at: string | null;
  wallet_granted?: number;
  wallet_spent?: number;
  wallet_balance?: number;
  status: string;
  metadata: Record<string, unknown> | null;
  charged_cost_factors?: Record<string, ChargedCostFactorValue> | null;
  rate_limit?: { rpm?: number } | null;
  created_at: string;
  updated_at: string;
};

function factorsToRows(factors: Record<string, ChargedCostFactorValue> | null | undefined): ChargedCostFactorRow[] {
  if (!factors) return [];
  const rows: ChargedCostFactorRow[] = [];
  for (const [modelId, value] of Object.entries(factors)) {
    if (typeof value === 'number') {
      rows.push({ modelId, routeGroup: ALL_ROUTE_GROUPS, factor: String(value) });
      continue;
    }
    const groups = Object.entries(value).sort(([a], [b]) => {
      if (a === ALL_ROUTE_GROUPS) return -1;
      if (b === ALL_ROUTE_GROUPS) return 1;
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    });
    for (const [routeGroup, factor] of groups) {
      if (typeof factor !== 'number') continue;
      rows.push({ modelId, routeGroup, factor: String(factor) });
    }
  }
  return rows;
}

function rowsToFactors(
  rows: ChargedCostFactorRow[]
):
  | { ok: true; value: Record<string, ChargedCostFactorValue> | null }
  | { ok: false; code: 'modelRequired' | 'valueInvalid' | 'duplicate' } {
  const byModel = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const modelId = row.modelId.trim();
    const factorRaw = row.factor.trim();
    if (!modelId && !factorRaw) continue;
    if (!modelId) return { ok: false, code: 'modelRequired' };
    const n = Number(factorRaw);
    if (!Number.isFinite(n) || n < 0) return { ok: false, code: 'valueInvalid' };
    const routeGroup =
      row.routeGroup.trim() === ALL_ROUTE_GROUPS || row.routeGroup.trim() === ''
        ? ALL_ROUTE_GROUPS
        : row.routeGroup.trim().toLowerCase();
    const groups = byModel.get(modelId) ?? new Map<string, number>();
    if (groups.has(routeGroup)) return { ok: false, code: 'duplicate' };
    groups.set(routeGroup, n);
    byModel.set(modelId, groups);
  }
  const out: Record<string, ChargedCostFactorValue> = {};
  for (const [modelId, groups] of byModel) {
    if (groups.size === 1 && groups.has(ALL_ROUTE_GROUPS)) {
      out[modelId] = groups.get(ALL_ROUTE_GROUPS)!;
      continue;
    }
    out[modelId] = Object.fromEntries(groups);
  }
  return { ok: true, value: Object.keys(out).length > 0 ? out : null };
}

type KeyRow = {
  id: string;
  key: string;
  user_id: string;
  name: string | null;
  status: string;
  metadata: string | null;
  last_used_at: string | null;
  rate_limit?: { rpm?: number } | null;
  created_at: string;
  updated_at: string;
};

function formatBudgetResetInput(raw: string | null | undefined, timeZone: string): string {
  const date = parseGatewayDateTime(raw);
  if (!date) return '';
  return instantToZonedDatetimeLocalInput(date, timeZone, true);
}

function ReadonlyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="mt-0.5 text-sm text-gray-900 min-w-0">{children}</div>
    </div>
  );
}

function BillingFieldLabel({
  htmlFor,
  label,
  hint,
  optionalLabel,
}: {
  htmlFor: string;
  label: string;
  hint: string;
  optionalLabel?: string;
}) {
  return (
    <div className="mb-1 flex flex-wrap items-center gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-gray-700">
        {label}
        {optionalLabel && <span className="ml-1 text-xs font-normal text-gray-400">{optionalLabel}</span>}
      </label>
      <InfoHintPopover label={label} portal openOnHover align="start">
        <p>{hint}</p>
      </InfoHintPopover>
    </div>
  );
}

function maskKey(key: string) {
  if (!key || key.length < 10) return key;
  return `${key.substring(0, 7)}…${key.substring(key.length - 4)}`;
}

function keyRpm(key: { rate_limit?: { rpm?: number } | null }): number | null {
  return key.rate_limit?.rpm ?? null;
}

const USER_DETAIL_RECENT_LIMIT = 5;

function formatLogProvider(log: GatewayRequestLog): string {
  const pname = log.provider_name?.trim();
  const pid = log.provider_id?.trim();
  return pname || pid || '—';
}

export default function GatewayUserDetailPage() {
  const t = useTranslations('users');
  const tCommon = useTranslations('common');
  const tOptions = useTranslations('options');
  const tAudit = useTranslations('auditLogs');
  const { notify, confirm } = useFeedback();
  const params = useParams();
  const userIdRaw = typeof params.id === 'string' ? params.id : '';
  const userId = decodeURIComponent(userIdRaw);

  const [user, setUser] = useState<UserDetail | null>(null);
  const [loadError, setLoadError] = useState('');
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [logs, setLogs] = useState<GatewayRequestLog[]>([]);
  const [audits, setAudits] = useState<GatewayApiKeyBudgetAuditLog[]>([]);
  const [detailLog, setDetailLog] = useState<GatewayApiKeyBudgetAuditLog | null>(null);
  const [planError, setPlanError] = useState('');
  const [planSuccess, setPlanSuccess] = useState('');
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [activeSection, setActiveSection] = useState<'overview' | 'billing' | 'keys' | 'activity'>('overview');
  const planSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [catalogModels, setCatalogModels] = useState<CatalogModelOption[]>([]);
  const [routeGroupsByModel, setRouteGroupsByModel] = useState<Map<string, string[]>>(new Map());
  const [routeGroupsLoaded, setRouteGroupsLoaded] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelPickerSearch, setModelPickerSearch] = useState('');
  const [planForm, setPlanForm] = useState({
    email: '',
    status: 'active',
    budget_max: '',
    budget_base: '',
    budget_spent: '',
    budget_period: 'none',
    budget_reset_at: '',
    wallet_granted: '',
    wallet_spent: '',
    metadata: '',
    chargedCostFactorRows: [] as ChargedCostFactorRow[],
    external_system: '',
    external_user_id: '',
    rateLimitRpm: '',
  });
  const savedFormRef = useRef<typeof planForm | null>(null);
  const hasChanges = savedFormRef.current != null && JSON.stringify(planForm) !== JSON.stringify(savedFormRef.current);
  const overviewFields = ['email', 'status', 'rateLimitRpm', 'metadata', 'external_system', 'external_user_id'] as const;
  const overviewHasChanges = savedFormRef.current != null && overviewFields.some((field) => planForm[field] !== savedFormRef.current?.[field]);
  const billingHasChanges = savedFormRef.current != null && Object.keys(planForm).some((field) => {
    const key = field as keyof typeof planForm;
    return !overviewFields.some((overviewKey) => overviewKey === key) && JSON.stringify(planForm[key]) !== JSON.stringify(savedFormRef.current?.[key]);
  });

  useEffect(() => {
    if (!hasChanges) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeave);
    return () => window.removeEventListener('beforeunload', warnBeforeLeave);
  }, [hasChanges]);

  const [showNewKey, setShowNewKey] = useState(false);
  const [freshApiKey, setFreshApiKey] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyMeta, setNewKeyMeta] = useState('');
  const [keyError, setKeyError] = useState('');
  const [keysInlineError, setKeysInlineError] = useState('');
  const [keyStatusTogglingId, setKeyStatusTogglingId] = useState<string | null>(null);
  const [metaViewKey, setMetaViewKey] = useState<KeyRow | null>(null);
  const [isKeySaving, setIsKeySaving] = useState(false);
  const { currency: billingCurrency } = useBillingCurrency();
  const { formatDateTime, businessTimezone } = useGatewayDateTime();
  const businessTimezoneRef = useRef(businessTimezone);
  businessTimezoneRef.current = businessTimezone;
  const budgetResetDirtyRef = useRef(false);
  const billingCurrencySym = getGatewayCurrencySymbol(billingCurrency);

  const loadUser = useCallback(async () => {
    if (!userId) return;
    setLoadError('');
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`);
      const data = await readApiJson<UserDetail>(res);
      if (!data.success || !data.data) {
        setLoadError(data.message || 'Failed to load user');
        setUser(null);
        return;
      }
      const u = data.data;
      budgetResetDirtyRef.current = false;
      setUser(u);
      const nextForm = {
        email: u.email ?? '',
        status: u.status,
        budget_max: u.budget_max != null ? String(u.budget_max) : '',
        budget_base: String(u.budget_base ?? 0),
        budget_spent: String(u.budget_spent ?? 0),
        budget_period: u.budget_period || 'none',
        budget_reset_at: formatBudgetResetInput(u.budget_reset_at, businessTimezoneRef.current),
        wallet_granted: String(u.wallet_granted ?? 0),
        wallet_spent: String(u.wallet_spent ?? 0),
        metadata: u.metadata ? JSON.stringify(u.metadata, null, 2) : '',
        chargedCostFactorRows: factorsToRows(u.charged_cost_factors),
        external_system: u.external_system ?? '',
        external_user_id: u.external_user_id ?? '',
        rateLimitRpm: u.rate_limit?.rpm == null ? '' : String(u.rate_limit.rpm),
      };
      savedFormRef.current = nextForm;
      setPlanForm(nextForm);
    } catch (e) {
      console.error(e);
      setLoadError('Failed to load user');
    }
  }, [userId]);

  useEffect(() => {
    if (!user || budgetResetDirtyRef.current) return;
    const resetAt = formatBudgetResetInput(user.budget_reset_at, businessTimezone);
    if (savedFormRef.current) savedFormRef.current = { ...savedFormRef.current, budget_reset_at: resetAt };
    setPlanForm((current) => ({ ...current, budget_reset_at: resetAt }));
  }, [user, businessTimezone]);

  const loadKeys = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/keys`);
      const data = await readApiJson<KeyRow[]>(res);
      if (data.success && data.data) setKeys(data.data);
    } catch (e) {
      console.error(e);
    }
  }, [userId]);

  const loadLogs = useCallback(async () => {
    if (!userId) return;
    try {
      const q = new URLSearchParams({ page: '1', page_size: String(USER_DETAIL_RECENT_LIMIT) });
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/logs?${q}`);
      const data = await readApiJson<GatewayRequestLog[]>(res);
      if (data.success) {
        setLogs(data.data ?? []);
      }
    } catch (e) {
      console.error(e);
    }
  }, [userId]);

  const loadAudits = useCallback(async () => {
    if (!userId) return;
    try {
      const q = new URLSearchParams({
        page: '1',
        page_size: String(USER_DETAIL_RECENT_LIMIT),
        user_id: userId,
      });
      for (const eventType of USER_DETAIL_AUDIT_EVENT_TYPES) {
        q.append('event_type', eventType);
      }
      const res = await fetch(`/api/admin/budget-audit-logs?${q}`);
      const data = await readApiJson<GatewayApiKeyBudgetAuditLog[]>(res);
      if (data.success) {
        setAudits(data.data ?? []);
      }
    } catch (e) {
      console.error(e);
    }
  }, [userId]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    loadAudits();
  }, [loadAudits]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/models');
        const data = await readApiJson<CatalogModelOption[]>(res);
        if (!cancelled && data.success && data.data) {
          setCatalogModels(
            [...data.data].sort((a, b) => {
              const vendor = (a.vendor || '').localeCompare(b.vendor || '');
              if (vendor !== 0) return vendor;
              return catalogModelLabel(a, a.id).localeCompare(catalogModelLabel(b, b.id));
            })
          );
        }
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/routes');
        const data = await readApiJson<Array<{ model_id: string; route_group?: string | null }>>(res);
        if (!cancelled && data.success && data.data) {
          const grouped = new Map<string, Set<string>>();
          for (const route of data.data) {
            const modelId = route.model_id?.trim();
            if (!modelId) continue;
            const group = normalizeRouteGroup(route.route_group).toLowerCase();
            const set = grouped.get(modelId) ?? new Set<string>();
            set.add(group);
            grouped.set(modelId, set);
          }
          const next = new Map<string, string[]>();
          for (const [modelId, groups] of grouped) {
            next.set(modelId, [...groups].sort(compareRouteGroupsForDisplay));
          }
          setRouteGroupsByModel(next);
        }
        if (!cancelled) setRouteGroupsLoaded(true);
      } catch (e) {
        console.error(e);
        if (!cancelled) setRouteGroupsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const catalogById = useMemo(() => {
    const map = new Map<string, CatalogModelOption>();
    for (const model of catalogModels) map.set(model.id, model);
    return map;
  }, [catalogModels]);

  const selectedFactorModelIds = useMemo(
    () => new Set(planForm.chargedCostFactorRows.map((row) => row.modelId)),
    [planForm.chargedCostFactorRows]
  );

  const walletPreviewBalance = useMemo(() => {
    const granted = Number(planForm.wallet_granted);
    const spent = Number(planForm.wallet_spent);
    const g = Number.isFinite(granted) ? granted : 0;
    const s = Number.isFinite(spent) ? spent : 0;
    return g - s;
  }, [planForm.wallet_granted, planForm.wallet_spent]);

  const budgetPreviewMax = planForm.budget_max.trim() === '' ? null : Number(planForm.budget_max);
  const budgetPreviewSpent = Number(planForm.budget_spent) || 0;
  const budgetPreviewRemaining = budgetPreviewMax == null ? null : Math.max(0, budgetPreviewMax - budgetPreviewSpent);

  const pickerModelsByVendor = useMemo(() => {
    const q = modelPickerSearch.trim().toLowerCase();
    const filtered = catalogModels.filter((model) => {
      if (!q) return true;
      const label = catalogModelLabel(model, model.id).toLowerCase();
      const vendor = (model.vendor || '').toLowerCase();
      const vendorLabel = getModelVendorLabel(model.vendor).toLowerCase();
      return (
        model.id.toLowerCase().includes(q) ||
        label.includes(q) ||
        vendor.includes(q) ||
        vendorLabel.includes(q)
      );
    });
    const groups = new Map<string, CatalogModelOption[]>();
    for (const model of filtered) {
      const key = normalizeModelVendorInput(model.vendor);
      const list = groups.get(key) ?? [];
      list.push(model);
      groups.set(key, list);
    }
    for (const list of groups.values()) {
      list.sort((a, b) =>
        catalogModelLabel(a, a.id).localeCompare(catalogModelLabel(b, b.id), undefined, {
          sensitivity: 'base',
        })
      );
    }
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === 'other') return 1;
      if (b === 'other') return -1;
      return getModelVendorLabel(a).localeCompare(getModelVendorLabel(b), undefined, {
        sensitivity: 'base',
      });
    });
  }, [catalogModels, modelPickerSearch]);

  const flashMessage = (
    setter: (value: string) => void,
    timerRef: { current: ReturnType<typeof setTimeout> | null },
    message: string
  ) => {
    setter(message);
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setter('');
      timerRef.current = null;
    }, 3000);
  };

  useEffect(() => {
    const timerRef = planSuccessTimerRef;
    return () => {
      if (timerRef.current != null) clearTimeout(timerRef.current);
    };
  }, []);

  const factorCards = useMemo(() => {
    const order: string[] = [];
    const grouped = new Map<string, { row: ChargedCostFactorRow; index: number }[]>();
    planForm.chargedCostFactorRows.forEach((row, index) => {
      const list = grouped.get(row.modelId);
      if (list) list.push({ row, index });
      else {
        order.push(row.modelId);
        grouped.set(row.modelId, [{ row, index }]);
      }
    });
    return order.map((modelId) => ({
      modelId,
      rows: (grouped.get(modelId) ?? []).slice().sort((a, b) => {
        if (a.row.routeGroup === ALL_ROUTE_GROUPS) return -1;
        if (b.row.routeGroup === ALL_ROUTE_GROUPS) return 1;
        return compareRouteGroupsForDisplay(a.row.routeGroup, b.row.routeGroup);
      }),
    }));
  }, [planForm.chargedCostFactorRows]);

  const factorJsonResult = rowsToFactors(planForm.chargedCostFactorRows);
  const factorJsonPreview = {
    json: factorJsonResult.ok ? JSON.stringify(factorJsonResult.value, null, 2) : null,
    error: factorJsonResult.ok
      ? null
      : t({
          modelRequired: 'errors.chargedCostFactorModelRequired',
          valueInvalid: 'errors.chargedCostFactorValueInvalid',
          duplicate: 'errors.chargedCostFactorDuplicate',
        }[factorJsonResult.code]),
    dirty: savedFormRef.current != null &&
      JSON.stringify(planForm.chargedCostFactorRows) !== JSON.stringify(savedFormRef.current.chargedCostFactorRows),
  };

  const updateChargedCostFactorRow = (index: number, patch: Partial<ChargedCostFactorRow>) => {
    setPlanForm((prev) => {
      const next = [...prev.chargedCostFactorRows];
      const current = next[index];
      if (!current) return prev;
      next[index] = { ...current, ...patch };
      return { ...prev, chargedCostFactorRows: next };
    });
  };

  const addChargedCostFactorModel = (modelId: string) => {
    if (!modelId || selectedFactorModelIds.has(modelId)) return;
    setPlanForm((prev) => ({
      ...prev,
      chargedCostFactorRows: [
        ...prev.chargedCostFactorRows,
        { modelId, routeGroup: ALL_ROUTE_GROUPS, factor: '1' },
      ],
    }));
    setPlanError('');
  };

  const addChargedCostFactorGroup = (modelId: string, routeGroup: string) => {
    if (!modelId || !routeGroup) return;
    setPlanForm((prev) => {
      if (prev.chargedCostFactorRows.some((row) => row.modelId === modelId && row.routeGroup === routeGroup)) {
        return prev;
      }
      return {
        ...prev,
        chargedCostFactorRows: [
          ...prev.chargedCostFactorRows,
          {
            modelId,
            routeGroup,
            factor:
              prev.chargedCostFactorRows.find(
                (row) => row.modelId === modelId && row.routeGroup === ALL_ROUTE_GROUPS,
              )?.factor ?? '1',
          },
        ],
      };
    });
    setPlanError('');
  };

  const savePlan = async () => {
    if (!savedFormRef.current || !hasChanges || isSavingPlan) return;
    setPlanError('');
    setPlanSuccess('');
    setIsSavingPlan(true);
    try {
      const meta = normalizeMetadataClient(planForm.metadata);
      if (!meta.ok) {
        setActiveSection('overview');
        setPlanError(meta.message);
        setIsSavingPlan(false);
        return;
      }
      const email = planForm.email.trim();
      if (!email) {
        setActiveSection('overview');
        setPlanError(t('detailUx.emailRequired'));
        setIsSavingPlan(false);
        return;
      }
      const extS = planForm.external_system.trim();
      const extU = planForm.external_user_id.trim();
      if ((extS && !extU) || (!extS && extU)) {
        setActiveSection('overview');
        setPlanError(t('detailUx.externalIdentityRequired'));
        setIsSavingPlan(false);
        return;
      }
      const rpmRaw = planForm.rateLimitRpm.trim();
      const rpmParsed = rpmRaw === '' ? null : Number(rpmRaw);
      if (
        rpmRaw !== '' &&
        (rpmParsed == null || !Number.isFinite(rpmParsed) || rpmParsed < 0 || !Number.isInteger(rpmParsed))
      ) {
        setActiveSection('overview');
        setPlanError(t('help.rateLimitRpmInvalid'));
        setIsSavingPlan(false);
        return;
      }
      let budgetResetAt: string | null = null;
      if (planForm.budget_reset_at) {
        const instant = zonedDatetimeLocalInputToInstant(planForm.budget_reset_at, businessTimezone);
        if (!instant) {
          setActiveSection('billing');
          setPlanError(t('help.budgetResetAtInvalid'));
          setIsSavingPlan(false);
          return;
        }
        budgetResetAt = instant.toISOString();
      }
      const factors = rowsToFactors(planForm.chargedCostFactorRows);
      if (!factors.ok) {
        const factorErrors = {
          modelRequired: t('errors.chargedCostFactorModelRequired'),
          valueInvalid: t('errors.chargedCostFactorValueInvalid'),
          duplicate: t('errors.chargedCostFactorDuplicate'),
        };
        setActiveSection('billing');
        setPlanError(factorErrors[factors.code]);
        return;
      }
      const payload: Record<string, unknown> = {
        email,
        status: planForm.status,
        budget_max: planForm.budget_max.trim() === '' ? null : parseFloat(planForm.budget_max),
        budget_base: planForm.budget_base.trim() === '' ? null : parseFloat(planForm.budget_base),
        budget_spent: parseFloat(planForm.budget_spent) || 0,
        budget_period: planForm.budget_period,
        budget_reset_at: budgetResetAt,
        wallet_granted: parseFloat(planForm.wallet_granted) || 0,
        wallet_spent: parseFloat(planForm.wallet_spent) || 0,
        rate_limit: rpmParsed == null ? null : { rpm: rpmParsed },
        external_system: extS || null,
        external_user_id: extU || null,
        charged_cost_factors: factors.value,
        reason: 'gwui:user-plan',
      };
      if (meta.value != null) {
        payload.metadata_replace = meta.value;
      }

      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pickChangedUserFields(payload, planForm, savedFormRef.current)),
      });
      const data = await readApiJson(res);
      if (data.success) {
        await loadUser();
        void loadAudits();
        flashMessage(setPlanSuccess, planSuccessTimerRef, t('saveSuccess'));
      } else {
        setPlanError(data.message || t('errors.updateFailed'));
      }
    } catch (e) {
      console.error(e);
      setPlanError(t('errors.updateFailed'));
    } finally {
      setIsSavingPlan(false);
    }
  };

  const deleteUser = async () => {
    const ok = await confirm({
      title: tCommon('delete'),
      message: t('confirm.deleteUser'),
      confirmLabel: tCommon('delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
      const data = await readApiJson(res);
      if (data.success) {
        window.location.href = '/gateway/users';
      } else {
        notify('error', data.message || t('errors.deleteFailed'));
      }
    } catch (e) {
      console.error(e);
      notify('error', t('errors.deleteFailed'));
    }
  };

  const createKey = async () => {
    setKeyError('');
    setIsKeySaving(true);
    try {
      let metadata: string | null = null;
      if (newKeyMeta.trim() !== '') {
        const m = normalizeMetadataClient(newKeyMeta);
        if (!m.ok) {
          setKeyError(m.message);
          setIsKeySaving(false);
          return;
        }
        metadata = m.value;
      }
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newKeyName.trim() || null,
          metadata,
          reason: 'gwui:user-detail',
        }),
      });
      const data = await readApiJson<{ key?: string }>(res);
      if (data.success) {
        setShowNewKey(false);
        setNewKeyName('');
        setNewKeyMeta('');
        setKeysInlineError('');
        await loadKeys();
        if (data.data?.key) {
          setFreshApiKey(data.data.key);
        }
      } else {
        setKeyError(data.message || t('errors.createFailed'));
      }
    } catch (e) {
      console.error(e);
      setKeyError(t('errors.createFailed'));
    } finally {
      setIsKeySaving(false);
    }
  };

  const toggleKeyStatus = async (k: KeyRow) => {
    const nextStatus = k.status === 'active' ? 'revoked' : 'active';
    setKeysInlineError('');
    setKeyStatusTogglingId(k.id);
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/keys/${encodeURIComponent(k.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: nextStatus,
            reason: `gwui:st:${nextStatus}`,
          }),
        }
      );
      const data = await readApiJson(res);
      if (data.success) {
        await loadKeys();
      } else {
        setKeysInlineError(data.message || t('errors.updateFailed'));
      }
    } catch (e) {
      console.error(e);
      setKeysInlineError(t('errors.updateFailed'));
    } finally {
      setKeyStatusTogglingId(null);
    }
  };

  const deleteKeyHard = async (keyId: string) => {
    const ok = await confirm({
      title: tCommon('delete'),
      message: t('confirm.deleteKey'),
      confirmLabel: tCommon('delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/keys/${encodeURIComponent(keyId)}`,
        { method: 'DELETE' }
      );
      const data = await readApiJson(res);
      if (data.success) loadKeys();
      else notify('error', data.message || tCommon('failed'));
    } catch (e) {
      console.error(e);
      notify('error', tCommon('failed'));
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  if (!userId) {
    return <div className="p-8 text-gray-600">{t('invalidUserId')}</div>;
  }

  if (loadError) {
    return (
      <div className="w-full min-w-0 p-4 sm:p-6 lg:p-8">
        <Link href="/gateway/users" className="text-sm text-blue-600 hover:underline">{t('backUsers')}</Link>
        <p className="mt-4 text-red-600">{loadError}</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="w-full min-w-0 p-4 sm:p-6 lg:p-8">
        <Link href="/gateway/users" className="text-sm text-blue-600 hover:underline">{t('backUsers')}</Link>
        <div className="mt-8 text-gray-600">{tCommon('loadingEllipsis')}</div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <Link href="/gateway/users" className="text-sm text-blue-600 hover:underline">
          {t('backUsers')}
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 break-all text-2xl font-bold text-gray-900">{user.email}</h1>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              user.status === 'active' ? 'bg-green-50 text-green-700 ring-1 ring-green-200' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {user.status === 'active' ? tOptions('userStatus.active') : tOptions('userStatus.disabled')}
          </span>
        </div>
        <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-gray-500">
          <span className="break-all font-mono">{user.id}</span>
          <button
            type="button"
            onClick={() => copy(user.id)}
            aria-label={t('detailUx.copyUserId')}
            className="shrink-0 rounded p-1 hover:bg-gray-100"
          >
            <ClipboardDocumentIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div
        role="tablist"
        aria-label={t('detailTitle')}
        className="mb-6 flex gap-1 overflow-x-auto border-b border-gray-200"
      >
        {(['overview', 'billing', 'keys', 'activity'] as const).map((section, index, sections) => (
          <button
            key={section}
            id={`user-tab-${section}`}
            role="tab"
            type="button"
            aria-selected={activeSection === section}
            aria-controls={`user-panel-${section}`}
            tabIndex={activeSection === section ? 0 : -1}
            onClick={() => setActiveSection(section)}
            onKeyDown={(event) => {
              const nextIndex =
                event.key === 'ArrowRight'
                  ? (index + 1) % sections.length
                  : event.key === 'ArrowLeft'
                  ? (index + sections.length - 1) % sections.length
                  : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                  ? sections.length - 1
                  : null;
              if (nextIndex == null) return;
              event.preventDefault();
              setActiveSection(sections[nextIndex]);
              document.getElementById(`user-tab-${sections[nextIndex]}`)?.focus();
            }}
            className={`shrink-0 border-b-2 px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
              activeSection === section
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            {section === 'keys' ? t('apiKeys') : t(`detailUx.${section}`)}
            {((section === 'overview' && overviewHasChanges) || (section === 'billing' && billingHasChanges)) && (
              <span
                aria-label={t('detailUx.unsaved')}
                className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
              />
            )}
          </button>
        ))}
      </div>

      {activeSection !== 'billing' && (
        <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[
            {
              label: t('fields.walletBalance'),
              value: formatGatewayMoneyCode(
                user.wallet_balance ?? (user.wallet_granted ?? 0) - (user.wallet_spent ?? 0),
                billingCurrency,
                2
              ),
              hint: t('detailUx.walletHint'),
              section: 'billing' as const,
            },
            {
              label: t('detailUx.budgetRemaining'),
              value:
                user.budget_max == null
                  ? tCommon('noLimit')
                  : formatGatewayMoneyCode(Math.max(0, user.budget_max - user.budget_spent), billingCurrency, 2),
              hint: t('detailUx.budgetSpent', { amount: formatGatewayMoneyCode(user.budget_spent, billingCurrency, 2) }),
              section: 'billing' as const,
            },
            {
              label: t('detailUx.activeKeys'),
              value: String(keys.filter((key) => key.status === 'active').length),
              hint: t('detailUx.totalKeys', { count: keys.length }),
              section: 'keys' as const,
            },
            {
              label: t('table.rateLimit'),
              value:
                user.rate_limit?.rpm == null
                  ? tCommon('noLimit')
                  : t('table.rateLimitRpmValue', { rpm: user.rate_limit.rpm }),
              hint: t('detailUx.rateLimitHint'),
              section: 'overview' as const,
            },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => setActiveSection(item.section)}
              className="flex min-w-0 flex-col items-start rounded-xl border border-gray-200 bg-white p-3 sm:p-4 text-left transition-colors hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <span className="block text-xs font-medium text-gray-500">{item.label}</span>
              <span className="mt-2 block break-words text-xl sm:text-2xl font-semibold tabular-nums text-gray-900">
                {item.value}
              </span>
              <span className="mt-1 block text-xs text-gray-500">{item.hint}</span>
            </button>
          ))}
        </div>
      )}

      {planError && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {planError}
        </div>
      )}
      {planSuccess && (
        <div role="status" className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {planSuccess}
        </div>
      )}
      <fieldset disabled={isSavingPlan} className="min-w-0">
        <section
          id="user-panel-overview"
          role="tabpanel"
          aria-labelledby="user-tab-overview"
          hidden={activeSection !== 'overview'}
          tabIndex={0}
        >
          <div className="grid grid-cols-1 items-start gap-4 sm:gap-6 xl:grid-cols-2">
            <div className="min-w-0 space-y-4 sm:space-y-6">
              <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6 space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{t('userDetail')}</h2>
                  <p className="mt-1 text-sm text-gray-500">{t('detailUx.overviewHint')}</p>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="user-email" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('fields.email')}{' '}
                      <span aria-hidden="true" className="ml-0.5 text-red-500">
                        *
                      </span>
                    </label>
                    <input
                      id="user-email"
                      type="email"
                      required
                      aria-required="true"
                      autoComplete="email"
                      value={planForm.email}
                      onChange={(e) => setPlanForm({ ...planForm, email: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      placeholder="user@example.com"
                    />
                  </div>
                  <div>
                    <label htmlFor="user-status" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('fields.status')}
                    </label>
                    <select
                      id="user-status"
                      value={planForm.status}
                      onChange={(e) => setPlanForm({ ...planForm, status: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    >
                      <option value="active">{tOptions('userStatus.active')}</option>
                      <option value="disabled">{tOptions('userStatus.disabled')}</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="user-rateLimitRpm" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('fields.rateLimitRpm')}{' '}
                      <span className="ml-1 text-xs font-normal text-gray-400">{tCommon('optional')}</span>
                    </label>
                    <input
                      id="user-rateLimitRpm"
                      type="number"
                      min="0"
                      step="1"
                      value={planForm.rateLimitRpm}
                      onChange={(e) => setPlanForm({ ...planForm, rateLimitRpm: e.target.value })}
                      placeholder={t('placeholders.rateLimitRpm')}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      {t('detailUx.rateLimitHint')}{' '}
                      <InfoHintPopover label={t('hints.rateLimitTitle')} portal>
                        <p>{t('help.rateLimitRpm')}</p>
                      </InfoHintPopover>
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ReadonlyRow label={t('table.created')}>{formatDateTime(user.created_at)}</ReadonlyRow>
                  <ReadonlyRow label={t('table.updated')}>{formatDateTime(user.updated_at)}</ReadonlyRow>
                </div>

                <div className="flex justify-end border-t border-gray-100 pt-3">
                  <button
                    type="button"
                    onClick={deleteUser}
                    className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-800"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                    {t('deleteUser')}
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold text-gray-900">{t('apiKeys')}</h2>
                  <button
                    type="button"
                    onClick={() => setActiveSection('keys')}
                    className="text-sm font-medium text-blue-600 hover:text-blue-800"
                  >
                    {t('detailUx.manageKeys')}
                  </button>
                </div>
                {keys.length === 0 ? (
                  <p className="text-sm text-gray-500">{t('keysTable.noKeys')}</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {keys.slice(0, 3).map((key) => (
                      <li key={key.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-gray-900">
                            {key.name?.trim() || maskKey(key.key)}
                          </p>
                          {key.name?.trim() && (
                            <p className="mt-0.5 font-mono text-xs text-gray-500">{maskKey(key.key)}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-gray-500">
                            {keyRpm(key) == null
                              ? tCommon('noLimit')
                              : t('keysTable.rateLimitRpmValue', { rpm: keyRpm(key) ?? 0 })}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              key.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {key.status === 'active'
                              ? tOptions('keyStatus.active')
                              : key.status === 'revoked'
                              ? tOptions('keyStatus.revoked')
                              : key.status}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {keys.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setActiveSection('keys')}
                    className="mt-2 text-xs text-blue-600 hover:underline"
                  >
                    {t('detailSections.moreCount', { count: keys.length - 3 })}
                  </button>
                )}
              </div>
            </div>
            <div className="min-w-0 space-y-4 sm:space-y-6">
              <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
                <h2 className="text-lg font-semibold text-gray-900">
                  {t('externalIdentity.title')}{' '}
                  <span className="ml-1 text-xs font-normal text-gray-400">{tCommon('optional')}</span>
                </h2>
                <p className="mt-1 text-xs text-gray-500">{t('externalIdentity.hint')}</p>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="user-externalSystem" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('fields.externalSystem')}{' '}
                      <span className="ml-1 text-xs font-normal text-gray-400">{tCommon('optional')}</span>
                    </label>
                    <input
                      id="user-externalSystem"
                      type="text"
                      value={planForm.external_system}
                      onChange={(e) => setPlanForm({ ...planForm, external_system: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      placeholder="my-app"
                    />
                  </div>
                  <div>
                    <label htmlFor="user-externalUserId" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('fields.externalUserId')}{' '}
                      <span className="ml-1 text-xs font-normal text-gray-400">{tCommon('optional')}</span>
                    </label>
                    <input
                      id="user-externalUserId"
                      type="text"
                      value={planForm.external_user_id}
                      onChange={(e) => setPlanForm({ ...planForm, external_user_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      placeholder={t('fields.externalUserId')}
                    />
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
                <div className="min-w-0">
                  <label htmlFor="user-metadataJsonObject" className="block text-lg font-semibold text-gray-900 mb-3">
                    {t('fields.metadataJsonObject')}{' '}
                    <span className="ml-1 text-xs font-normal text-gray-400">{tCommon('optional')}</span>
                  </label>
                  <textarea
                    id="user-metadataJsonObject"
                    value={planForm.metadata}
                    onChange={(e) => setPlanForm({ ...planForm, metadata: e.target.value })}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-xs"
                    placeholder="{}"
                  />
                  <p className="mt-1 text-xs text-gray-500">{t('help.metadataReplace')}</p>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section
          id="user-panel-billing"
          role="tabpanel"
          aria-labelledby="user-tab-billing"
          hidden={activeSection !== 'billing'}
          tabIndex={0}
        >
          <p className="mb-4 text-sm text-gray-500">{t('detailUx.billingOrder')}</p>
          <div className="space-y-4 sm:space-y-6">
            <div className="grid grid-cols-1 items-stretch gap-4 sm:gap-6 xl:grid-cols-2">
              <div className="flex flex-col gap-4 rounded-xl border border-sky-200 bg-sky-50/70 p-4 sm:p-6">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-sm font-semibold text-sky-950">{t('table.budget')}</h2>
                  <InfoHintPopover label={t('hints.budgetTitle')} portal openOnHover align="start">
                    <p>{t('hints.budgetVsWallet')}</p>
                  </InfoHintPopover>
                </div>
                <ReadonlyRow label={t('detailUx.budgetRemaining')}>
                  <span className="text-xl sm:text-2xl font-semibold tabular-nums text-gray-900">
                    {budgetPreviewRemaining == null
                      ? tCommon('noLimit')
                      : formatGatewayMoneyCode(budgetPreviewRemaining, billingCurrency, 2)}
                  </span>
                </ReadonlyRow>
                <div className="grid grid-cols-1 items-start gap-4 border-t border-sky-200 pt-4 sm:grid-cols-2 2xl:grid-cols-3">
                  <div>
                    <BillingFieldLabel
                      htmlFor="user-budgetMax"
                      label={t('detailUx.fieldLabels.budgetMax')}
                      hint={t('detailUx.fieldHints.budgetMax')}
                      optionalLabel={tCommon('optional')}
                    />
                    <input
                      id="user-budgetMax"
                      type="number"
                      step="0.01"
                      value={planForm.budget_max}
                      onChange={(e) => setPlanForm({ ...planForm, budget_max: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
                      placeholder={tCommon('noLimit')}
                    />
                  </div>
                  <div>
                    <BillingFieldLabel
                      htmlFor="user-budgetSpent"
                      label={t('detailUx.fieldLabels.budgetSpent')}
                      hint={t('detailUx.fieldHints.budgetSpent')}
                    />
                    <input
                      id="user-budgetSpent"
                      type="number"
                      step="0.01"
                      value={planForm.budget_spent}
                      onChange={(e) => setPlanForm({ ...planForm, budget_spent: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
                    />
                  </div>
                  <div>
                    <BillingFieldLabel
                      htmlFor="user-budgetBase"
                      label={t('detailUx.fieldLabels.budgetBase')}
                      hint={t('detailUx.fieldHints.budgetBase')}
                      optionalLabel={tCommon('optional')}
                    />
                    <input
                      id="user-budgetBase"
                      type="number"
                      step="0.01"
                      value={planForm.budget_base}
                      onChange={(e) => setPlanForm({ ...planForm, budget_base: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
                      placeholder={tCommon('optional')}
                    />
                  </div>
                  <div>
                    <BillingFieldLabel
                      htmlFor="user-budgetPeriod"
                      label={t('detailUx.fieldLabels.budgetPeriod')}
                      hint={t('detailUx.fieldHints.budgetPeriod')}
                      optionalLabel={tCommon('optional')}
                    />
                    <select
                      id="user-budgetPeriod"
                      value={planForm.budget_period}
                      onChange={(e) => setPlanForm({ ...planForm, budget_period: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
                    >
                      <option value="none">{t('detailUx.noAutoReset')}</option>
                      <option value="daily">{tOptions('budgetPeriod.daily')}</option>
                      <option value="weekly">{tOptions('budgetPeriod.weekly')}</option>
                      <option value="monthly">{tOptions('budgetPeriod.monthly')}</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <BillingFieldLabel
                      htmlFor="user-budgetResetAt"
                      label={t('detailUx.fieldLabels.budgetResetAt')}
                      hint={t('detailUx.fieldHints.budgetResetAt', { timezone: businessTimezone })}
                      optionalLabel={tCommon('optional')}
                    />
                    <input
                      id="user-budgetResetAt"
                      type="datetime-local"
                      step={1}
                      value={planForm.budget_reset_at}
                      onChange={(e) => {
                        budgetResetDirtyRef.current = true;
                        setPlanForm({ ...planForm, budget_reset_at: e.target.value });
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
                    />
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-4 rounded-xl border border-violet-200 bg-violet-50/50 p-4 sm:p-6">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-sm font-semibold text-violet-950">{t('table.wallet')}</h2>
                  <InfoHintPopover label={t('hints.walletTitle')} portal openOnHover align="start">
                    <p>{t('hints.budgetVsWallet')}</p>
                  </InfoHintPopover>
                </div>
                <ReadonlyRow label={t('fields.walletBalance')}>
                  <span
                    className={`text-xl sm:text-2xl font-semibold tabular-nums ${
                      walletPreviewBalance < 0 ? 'text-red-600' : 'text-gray-900'
                    }`}
                  >
                    {formatGatewayMoneyCode(walletPreviewBalance, billingCurrency, 2)}
                  </span>
                </ReadonlyRow>
                <div className="grid grid-cols-1 items-start gap-4 border-t border-violet-200 pt-4">
                  <div>
                    <BillingFieldLabel
                      htmlFor="user-walletGranted"
                      label={t('detailUx.fieldLabels.walletGranted')}
                      hint={t('detailUx.fieldHints.walletGranted')}
                    />
                    <input
                      id="user-walletGranted"
                      type="number"
                      step="0.01"
                      min="0"
                      value={planForm.wallet_granted}
                      onChange={(e) => setPlanForm({ ...planForm, wallet_granted: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
                    />
                  </div>
                  <div>
                    <BillingFieldLabel
                      htmlFor="user-walletSpent"
                      label={t('detailUx.fieldLabels.walletSpent')}
                      hint={t('detailUx.fieldHints.walletSpent')}
                    />
                    <input
                      id="user-walletSpent"
                      type="number"
                      step="0.01"
                      min="0"
                      value={planForm.wallet_spent}
                      onChange={(e) => setPlanForm({ ...planForm, wallet_spent: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500">{t('help.walletBalance')}</p>
              </div>
            </div>
            <UserFactorEditor
              cards={factorCards}
              models={catalogById}
              groupsByModel={routeGroupsByModel}
              groupsLoaded={routeGroupsLoaded}
              configPreview={factorJsonPreview}
              onAddModel={() => {
                setModelPickerSearch('');
                setShowModelPicker(true);
              }}
              onAddGroup={addChargedCostFactorGroup}
              onUpdateRow={updateChargedCostFactorRow}
              onRemoveRow={(index) =>
                setPlanForm((prev) => ({
                  ...prev,
                  chargedCostFactorRows: prev.chargedCostFactorRows.filter((_, i) => i !== index),
                }))
              }
              onRemoveModel={(modelId) =>
                setPlanForm((prev) => ({
                  ...prev,
                  chargedCostFactorRows: prev.chargedCostFactorRows.filter((row) => row.modelId !== modelId),
                }))
              }
            />
          </div>
        </section>
      </fieldset>
      <section
        id="user-panel-keys"
        role="tabpanel"
        aria-labelledby="user-tab-keys"
        hidden={activeSection !== 'keys'}
        tabIndex={0}
      >
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 flex min-w-0 flex-col">
          <div className="flex justify-between items-center mb-4 shrink-0">
            <h2 className="text-lg font-semibold text-gray-900">{t('apiKeys')}</h2>
            <button
              type="button"
              onClick={() => {
                setShowNewKey(true);
                setKeyError('');
                setKeysInlineError('');
                setFreshApiKey(null);
              }}
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
            >
              <PlusIcon className="h-4 w-4" />
              {t('newKey')}
            </button>
          </div>
          {keysInlineError && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {keysInlineError}
            </div>
          )}
          {freshApiKey && <NewApiKeySecretBanner secret={freshApiKey} onDismiss={() => setFreshApiKey(null)} />}
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="min-w-full text-sm table-auto">
              <thead>
                <tr className="border-b text-xs text-gray-500 uppercase">
                  <th className="py-2 pr-4 text-left">{tCommon('key')}</th>
                  <th className="py-2 pr-4 text-left" title={t('keysTable.rateLimitHint')}>
                    {t('keysTable.rateLimit')}
                  </th>
                  <th className="py-2 pr-4 text-left">{tCommon('metadata')}</th>
                  <th className="py-2 pr-4 text-left">{tCommon('status')}</th>
                  <th className="py-2 pl-4 text-right whitespace-nowrap w-px">{tCommon('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-b border-gray-100">
                    <td className="py-2 pr-4 align-top">
                      <div className="truncate text-sm font-medium text-gray-900" title={k.name || undefined}>
                        {k.name?.trim() ? k.name : '—'}
                      </div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-[11px] text-gray-400">
                        <span className="min-w-0 truncate" title={k.key}>
                          {maskKey(k.key)}
                        </span>
                        <button
                          type="button"
                          onClick={() => copy(k.key)}
                          aria-label={tCommon('copy')}
                          className="shrink-0 rounded p-0.5 text-gray-300 hover:bg-gray-100 hover:text-gray-600"
                        >
                          <ClipboardDocumentIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-gray-400">{shortId(k.id)}</div>
                    </td>
                    <td className="py-2 pr-4 align-top" title={t('keysTable.rateLimitHint')}>
                      {(() => {
                        const rpm = keyRpm(k);
                        return rpm == null ? (
                          <span className="text-gray-400">{tCommon('noLimit')}</span>
                        ) : (
                          <span className={`tabular-nums ${rpm === 0 ? 'text-amber-700' : 'text-gray-900'}`}>
                            {t('keysTable.rateLimitRpmValue', { rpm })}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-2 pr-4 align-top max-w-xs">
                      {(() => {
                        const m = summarizeMetadata(k.metadata);
                        if (m.empty) {
                          return <span className="text-gray-400">—</span>;
                        }
                        return (
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`block truncate text-xs font-mono ${m.ok ? 'text-gray-700' : 'text-red-600'}`}
                              title={m.summary}
                            >
                              {m.summary}
                            </span>
                            <button
                              type="button"
                              onClick={() => setMetaViewKey(k)}
                              className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-800"
                            >
                              {t('keysTable.details')}
                            </button>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="py-2 pr-4 align-top">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={k.status === 'active'}
                        aria-label={
                          k.status === 'active'
                            ? t('keysTable.activeClickToRevoke')
                            : t('keysTable.inactiveClickToActivate')
                        }
                        title={k.status}
                        disabled={keyStatusTogglingId === k.id}
                        onClick={() => toggleKeyStatus(k)}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                          k.status === 'active' ? 'bg-blue-600' : 'bg-gray-200'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                            k.status === 'active' ? 'translate-x-5' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="py-2 pl-4 text-right whitespace-nowrap align-top">
                      <button
                        type="button"
                        onClick={() => deleteKeyHard(k.id)}
                        className="text-xs text-red-600 hover:underline inline-flex items-center gap-0.5"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                        {tCommon('delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {keys.length === 0 && <p className="text-sm text-gray-500 py-4">{t('keysTable.noKeys')}</p>}
          </div>
        </div>
      </section>
      <section
        id="user-panel-activity"
        role="tabpanel"
        aria-labelledby="user-tab-activity"
        hidden={activeSection !== 'activity'}
        tabIndex={0}
      >
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">{t('detailSections.recentRequestLogs')}</h2>
            <Link
              href={`/gateway/request-logs?user_email=${encodeURIComponent(user.email)}`}
              className="text-sm text-blue-600 hover:underline"
            >
              {tCommon('more')}
            </Link>
          </div>
          <div className="overflow-x-auto text-sm">
            <table className="min-w-full">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="py-2 pr-2">{tCommon('time')}</th>
                  <th className="py-2 pr-2">{tCommon('model')}</th>
                  <th className="py-2 pr-2">{t('table.group')}</th>
                  <th className="py-2 pr-2">{tCommon('provider')}</th>
                  <th className="py-2 pr-2">{tCommon('status')}</th>
                  <th className="py-2 pr-2 whitespace-nowrap">
                    {t('detailUx.standardCost')} ({billingCurrencySym})
                  </th>
                  <th className="py-2 pr-2 whitespace-nowrap">
                    {t('detailUx.chargedCost')} ({billingCurrencySym})
                  </th>
                  <th className="py-2 pr-2 whitespace-nowrap">
                    {t('detailUx.meteredCost')} ({billingCurrencySym})
                  </th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const routeGroup = normalizeRouteGroup(log.route_group);
                  return (
                    <tr key={log.id} className="border-b border-gray-50">
                      <td className="py-2 pr-2 whitespace-nowrap">{formatDateTime(log.created_at)}</td>
                      <td
                        className="py-2 pr-2 font-mono text-xs max-w-[10rem] truncate"
                        title={log.model_name || log.model_id || undefined}
                      >
                        {log.model_name || log.model_id || '—'}
                      </td>
                      <td className="py-2 pr-2">
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold leading-4 ${routeGroupBadgeClass(
                            routeGroup
                          )}`}
                          title={`route_group: ${routeGroup}`}
                        >
                          @{routeGroup}
                        </span>
                      </td>
                      <td className="py-2 pr-2 text-xs max-w-[10rem] truncate" title={formatLogProvider(log)}>
                        {formatLogProvider(log)}
                      </td>
                      <td className="py-2 pr-2">{log.status}</td>
                      <td className="py-2 pr-2 tabular-nums whitespace-nowrap">
                        {formatGatewayMoneyCode(Number(log.standard_cost ?? 0), billingCurrency, 4)}
                      </td>
                      <td className="py-2 pr-2 tabular-nums whitespace-nowrap">
                        {formatGatewayMoneyCode(Number(log.charged_cost ?? 0), billingCurrency, 4)}
                      </td>
                      <td className="py-2 pr-2 tabular-nums whitespace-nowrap">
                        {formatGatewayMoneyCode(Number(log.metered_cost ?? 0), billingCurrency, 4)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {logs.length === 0 && <p className="text-sm text-gray-500 py-4">{t('empty.requestLogs')}</p>}
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">{t('detailSections.userAuditLogs')}</h2>
            <Link
              href={`/gateway/audit-logs?user_id=${encodeURIComponent(user.id)}`}
              className="text-sm text-blue-600 hover:underline"
            >
              {tCommon('more')}
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-500 border-b">
                  <th className="px-3 py-2 text-xs font-medium uppercase whitespace-nowrap">{tAudit('table.time')}</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase whitespace-nowrap min-w-[11rem] max-w-[15rem]">
                    {tAudit('table.event')}
                  </th>
                  <th className="px-3 py-2 text-xs font-medium uppercase whitespace-nowrap min-w-[8.5rem] max-w-[12rem]">
                    {tAudit('table.actor')}
                  </th>
                  <th className="px-3 py-2 text-xs font-medium uppercase min-w-[14rem]">{tAudit('table.budget')}</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase min-w-[12rem]">{tAudit('table.periodPlan')}</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase min-w-[14rem]">{tAudit('table.wallet')}</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase min-w-[16rem]">
                    {tAudit('table.userChangeDetail')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {audits.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      {t('empty.auditLogs')}
                    </td>
                  </tr>
                ) : (
                  audits.map((a) => (
                    <tr key={a.id} className="align-top hover:bg-gray-50">
                      <AuditLogSharedCells
                        item={a}
                        currency={billingCurrency}
                        timezone={businessTimezone}
                        onViewDetail={setDetailLog}
                        showIdentity={false}
                      />
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      {(activeSection === 'overview' || activeSection === 'billing' || hasChanges) && (
        <div
          className={`${
            hasChanges ? 'sticky bottom-4 z-20' : ''
          } mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur`}
        >
          <p className={`text-sm ${hasChanges ? 'text-amber-700' : 'text-gray-500'}`} role="status">
            {hasChanges ? t('detailUx.unsaved') : t('detailUx.saved')}
          </p>
          <div className="flex items-center gap-2">
            {hasChanges && (
              <button
                type="button"
                disabled={isSavingPlan}
                onClick={() => {
                  if (savedFormRef.current) setPlanForm(savedFormRef.current);
                  budgetResetDirtyRef.current = false;
                  setPlanError('');
                }}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {t('detailUx.discard')}
              </button>
            )}
            <button
              type="button"
              onClick={savePlan}
              disabled={isSavingPlan || !hasChanges}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSavingPlan ? tCommon('saving') : t('detailUx.saveChanges')}
            </button>
          </div>
        </div>
      )}

      {detailLog ? (
        <AuditChangeDetailModal
          item={detailLog}
          timezone={businessTimezone}
          onClose={() => setDetailLog(null)}
        />
      ) : null}

      {showModelPicker && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowModelPicker(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-factor-model-picker-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b flex justify-between items-center gap-3">
              <h3 id="user-factor-model-picker-title" className="text-lg font-bold text-gray-900">
                {t('chargedCostFactors.pickTitle')}
              </h3>
              <button
                type="button"
                onClick={() => setShowModelPicker(false)}
                className="text-gray-400 hover:text-gray-600"
                aria-label={tCommon('close')}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-3 border-b">
              <label className="relative block">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  value={modelPickerSearch}
                  onChange={(e) => setModelPickerSearch(e.target.value)}
                  className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm"
                  placeholder={t('chargedCostFactors.pickSearch')}
                  autoFocus
                />
              </label>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {pickerModelsByVendor.length === 0 ? (
                <p className="py-6 text-sm text-gray-500">{t('chargedCostFactors.pickEmpty')}</p>
              ) : (
                <div className="space-y-5">
                  {pickerModelsByVendor.map(([vendorKey, models]) => (
                    <section key={vendorKey}>
                      <div className="mb-2 flex items-center gap-2">
                        <ModelVendorIcon vendor={vendorKey} size="compact" />
                        <h4 className="text-sm font-semibold text-gray-900">{getModelVendorLabel(vendorKey)}</h4>
                        <span className="text-xs text-gray-400">{models.length}</span>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {models.map((model) => {
                          const added = selectedFactorModelIds.has(model.id);
                          return (
                            <button
                              key={model.id}
                              type="button"
                              disabled={added}
                              onClick={() => addChargedCostFactorModel(model.id)}
                              className="flex min-w-0 items-start justify-between gap-2 rounded-md border border-gray-200 px-3 py-2 text-left hover:border-blue-300 hover:bg-blue-50/60 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-gray-200 disabled:hover:bg-transparent"
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm text-gray-900">{catalogModelLabel(model, model.id)}</span>
                                <span className="block truncate font-mono text-[11px] text-gray-500">{model.id}</span>
                              </span>
                              {added ? (
                                <span className="shrink-0 pt-0.5 text-xs text-gray-400">{t('chargedCostFactors.alreadyAdded')}</span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
            <div className="px-6 py-3 border-t flex justify-end">
              <button
                type="button"
                onClick={() => setShowModelPicker(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
              >
                {tCommon('close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {metaViewKey && (() => {
        const m = summarizeMetadata(metaViewKey.metadata);
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
              <div className="px-6 py-4 border-b flex justify-between items-center">
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-gray-900">{t('detailSections.keyMetadata')}</h3>
                  <p className="mt-0.5 text-xs text-gray-500 font-mono truncate" title={metaViewKey.id}>
                    {[metaViewKey.name, maskKey(metaViewKey.key)].filter(Boolean).join(' · ')} · {metaViewKey.id}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMetaViewKey(null)}
                  className="text-gray-400 hover:text-gray-600"
                  aria-label={tCommon('close')}
                >
                  ×
                </button>
              </div>
              <div className="p-6 overflow-y-auto">
                {m.empty ? (
                  <div className="text-sm text-gray-500">{t('metadata.none')}</div>
                ) : (
                  <>
                    {!m.ok && (
                      <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                        {t('metadata.invalidRaw')}
                      </div>
                    )}
                    <pre className="whitespace-pre-wrap break-all rounded-md bg-gray-50 border border-gray-200 p-4 text-xs font-mono text-gray-800">
                      {m.full}
                    </pre>
                  </>
                )}
              </div>
              <div className="px-6 py-3 border-t flex justify-end gap-2">
                {!m.empty && (
                  <button
                    type="button"
                    onClick={() => copy(m.full)}
                    className="px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
                  >
                    {tCommon('copy')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setMetaViewKey(null)}
                  className="px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
                >
                  {tCommon('close')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showNewKey && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-3">{t('detailSections.newApiKey')}</h3>
            {keyError && <div className="mb-3 p-2 bg-red-50 text-red-700 text-sm rounded">{keyError}</div>}
            <div className="space-y-3">
              <div>
                <label htmlFor="new-key-name" className="block text-sm text-gray-700 mb-1">
                  {t('fields.name')}</label>
                <input id="new-key-name" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor="new-key-metadata" className="block text-sm text-gray-700 mb-1">
                  {t('fields.metadataJson')}</label>
                <textarea id="new-key-metadata" value={newKeyMeta} onChange={(e) => setNewKeyMeta(e.target.value)} rows={4} className="w-full border rounded px-3 py-2 font-mono text-xs" />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowNewKey(false)} className="px-3 py-2 border rounded text-sm" disabled={isKeySaving}>{tCommon('cancel')}</button>
              <button type="button" onClick={createKey} disabled={isKeySaving} className="px-3 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50">{isKeySaving ? '…' : tCommon('create')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function shortId(id: string): string {
  if (!id || id.length < 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}
