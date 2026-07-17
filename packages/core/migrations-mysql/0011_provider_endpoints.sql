-- Phase 1: add providers.endpoints JSON; backfill from base_url_*; keep legacy columns.
ALTER TABLE providers ADD COLUMN endpoints TEXT NULL;

UPDATE providers
SET endpoints = NULLIF(
	CONCAT(
		'{',
		CONCAT_WS(
			',',
			IF(
				base_url_openai IS NOT NULL AND TRIM(base_url_openai) <> '',
				CONCAT('"openai":{"base":', JSON_QUOTE(TRIM(base_url_openai)), '}'),
				NULL
			),
			IF(
				base_url_anthropic IS NOT NULL AND TRIM(base_url_anthropic) <> '',
				CONCAT('"anthropic":{"base":', JSON_QUOTE(TRIM(base_url_anthropic)), '}'),
				NULL
			),
			IF(
				base_url_gemini IS NOT NULL AND TRIM(base_url_gemini) <> '',
				CONCAT('"gemini":{"base":', JSON_QUOTE(TRIM(base_url_gemini)), '}'),
				NULL
			)
		),
		'}'
	),
	'{}'
);
