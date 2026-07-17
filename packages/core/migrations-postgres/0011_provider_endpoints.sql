-- Phase 1: add providers.endpoints JSON; backfill from base_url_*; keep legacy columns.
ALTER TABLE providers ADD COLUMN endpoints TEXT;

UPDATE providers
SET endpoints = nullif(
	jsonb_strip_nulls(
		jsonb_build_object(
			'openai',
			CASE
				WHEN base_url_openai IS NOT NULL AND btrim(base_url_openai) <> ''
				THEN jsonb_build_object('base', btrim(base_url_openai))
				ELSE NULL
			END,
			'anthropic',
			CASE
				WHEN base_url_anthropic IS NOT NULL AND btrim(base_url_anthropic) <> ''
				THEN jsonb_build_object('base', btrim(base_url_anthropic))
				ELSE NULL
			END,
			'gemini',
			CASE
				WHEN base_url_gemini IS NOT NULL AND btrim(base_url_gemini) <> ''
				THEN jsonb_build_object('base', btrim(base_url_gemini))
				ELSE NULL
			END
		)
	)::text,
	'{}'
);
