-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.agent_automation (
  user_id uuid NOT NULL,
  order_updates boolean DEFAULT true,
  cancel_orders boolean DEFAULT true,
  automatic_refunds boolean DEFAULT false,
  historic_inbox_access boolean DEFAULT false,
  learn_from_edits boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  auto_draft_enabled boolean NOT NULL DEFAULT false,
  min_confidence numeric DEFAULT 0.6,
  CONSTRAINT agent_automation_pkey PRIMARY KEY (user_id),
  CONSTRAINT agent_automation_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.agent_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  file_name text NOT NULL,
  file_size bigint,
  storage_path text,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT agent_documents_pkey PRIMARY KEY (id),
  CONSTRAINT agent_documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.agent_persona (
  user_id uuid NOT NULL,
  signature text,
  scenario text,
  instructions text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT agent_persona_pkey PRIMARY KEY (user_id),
  CONSTRAINT agent_persona_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.agent_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  source_body text,
  linked_mail_id text,
  linked_mail_provider text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT agent_templates_pkey PRIMARY KEY (id),
  CONSTRAINT agent_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.ai_drafts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider = ANY (ARRAY['gmail'::text, 'outlook'::text])),
  source_message_id text NOT NULL,
  draft_id text NOT NULL,
  draft_url text,
  model text,
  confidence numeric,
  latency_ms integer,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT ai_drafts_pkey PRIMARY KEY (id),
  CONSTRAINT ai_drafts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.auto_reply_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  message_id text NOT NULL,
  provider text NOT NULL,
  decision text NOT NULL,
  reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  draft_id text,
  draft_url text,
  confidence numeric,
  model text,
  CONSTRAINT auto_reply_log_pkey PRIMARY KEY (id),
  CONSTRAINT auto_reply_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.mail_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider = ANY (ARRAY['gmail'::text, 'outlook'::text])),
  provider_email text,
  access_token_enc bytea NOT NULL,
  refresh_token_enc bytea,
  token_expires_at timestamp with time zone,
  gmail_history_id text,
  gmail_watch_expires_at timestamp with time zone,
  outlook_subscription_id text,
  outlook_subscription_expires_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT mail_accounts_pkey PRIMARY KEY (id),
  CONSTRAINT mail_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.mail_learning_profiles (
  mailbox_id uuid NOT NULL,
  user_id uuid NOT NULL,
  enabled boolean DEFAULT true,
  style_rules text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT mail_learning_profiles_pkey PRIMARY KEY (mailbox_id),
  CONSTRAINT mail_learning_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT mail_learning_profiles_mailbox_id_fkey FOREIGN KEY (mailbox_id) REFERENCES public.mail_accounts(id)
);
CREATE TABLE public.user_onboarding (
  user_id uuid NOT NULL,
  step_email_connected boolean DEFAULT false,
  step_shopify_connected boolean DEFAULT false,
  step_ai_configured boolean DEFAULT false,
  first_draft_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_onboarding_pkey PRIMARY KEY (user_id),
  CONSTRAINT user_onboarding_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.mail_threads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider = ANY (ARRAY['gmail'::text, 'outlook'::text])),
  provider_thread_id text,
  subject text,
  snippet text,
  last_message_at timestamp with time zone,
  unread_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT mail_threads_pkey PRIMARY KEY (id),
  CONSTRAINT mail_threads_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT mail_threads_mailbox_id_fkey FOREIGN KEY (mailbox_id) REFERENCES public.mail_accounts(id)
);
CREATE TABLE public.mail_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  thread_id uuid,
  provider text NOT NULL CHECK (provider = ANY (ARRAY['gmail'::text, 'outlook'::text])),
  provider_message_id text NOT NULL,
  subject text,
  snippet text,
  body_text text,
  body_html text,
  ai_draft_text text,
  from_name text,
  from_email text,
  to_emails text[],
  cc_emails text[],
  bcc_emails text[],
  is_read boolean NOT NULL DEFAULT false,
  sent_at timestamp with time zone,
  received_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT mail_messages_pkey PRIMARY KEY (id),
  CONSTRAINT mail_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT mail_messages_mailbox_id_fkey FOREIGN KEY (mailbox_id) REFERENCES public.mail_accounts(id),
  CONSTRAINT mail_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.mail_threads(id)
);
CREATE TABLE public.mail_attachments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  message_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider = ANY (ARRAY['gmail'::text, 'outlook'::text])),
  provider_attachment_id text,
  filename text,
  mime_type text,
  size_bytes bigint,
  storage_path text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT mail_attachments_pkey PRIMARY KEY (id),
  CONSTRAINT mail_attachments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT mail_attachments_mailbox_id_fkey FOREIGN KEY (mailbox_id) REFERENCES public.mail_accounts(id),
  CONSTRAINT mail_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.mail_messages(id)
);
-- Gemmer historik så gmail-poll ikke laver duplikerede drafts
CREATE TABLE public.gmail_poll_state (
  clerk_user_id text NOT NULL,
  last_message_id text,
  last_internal_date bigint,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT gmail_poll_state_pkey PRIMARY KEY (clerk_user_id)
);
CREATE TABLE public.mail_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider = ANY (ARRAY['gmail'::text, 'outlook'::text])),
  message_id text NOT NULL,
  thread_id text,
  payload jsonb,
  status USER-DEFINED NOT NULL DEFAULT 'queued'::job_status,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT mail_jobs_pkey PRIMARY KEY (id),
  CONSTRAINT mail_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clerk_user_id text NOT NULL UNIQUE,
  email text,
  first_name text,
  last_name text,
  image_url text,
  signature text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  user_id uuid NOT NULL UNIQUE,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.shops (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_domain text NOT NULL UNIQUE,
  team_name text,
  access_token_encrypted bytea NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  owner_user_id uuid NOT NULL,
  agent_active boolean DEFAULT false,
  last_mail_check timestamp with time zone,
  CONSTRAINT shops_pkey PRIMARY KEY (id),
  CONSTRAINT shops_owner_user_uuid_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id)
);

CREATE TABLE public.customer_lookup_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  platform text NOT NULL,
  cache_key text NOT NULL,
  email text,
  order_number text,
  data jsonb NOT NULL,
  source text,
  fetched_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT customer_lookup_cache_pkey PRIMARY KEY (id),
  CONSTRAINT customer_lookup_cache_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT customer_lookup_cache_unique UNIQUE (user_id, cache_key)
);

CREATE INDEX customer_lookup_cache_user_idx ON public.customer_lookup_cache(user_id);
CREATE INDEX customer_lookup_cache_expires_idx ON public.customer_lookup_cache(expires_at);

-- Simpel venteliste / landing page signup
CREATE TABLE public.landing_signups (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  source text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT landing_signups_pkey PRIMARY KEY (id)
);
