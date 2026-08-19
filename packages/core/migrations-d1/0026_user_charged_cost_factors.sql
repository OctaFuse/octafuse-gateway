-- Per-user Charged cost factor map (catalog models.id → factor). JSON object or NULL.
ALTER TABLE users ADD COLUMN charged_cost_factors TEXT DEFAULT NULL;
