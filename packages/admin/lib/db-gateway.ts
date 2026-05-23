/**
 * 历史遗留：直连 D1 的查询封装。当前 Gateway Admin 运行时以 Worker HTTP 代理为主（见 `proxyToGateway`），
 * 本文件可保留作参考或本地实验，勿与线上 BFF 数据路径混用。
 */
import type { D1Database } from '@cloudflare/workers-types';
import type {
  GatewayApiKey,
  GatewayProvider,
  GatewayModel,
  GatewayModelRoute,
  GatewayRequestLog,
  KpiMetrics,
  ModelUsageRow,
  UserUsageRow,
  ProviderReliabilityRow,
  ModelProviderRow,
  SystemConfigRow,
} from './types';
import { normalizeModelVendorInput } from './model-vendor';

// ============== API Keys ==============

export async function getAllApiKeys(db: D1Database, options?: {
  email?: string;
  maxBudget?: 'positive' | 'zero_or_negative' | 'null';
  page?: number;
  pageSize?: number;
}): Promise<{ keys: GatewayApiKey[]; total: number }> {
  const page = options?.page || 1;
  const pageSize = Math.min(options?.pageSize || 20, 100);
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const bindValues: unknown[] = [];

  if (options?.email) {
    conditions.push('user_email LIKE ?');
    bindValues.push(`%${options.email}%`);
  }
  if (options?.maxBudget === 'positive') {
    conditions.push('budget_max > 0');
  } else if (options?.maxBudget === 'zero_or_negative') {
    conditions.push('budget_max <= 0');
  } else if (options?.maxBudget === 'null') {
    conditions.push('budget_max IS NULL');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Max-budget > 0: soonest reset first (NULL reset at end) for ops visibility; otherwise newest keys first
  const orderBy =
    options?.maxBudget === 'positive'
      ? 'ORDER BY budget_reset_at ASC NULLS LAST, created_at DESC'
      : 'ORDER BY created_at DESC';

  // Get total count (full table/filtered count, not current page size)
  const countRow = await db.prepare(
    `SELECT COUNT(*) as total FROM api_keys ${whereClause}`
  ).bind(...bindValues).first<{ total: number }>();
  const total = Number(countRow?.total ?? 0);

  // Get paginated results
  const result = await db.prepare(
    `SELECT id, key, user_id, user_email, budget_max, budget_spent,
     budget_period, budget_reset_at, status, metadata, created_at, updated_at
     FROM api_keys ${whereClause} ${orderBy} LIMIT ? OFFSET ?`
  ).bind(...bindValues, pageSize, offset).all<GatewayApiKey>();

  return { keys: result.results ?? [], total };
}

export async function getApiKeyById(db: D1Database, id: string): Promise<GatewayApiKey | null> {
  return db.prepare('SELECT * FROM api_keys WHERE id = ?').bind(id).first<GatewayApiKey>();
}

export async function getApiKeyByKey(db: D1Database, key: string): Promise<GatewayApiKey | null> {
  return db.prepare('SELECT * FROM api_keys WHERE key = ?').bind(key).first<GatewayApiKey>();
}

export async function createApiKey(db: D1Database, data: {
  id: string;
  key: string;
  user_id: string;
  user_email?: string;
  budget_max?: number;
  budget_spent?: number;
  budget_period?: string;
  budget_reset_at?: string;
  status?: string;
  metadata?: string | null;
}): Promise<void> {
  await db.prepare(
    `INSERT INTO api_keys (id, key, user_id, user_email, budget_max, budget_spent, budget_period, budget_reset_at, status, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.id,
    data.key,
    data.user_id,
    data.user_email || null,
    data.budget_max || null,
    data.budget_spent || 0,
    data.budget_period || 'none',
    data.budget_reset_at || null,
    data.status || 'active',
    data.metadata ?? null
  ).run();
}

export async function updateApiKey(db: D1Database, id: string, data: Partial<{
  budget_max: number | null;
  budget_spent: number;
  budget_period: string;
  budget_reset_at: string | null;
  status: string;
  metadata: string | null;
}>): Promise<boolean> {
  const updateFields: string[] = [];
  const bindValues: unknown[] = [];

  if (data.budget_max !== undefined) {
    updateFields.push('budget_max = ?');
    bindValues.push(data.budget_max);
  }
  if (data.budget_spent !== undefined) {
    updateFields.push('budget_spent = ?');
    bindValues.push(data.budget_spent);
  }
  if (data.budget_period !== undefined) {
    updateFields.push('budget_period = ?');
    bindValues.push(data.budget_period);
  }
  if (data.budget_reset_at !== undefined) {
    updateFields.push('budget_reset_at = ?');
    bindValues.push(data.budget_reset_at);
  }
  if (data.status !== undefined) {
    updateFields.push('status = ?');
    bindValues.push(data.status);
  }
  if (data.metadata !== undefined) {
    updateFields.push('metadata = ?');
    bindValues.push(data.metadata);
  }

  if (updateFields.length === 0) return false;

  updateFields.push('updated_at = datetime("now")');
  bindValues.push(id);

  const result = await db.prepare(
    `UPDATE api_keys SET ${updateFields.join(', ')} WHERE id = ?`
  ).bind(...bindValues).run();
  return result.meta.changes > 0;
}

export async function revokeApiKey(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare(
    'UPDATE api_keys SET status = ?, updated_at = datetime("now") WHERE id = ?'
  ).bind('revoked', id).run();
  return result.meta.changes > 0;
}

// ============== Providers ==============

export async function getAllGatewayProviders(db: D1Database): Promise<GatewayProvider[]> {
  const result = await db.prepare(
    `SELECT id, name, base_url_openai, base_url_anthropic, base_url_gemini, api_key, description, created_at
    FROM providers
    ORDER BY created_at DESC`
  ).all<GatewayProvider>();
  return result.results ?? [];
}

export async function getGatewayProviderById(db: D1Database, id: string): Promise<GatewayProvider | null> {
  return db.prepare('SELECT * FROM providers WHERE id = ?').bind(id).first<GatewayProvider>();
}

export function nullIfEmpty(s: string | null | undefined): string | null {
  if (s == null || String(s).trim() === '') return null;
  return String(s).trim();
}

export async function createGatewayProvider(db: D1Database, data: {
  id: string;
  name: string;
  base_url_openai: string | null;
  api_key: string;
  base_url_anthropic?: string | null;
  base_url_gemini?: string | null;
  description?: string | null;
}): Promise<void> {
  const openai = nullIfEmpty(data.base_url_openai);
  const anthropic = nullIfEmpty(data.base_url_anthropic);
  const gemini = nullIfEmpty(data.base_url_gemini);
  await db.prepare(
    `INSERT INTO providers (id, name, base_url_openai, base_url_anthropic, base_url_gemini, api_key, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.id,
    data.name,
    openai,
    anthropic,
    gemini,
    data.api_key,
    data.description ?? null
  ).run();
}

export async function updateGatewayProvider(db: D1Database, id: string, data: Partial<{
  name: string;
  base_url_openai: string | null;
  base_url_anthropic: string | null;
  base_url_gemini: string | null;
  api_key: string;
  description: string | null;
}>): Promise<boolean> {
  const updateFields: string[] = [];
  const bindValues: unknown[] = [];

  if (data.name !== undefined) {
    updateFields.push('name = ?');
    bindValues.push(data.name);
  }
  if (data.base_url_openai !== undefined) {
    updateFields.push('base_url_openai = ?');
    bindValues.push(data.base_url_openai);
  }
  if (data.base_url_anthropic !== undefined) {
    updateFields.push('base_url_anthropic = ?');
    bindValues.push(data.base_url_anthropic);
  }
  if (data.base_url_gemini !== undefined) {
    updateFields.push('base_url_gemini = ?');
    bindValues.push(data.base_url_gemini);
  }
  if (data.api_key !== undefined) {
    updateFields.push('api_key = ?');
    bindValues.push(data.api_key);
  }
  if (data.description !== undefined) {
    updateFields.push('description = ?');
    bindValues.push(data.description);
  }

  if (updateFields.length === 0) return false;

  bindValues.push(id);

  const result = await db.prepare(
    `UPDATE providers SET ${updateFields.join(', ')} WHERE id = ?`
  ).bind(...bindValues).run();
  return result.meta.changes > 0;
}

export async function deleteGatewayProvider(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM providers WHERE id = ?').bind(id).run();
  return result.meta.changes > 0;
}

// ============== Models ==============

export async function getAllModels(db: D1Database): Promise<GatewayModel[]> {
  const sql = `SELECT m.id, m.display_name, m.vendor, m.context_window, m.max_tokens, m.pricing_profile,
    (SELECT json_group_array(mt.tag) FROM model_tags mt WHERE mt.model_id = m.id) AS tags,
    m.description, m.metadata, m.created_at,
    (SELECT COUNT(*) FROM model_routes WHERE model_id = m.id) AS routes_count,
    (SELECT COUNT(*) FROM model_routes WHERE model_id = m.id AND status = 'active') AS active_routes_count
    FROM models m ORDER BY m.id ASC`;
  const result = await db.prepare(sql).all<GatewayModel>();
  return result.results ?? [];
}

export async function getModelById(db: D1Database, id: string): Promise<GatewayModel | null> {
  return db.prepare(
    `SELECT m.id, m.display_name, m.vendor, m.context_window, m.max_tokens, m.pricing_profile,
      (SELECT json_group_array(mt.tag) FROM model_tags mt WHERE mt.model_id = m.id) AS tags,
      m.description, m.metadata, m.created_at,
      (SELECT COUNT(*) FROM model_routes WHERE model_id = m.id) AS routes_count,
      (SELECT COUNT(*) FROM model_routes WHERE model_id = m.id AND status = 'active') AS active_routes_count
    FROM models m WHERE m.id = ?`
  ).bind(id).first<GatewayModel>();
}

export async function createModel(db: D1Database, data: {
  id: string;
  display_name?: string;
  vendor?: string;
  context_window?: number;
  max_tokens?: number;
  pricing_profile?: string | null;
  description?: string | null;
  metadata?: string;
  tags?: string[];
}): Promise<void> {
  await db.prepare(
    `INSERT INTO models (id, display_name, vendor, context_window, max_tokens, pricing_profile, description, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.id,
    data.display_name || null,
    normalizeModelVendorInput(data.vendor),
    data.context_window || null,
    data.max_tokens ?? 8192,
    data.pricing_profile ?? null,
    data.description ?? null,
    data.metadata ?? null
  ).run();
  if (data.tags && data.tags.length > 0) {
    await setModelTags(db, data.id, data.tags);
  }
}

export async function updateModel(db: D1Database, id: string, data: Partial<{
  display_name: string;
  vendor: string;
  context_window: number;
  max_tokens: number;
  pricing_profile: string | null;
  description: string | null;
  metadata: string;
  tags: string[];
}>): Promise<boolean> {
  const { tags, vendor, ...rest } = data;
  const restPatch: Record<string, unknown> = { ...rest };
  if (vendor !== undefined) {
    restPatch.vendor = normalizeModelVendorInput(vendor);
  }
  const updateFields: string[] = [];
  const bindValues: unknown[] = [];

  Object.entries(restPatch).forEach(([key, value]) => {
    if (value !== undefined) {
      updateFields.push(`${key} = ?`);
      bindValues.push(value);
    }
  });

  if (updateFields.length > 0) {
    bindValues.push(id);
    const result = await db.prepare(
      `UPDATE models SET ${updateFields.join(', ')} WHERE id = ?`
    ).bind(...bindValues).run();
    if (!result.meta.changes) return false;
  }

  if (tags !== undefined) {
    await setModelTags(db, id, tags);
  }

  return true;
}

export async function deleteModel(db: D1Database, id: string): Promise<boolean> {
  await db.prepare('DELETE FROM model_routes WHERE model_id = ?').bind(id).run();
  await db.prepare('DELETE FROM model_tags WHERE model_id = ?').bind(id).run();
  const result = await db.prepare('DELETE FROM models WHERE id = ?').bind(id).run();
  return result.meta.changes > 0;
}

export async function setModelTags(db: D1Database, modelId: string, tags: string[]): Promise<void> {
  await db.prepare('DELETE FROM model_tags WHERE model_id = ?').bind(modelId).run();
  for (const tag of tags) {
    if (tag.trim()) {
      await db.prepare('INSERT INTO model_tags (model_id, tag) VALUES (?, ?)').bind(modelId, tag.trim()).run();
    }
  }
}

// ============== Model Routes ==============

export async function getAllModelRoutes(db: D1Database): Promise<(GatewayModelRoute & { model_name?: string; provider_name?: string })[]> {
  const result = await db.prepare(
    `SELECT mr.id, mr.model_id, mr.provider_id, mr.provider_model_name, mr.priority, mr.status,
      mr.route_group, mr.price_override,
      mr.custom_params,
      mr.upstream_protocol,
      m.display_name as model_name, p.name as provider_name
    FROM model_routes mr
    LEFT JOIN models m ON mr.model_id = m.id
    LEFT JOIN providers p ON mr.provider_id = p.id
    ORDER BY mr.model_id, mr.priority DESC`
  ).all<GatewayModelRoute & { model_name?: string; provider_name?: string }>();
  return result.results ?? [];
}

export async function getModelRouteById(db: D1Database, id: string): Promise<GatewayModelRoute | null> {
  return db.prepare('SELECT * FROM model_routes WHERE id = ?').bind(id).first<GatewayModelRoute>();
}

export async function createModelRoute(db: D1Database, data: {
  id: string;
  model_id: string;
  provider_id: string;
  provider_model_name: string;
  priority?: number;
  status?: string;
  route_group?: string;
  price_override?: string | null;
  custom_params?: string | null;
  upstream_protocol?: string;
}): Promise<void> {
  await db.prepare(
    `INSERT INTO model_routes (id, model_id, provider_id, provider_model_name, priority, status, route_group, price_override, custom_params, upstream_protocol)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.id,
    data.model_id,
    data.provider_id,
    data.provider_model_name,
    data.priority || 0,
    data.status || 'active',
    data.route_group ?? 'default',
    data.price_override ?? null,
    data.custom_params ?? null,
    data.upstream_protocol ?? 'openai'
  ).run();
}

export async function updateModelRoute(db: D1Database, id: string, data: Partial<{
  model_id: string;
  provider_id: string;
  provider_model_name: string;
  priority: number;
  status: string;
  route_group: string;
  price_override: string | null;
  custom_params: string | null;
  upstream_protocol: string;
}>): Promise<boolean> {
  const updateFields: string[] = [];
  const bindValues: unknown[] = [];

  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined) {
      updateFields.push(`${key} = ?`);
      bindValues.push(value);
    }
  });

  if (updateFields.length === 0) return false;

  bindValues.push(id);

  const result = await db.prepare(
    `UPDATE model_routes SET ${updateFields.join(', ')} WHERE id = ?`
  ).bind(...bindValues).run();
  return result.meta.changes > 0;
}

