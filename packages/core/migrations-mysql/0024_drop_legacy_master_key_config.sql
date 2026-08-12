-- Remove historical system_config.MASTER_KEY after migration to admin_api_keys (0023).
-- Auth no longer reads this row; legacy callers use admin_api_keys.legacy-master until rotated.

DELETE FROM system_config WHERE `key` = 'MASTER_KEY';
