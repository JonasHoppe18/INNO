-- Legacy user-scoped persona/style tables. Runtime persona and style
-- configuration now lives in workspace_agent_settings and the v2 feedback/
-- ticket-example pipeline.
drop table if exists public.agent_persona;
drop table if exists public.mail_learning_profiles;
