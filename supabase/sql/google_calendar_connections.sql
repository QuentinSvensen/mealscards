-- Table des connexions Google Calendar (tokens) — accès via service role des Edge Functions uniquement.
create table if not exists public.google_calendar_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  access_token text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.google_calendar_connections enable row level security;

-- États OAuth éphémères (callback navigateur sans JWT).
create table if not exists public.google_calendar_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null
);

alter table public.google_calendar_oauth_states enable row level security;

-- Pas de policies client : les Edge Functions utilisent la service role.
