-- Image-generation models have no chat max_tokens; allow NULL (LLM keeps DEFAULT 8192).
ALTER TABLE models MODIFY max_tokens INT NULL DEFAULT 8192;
