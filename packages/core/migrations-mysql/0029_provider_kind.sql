-- Provider kind: stable import-template name (or __custom__). Empty string means unclassified.
-- name stays the account alias. Uniqueness is (name, kind), not name alone.
-- kind is VARCHAR so the composite unique index stays within the InnoDB key length limit.

ALTER TABLE providers ADD COLUMN kind VARCHAR(128) NOT NULL DEFAULT '';

ALTER TABLE providers DROP INDEX uk_providers_name;

ALTER TABLE providers ADD UNIQUE KEY uk_providers_name_kind (name, kind);
