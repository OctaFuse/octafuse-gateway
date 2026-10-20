-- Split mixed DashScope audio conversion adapters by model family.
-- CosyVoice stays on dashscope-tts-speech. Unmatched dashscope-asr-file-async rows are left for operators.

UPDATE model_routes
SET adapter = 'dashscope-tts-qwen-audio'
WHERE adapter = 'dashscope-tts-speech'
	AND lower(provider_model_name) LIKE 'qwen-audio-%';

UPDATE model_routes
SET adapter = 'dashscope-asr-qwen-audio-file-async'
WHERE adapter = 'dashscope-asr-file-async'
	AND lower(provider_model_name) LIKE 'qwen-audio-%';

UPDATE model_routes
SET adapter = 'dashscope-asr-qwen-file-async'
WHERE adapter = 'dashscope-asr-file-async'
	AND lower(provider_model_name) LIKE 'qwen3-%';

UPDATE model_routes
SET adapter = 'dashscope-asr-fun-async'
WHERE adapter = 'dashscope-asr-file-async'
	AND (
		lower(provider_model_name) = 'fun-asr'
		OR lower(provider_model_name) LIKE 'fun-asr-2%'
	);

UPDATE model_routes
SET adapter = 'dashscope-asr-paraformer-async'
WHERE adapter = 'dashscope-asr-file-async'
	AND lower(provider_model_name) LIKE 'paraformer-v%';
