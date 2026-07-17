-- Phase 1: add providers.endpoints JSON; backfill from base_url_*; keep legacy columns.
ALTER TABLE providers ADD COLUMN endpoints TEXT;

UPDATE providers
SET endpoints = nullif(
	json_patch(
		'{}',
		json_object(
			'openai',
			CASE
				WHEN base_url_openai IS NOT NULL AND length(trim(base_url_openai)) > 0
				THEN json_object('base', trim(base_url_openai))
				ELSE NULL
			END,
			'anthropic',
			CASE
				WHEN base_url_anthropic IS NOT NULL AND length(trim(base_url_anthropic)) > 0
				THEN json_object('base', trim(base_url_anthropic))
				ELSE NULL
			END,
			'gemini',
			CASE
				WHEN base_url_gemini IS NOT NULL AND length(trim(base_url_gemini)) > 0
				THEN json_object('base', trim(base_url_gemini))
				ELSE NULL
			END
		)
	),
	'{}'
);
