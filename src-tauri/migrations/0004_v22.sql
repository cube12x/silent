-- Silent v2.2: AI planning, project chats, develop mode.
ALTER TABLE runs ADD COLUMN plan_source TEXT;
ALTER TABLE runs ADD COLUMN parent_run_id TEXT;
ALTER TABLE runs ADD COLUMN report_json TEXT;
ALTER TABLE runs ADD COLUMN questions_json TEXT;
ALTER TABLE chats ADD COLUMN run_id TEXT;
ALTER TABLE repo_agents ADD COLUMN source_run_id TEXT;
