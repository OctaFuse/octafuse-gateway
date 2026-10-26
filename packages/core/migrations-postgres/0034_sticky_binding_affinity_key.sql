-- Provider 粘性绑定记录明文 affinity_key（userId|modelId|routeGroup|protocol），
-- 让后台能直接列出「当前有哪些用户粘在哪个 Provider」，而不必先知道邮箱再反查哈希。
-- 旧行为 NULL：下一次命中并续期时由 Proxy 补全，最迟在粘性 TTL 到期后自然消失。
SET search_path TO octafuse_gateway;

ALTER TABLE route_pool_sticky_bindings ADD COLUMN IF NOT EXISTS affinity_key TEXT;
