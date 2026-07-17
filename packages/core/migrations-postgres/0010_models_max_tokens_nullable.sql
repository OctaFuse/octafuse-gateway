-- Image-generation models have no chat max_tokens; allow NULL (LLM keeps DEFAULT 8192).
ALTER TABLE models ALTER COLUMN max_tokens DROP NOT NULL;
