-- TTS 使用上游返回的有效计费字符数；该维度与 ASR 时长不同，必须独立记录。
ALTER TABLE api_key_request_logs ADD COLUMN audio_characters INT NULL;