export async function deleteModelRoute(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM model_routes WHERE id = ?').bind(id).run();
  return result.meta.changes > 0;
}

// ============== Request Logs ==============

export async function getRequestLogs(db: D1Database, options: {
  page?: number;
  pageSize?: number;
  apiKeyId?: string;
  userEmail?: string;
  modelId?: string;
  routeGroup?: string;
  protocol?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}): Promise<{ logs: GatewayRequestLog[]; total: number }> {
  const page = options.page || 1;
  const pageSize = Math.min(options.pageSize || 20, 100);
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const conditionsRl: string[] = [];
  const bindValues: unknown[] = [];

  if (options.apiKeyId) {
    conditions.push('api_key_id = ?');
    conditionsRl.push('rl.api_key_id = ?');
    bindValues.push(options.apiKeyId);
  }
  if (options.userEmail) {
    conditions.push('user_email = ?');
    conditionsRl.push('rl.user_email = ?');
    bindValues.push(options.userEmail);
  }
  if (options.modelId) {
    conditions.push('model_id = ?');
    conditionsRl.push('rl.model_id = ?');
    bindValues.push(options.modelId);
  }
  if (options.routeGroup) {
    conditions.push('route_group = ?');
    conditionsRl.push('rl.route_group = ?');
    bindValues.push(options.routeGroup);
  }
  if (options.protocol) {
    conditions.push("COALESCE(NULLIF(request_protocol, ''), upstream_protocol) = ?");
    conditionsRl.push("COALESCE(NULLIF(rl.request_protocol, ''), rl.upstream_protocol) = ?");
    bindValues.push(options.protocol);
  }
  if (options.status) {
    conditions.push('status = ?');
    conditionsRl.push('rl.status = ?');
    bindValues.push(options.status);
  }
  if (options.startDate) {
    conditions.push('created_at >= ?');
    conditionsRl.push('rl.created_at >= ?');
    bindValues.push(options.startDate);
  }
  if (options.endDate) {
    conditions.push('created_at <= ?');
    conditionsRl.push('rl.created_at <= ?');
    bindValues.push(options.endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const whereClauseRl = conditionsRl.length > 0 ? `WHERE ${conditionsRl.join(' AND ')}` : '';

  // Get total count
  const countRow = await db.prepare(
    `SELECT COUNT(*) as total FROM api_key_request_logs ${whereClause}`
  ).bind(...bindValues).first<{ total: number }>();
  const total = countRow?.total ?? 0;

  // Get logs with provider name and provider_model_name (route → provider)
  const result = await db.prepare(
    `SELECT rl.*,
       p.name AS provider_name,
       (SELECT mr.provider_model_name FROM model_routes mr WHERE mr.model_id = rl.model_id AND mr.provider_id = rl.provider_id AND mr.status = 'active' ORDER BY mr.priority DESC LIMIT 1) AS provider_model_name
     FROM api_key_request_logs rl
     LEFT JOIN providers p ON p.id = rl.provider_id
     ${whereClauseRl} ORDER BY rl.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...bindValues, pageSize, offset).all<GatewayRequestLog>();

  return { logs: result.results ?? [], total };
}

export async function getRequestLogsByKeyId(
  db: D1Database,
  apiKeyId: string,
  page: number,
  pageSize: number
): Promise<{ logs: GatewayRequestLog[]; total: number }> {
  return getRequestLogs(db, { apiKeyId, page, pageSize });
}

// ============== Stats ==============

export async function getGatewayStats(db: D1Database): Promise<{
  activeKeysCount: number;
  todayRequestsCount: number;
  todayCost: number;
  errorRate: number;
}> {
  // Active keys count
  const activeKeys = await db.prepare(
    'SELECT COUNT(*) as count FROM api_keys WHERE status = ?'
  ).bind('active').first<{ count: number }>();

  // Today's stats (UTC calendar day; range on created_at uses idx_api_key_request_logs_created)
  const today = new Date().toISOString().slice(0, 10);
  const tomorrowUtc = new Date(
    Date.UTC(
      Number(today.slice(0, 4)),
      Number(today.slice(5, 7)) - 1,
      Number(today.slice(8, 10)) + 1
    )
  )
    .toISOString()
    .slice(0, 10);
  const dayStart = `${today} 00:00:00`;
  const dayEndExclusive = `${tomorrowUtc} 00:00:00`;
  const todayStats = await db.prepare(
    `SELECT COUNT(*) as count, SUM(charged_cost) as charged_cost,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count
    FROM api_key_request_logs WHERE created_at >= ? AND created_at < ?`
  )
    .bind(dayStart, dayEndExclusive)
    .first<{ count: number; charged_cost: number; error_count: number }>();

  const todayRequestsCount = todayStats?.count ?? 0;
  const errorCount = todayStats?.error_count ?? 0;

  return {
    activeKeysCount: activeKeys?.count ?? 0,
    todayRequestsCount,
    todayCost: todayStats?.charged_cost ?? 0,
    errorRate: todayRequestsCount > 0 ? (errorCount / todayRequestsCount) * 100 : 0,
  };
}

export async function getRecentLogs(db: D1Database, limit: number = 5): Promise<GatewayRequestLog[]> {
  const result = await db.prepare(
    'SELECT * FROM api_key_request_logs ORDER BY created_at DESC LIMIT ?'
  ).bind(limit).all<GatewayRequestLog>();
  return result.results ?? [];
}

export async function getRecentErrors(db: D1Database, limit: number = 5): Promise<GatewayRequestLog[]> {
  const result = await db.prepare(
    `SELECT * FROM api_key_request_logs WHERE status = 'error' ORDER BY created_at DESC LIMIT ?`
  ).bind(limit).all<GatewayRequestLog>();
  return result.results ?? [];
}

// ============== Analytics Aggregations ==============
// Range queries use idx_api_key_request_logs_created. Admin filters use 0018 indexes:
// idx_api_key_request_logs_model_created, idx_api_key_request_logs_user_email_created, idx_api_key_request_logs_status_created.

const MAX_ANALYTICS_DAYS = 180;

function clampAnalyticsRange(startDate?: string, endDate?: string): { start: string; end: string } {
  const end = endDate ? new Date(endDate) : new Date();
  let start = startDate ? new Date(startDate) : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const maxStart = new Date(end.getTime() - MAX_ANALYTICS_DAYS * 24 * 60 * 60 * 1000);
  if (start < maxStart) start = maxStart;
  return {
    start: start.toISOString().slice(0, 19).replace('T', ' '),
    end: end.toISOString().slice(0, 19).replace('T', ' '),
  };
}

/** KPI metrics for a time range (api_key_request_logs only; no region filter). */
export async function getKpiMetrics(
  db: D1Database,
  options: { startDate?: string; endDate?: string }
): Promise<KpiMetrics> {
  const { start, end } = clampAnalyticsRange(options.startDate, options.endDate);
  const row = await db
    .prepare(
      `SELECT
        COUNT(*) as total_requests,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
        COALESCE(SUM(charged_cost), 0) as charged_cost,
        COALESCE(SUM(metered_cost), 0) as metered_cost,
        COUNT(DISTINCT CASE WHEN user_email IS NOT NULL AND user_email != '' THEN user_email END) as active_users
      FROM api_key_request_logs WHERE created_at >= ? AND created_at <= ?`
    )
    .bind(start, end)
    .first<{
      total_requests: number;
      success_count: number;
      error_count: number;
      charged_cost: number;
      metered_cost: number;
      active_users: number;
    }>();
  const total = Number(row?.total_requests ?? 0);
  const successCount = Number(row?.success_count ?? 0);
  const errorCount = Number(row?.error_count ?? 0);
  return {
    totalRequests: total,
    successRate: total > 0 ? (successCount / total) * 100 : 0,
    totalCost: Number(row?.charged_cost ?? 0),
    meteredCost: Number(row?.metered_cost ?? 0),
    activeUsers: Number(row?.active_users ?? 0),
    errorRate: total > 0 ? (errorCount / total) * 100 : 0,
  };
}

export async function getDistinctModelTags(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare('SELECT DISTINCT tag FROM model_tags ORDER BY tag ASC')
    .all<{ tag: string }>();
  return (result.results ?? []).map((r) => r.tag);
}

/** Model usage aggregation. Optional tag (model_tags) filter. */
export async function getModelUsageStats(
  db: D1Database,
  options: { startDate?: string; endDate?: string; tag?: string }
): Promise<ModelUsageRow[]> {
  const { start, end } = clampAnalyticsRange(options.startDate, options.endDate);
  const tagRaw = options.tag;
  const hasTag = tagRaw != null && tagRaw.trim() !== '';
  const tagValue = hasTag ? tagRaw.trim() : '';

  const joins: string[] = [];
  if (hasTag) joins.push('INNER JOIN model_tags mt ON mt.model_id = rl.model_id AND mt.tag = ?');

  const whereParts = ['rl.created_at >= ?', 'rl.created_at <= ?'];
  const bindValues: unknown[] = [];
  if (hasTag) bindValues.push(tagValue);
  bindValues.push(start, end);

  const fromClause = `api_key_request_logs rl ${joins.join(' ')}`;
  const whereClause = whereParts.join(' AND ');
  const modelIdCol = `rl.model_id`;

  const result = await db
    .prepare(
      `SELECT
        ${modelIdCol} as model_id,
        rl.route_group as route_group,
        COUNT(*) as request_count,
        COALESCE(SUM(rl.charged_cost), 0) as charged_cost,
        COALESCE(SUM(rl.metered_cost), 0) as metered_cost,
        COALESCE(SUM(rl.input_tokens), 0) as input_tokens,
        COALESCE(SUM(rl.output_tokens), 0) as output_tokens,
        SUM(CASE WHEN rl.status = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN rl.status = 'error' THEN 1 ELSE 0 END) as error_count,
        AVG(rl.latency_ms) as avg_latency_ms
      FROM ${fromClause}
      WHERE ${whereClause} AND ${modelIdCol} IS NOT NULL
      GROUP BY rl.model_id, rl.route_group`
    )
    .bind(...bindValues)
    .all<{
      model_id: string;
      route_group: string;
      request_count: number;
      charged_cost: number;
      metered_cost: number;
      input_tokens: number;
      output_tokens: number;
      success_count: number;
      error_count: number;
      avg_latency_ms: number | null;
    }>();

  const rows = (result.results ?? []).map((r) => {
    const reqCount = Number(r.request_count);
    const successCount = Number(r.success_count);
    const chargedCost = Number(r.charged_cost);
    return {
      model_id: r.model_id,
      route_group: r.route_group ?? 'default',
      request_count: reqCount,
      charged_cost: chargedCost,
      metered_cost: Number(r.metered_cost),
      input_tokens: Number(r.input_tokens),
      output_tokens: Number(r.output_tokens),
      success_count: successCount,
      error_count: Number(r.error_count),
      success_rate: reqCount > 0 ? (successCount / reqCount) * 100 : 0,
      avg_latency_ms: r.avg_latency_ms != null ? Number(r.avg_latency_ms) : null,
      avg_charged_per_request: reqCount > 0 ? chargedCost / reqCount : 0,
    };
  });
  return rows;
}

/** User usage aggregation; joins api_keys for budget. */
export async function getUserUsageStats(
  db: D1Database,
  options: { startDate?: string; endDate?: string; email?: string }
): Promise<UserUsageRow[]> {
  const { start, end } = clampAnalyticsRange(options.startDate, options.endDate);
  const conditions: string[] = ['rl.created_at >= ?', 'rl.created_at <= ?', "rl.user_email IS NOT NULL AND rl.user_email != ''"];
  const bindValues: unknown[] = [start, end];
  if (options.email) {
    conditions.push('rl.user_email LIKE ?');
    bindValues.push(`%${options.email}%`);
  }
  const whereClause = conditions.join(' AND ');

  const result = await db
    .prepare(
      `SELECT
        rl.user_email as user_email,
        COUNT(*) as request_count,
        COALESCE(SUM(rl.charged_cost), 0) as charged_cost,
        COALESCE(SUM(rl.metered_cost), 0) as metered_cost,
        COUNT(DISTINCT rl.model_id) as distinct_models,
        MAX(rl.created_at) as last_active_at,
        MAX(ak.budget_max) as budget_max,
        MAX(ak.budget_spent) as budget_spent,
        SUM(CASE WHEN rl.status = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN rl.status = 'error' THEN 1 ELSE 0 END) as error_count
      FROM api_key_request_logs rl
      LEFT JOIN api_keys ak ON ak.id = rl.api_key_id
      WHERE ${whereClause}
      GROUP BY rl.user_email`
    )
    .bind(...bindValues)
    .all<{
      user_email: string;
      request_count: number;
      charged_cost: number;
      metered_cost: number;
      distinct_models: number;
      last_active_at: string | null;
      budget_max: number | null;
      budget_spent: number | null;
      success_count: number;
      error_count: number;
    }>();

  const rows = (result.results ?? []).map((r) => {
    const reqCount = Number(r.request_count);
    const successCount = Number(r.success_count);
    const budgetMax = r.budget_max != null ? Number(r.budget_max) : null;
    const budgetSpent = Number(r.budget_spent ?? 0);
    let budgetUsageRate: number | null = null;
    if (budgetMax != null && budgetMax > 0) {
      budgetUsageRate = (budgetSpent / budgetMax) * 100;
    }
    return {
      user_email: r.user_email,
      request_count: reqCount,
      charged_cost: Number(r.charged_cost),
      metered_cost: Number(r.metered_cost),
      distinct_models: Number(r.distinct_models),
      last_active_at: r.last_active_at,
      budget_max: budgetMax,
      budget_spent: budgetSpent,
      budget_usage_rate: budgetUsageRate,
      success_rate: reqCount > 0 ? (successCount / reqCount) * 100 : 0,
      error_count: Number(r.error_count),
    };
  });
  return rows;
}

/** Provider-level reliability. */
export async function getProviderReliability(
  db: D1Database,
  options: { startDate?: string; endDate?: string }
): Promise<ProviderReliabilityRow[]> {
  const { start, end } = clampAnalyticsRange(options.startDate, options.endDate);
  const result = await db
    .prepare(
      `SELECT
        provider_id,
        COUNT(*) as request_count,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
        AVG(latency_ms) as avg_latency_ms,
        COALESCE(SUM(charged_cost), 0) as charged_cost,
        COALESCE(SUM(metered_cost), 0) as metered_cost
      FROM api_key_request_logs
      WHERE created_at >= ? AND created_at <= ? AND provider_id IS NOT NULL
      GROUP BY provider_id`
    )
    .bind(start, end)
    .all<{
      provider_id: string;
      request_count: number;
      success_count: number;
      error_count: number;
      avg_latency_ms: number | null;
      charged_cost: number;
      metered_cost: number;
    }>();

  return (result.results ?? []).map((r) => {
    const reqCount = Number(r.request_count);
    return {
      provider_id: r.provider_id,
      request_count: reqCount,
      success_count: Number(r.success_count),
      error_count: Number(r.error_count),
      success_rate: reqCount > 0 ? (Number(r.success_count) / reqCount) * 100 : 0,
      avg_latency_ms: r.avg_latency_ms != null ? Number(r.avg_latency_ms) : null,
      charged_cost: Number(r.charged_cost),
      metered_cost: Number(r.metered_cost),
    };
  });
}

/** Per-model per-provider breakdown for reliability comparison. */
export async function getModelProviderStats(
  db: D1Database,
  options: { startDate?: string; endDate?: string }
): Promise<ModelProviderRow[]> {
  const { start, end } = clampAnalyticsRange(options.startDate, options.endDate);
  const result = await db
    .prepare(
      `SELECT
        model_id,
        provider_id,
        COUNT(*) as request_count,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
        AVG(latency_ms) as avg_latency_ms,
        COALESCE(SUM(charged_cost), 0) as charged_cost,
        COALESCE(SUM(metered_cost), 0) as metered_cost
      FROM api_key_request_logs
      WHERE created_at >= ? AND created_at <= ? AND model_id IS NOT NULL AND provider_id IS NOT NULL
      GROUP BY model_id, provider_id`
    )
    .bind(start, end)
    .all<{
      model_id: string;
      provider_id: string;
      request_count: number;
      success_count: number;
      avg_latency_ms: number | null;
      charged_cost: number;
      metered_cost: number;
    }>();

  return (result.results ?? []).map((r) => {
    const reqCount = Number(r.request_count);
    return {
      model_id: r.model_id,
      provider_id: r.provider_id,
      request_count: reqCount,
      success_rate: reqCount > 0 ? (Number(r.success_count) / reqCount) * 100 : 0,
      avg_latency_ms: r.avg_latency_ms != null ? Number(r.avg_latency_ms) : null,
      charged_cost: Number(r.charged_cost),
      metered_cost: Number(r.metered_cost),
    };
  });
}

// ---------- System config (key-value, same table as Gateway) ----------

export async function getConfig(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM system_config WHERE key = ?').bind(key).first<{ value: string | null }>();
  return row?.value ?? null;
}

export async function getAllConfig(db: D1Database): Promise<Record<string, string>> {
  const rows = await db.prepare('SELECT key, value FROM system_config').all<{ key: string; value: string | null }>();
  const out: Record<string, string> = {};
  for (const row of rows.results ?? []) {
    if (row.value != null) out[row.key] = row.value;
  }
  return out;
}

export async function getAllConfigRows(db: D1Database): Promise<SystemConfigRow[]> {
  const rows = await db
    .prepare('SELECT key, value, description FROM system_config ORDER BY key')
    .all<{ key: string; value: string | null; description: string | null }>();
  return (rows.results ?? []).map((r) => ({
    key: r.key,
    value: r.value ?? '',
    description: r.description ?? null,
  }));
}

export async function setConfig(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      'INSERT INTO system_config (key, value, description) VALUES (?, ?, NULL) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .bind(key, value)
    .run();
}
