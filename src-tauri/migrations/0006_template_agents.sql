-- Silent v2.4: expert (template) agents — not bound to one repo, carry run defaults (kit, pool, pins, cost).
ALTER TABLE repo_agents ADD COLUMN run_defaults_json TEXT;
ALTER TABLE repo_agents ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0;
