-- Silent v2: CLI-native. Chats carry their CLI + session; demo/mock rows from v1 are removed.
ALTER TABLE chats ADD COLUMN provider_id TEXT NOT NULL DEFAULT 'codex';
ALTER TABLE chats ADD COLUMN session_id TEXT;
ALTER TABLE repo_agents ADD COLUMN provider_id TEXT NOT NULL DEFAULT 'codex';
ALTER TABLE repo_agents ADD COLUMN model_id TEXT NOT NULL DEFAULT '';
ALTER TABLE repo_agents ADD COLUMN fallback_model_refs_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE messages ADD COLUMN provider_id TEXT;
ALTER TABLE messages ADD COLUMN cost_usd REAL;
DELETE FROM messages WHERE chat_id IN ('chat_1','chat_2','chat_3','chat_4');
DELETE FROM chats WHERE id IN ('chat_1','chat_2','chat_3','chat_4');
DELETE FROM repo_agents WHERE id IN ('agent_reach','agent_cube_risk','agent_terminal');
DELETE FROM terminal_lines WHERE run_id IN ('run_notify','run_diffusion','run_nan');
DELETE FROM runs WHERE id IN ('run_notify','run_diffusion','run_nan');
DELETE FROM memory_entries WHERE id LIKE 'mem_%';
DELETE FROM activity;
DELETE FROM kv WHERE key = 'seeded.v1';
