-- 按操作主体检索用户审计：actor_id 形如 console:<username> / admin_key:<uuid> /
-- system:gateway / service:user_provision，支持精确匹配与 '<kind>:%' 前缀匹配。
CREATE INDEX idx_user_audit_actor_created
  ON user_audit_logs(actor_id, created_at);
