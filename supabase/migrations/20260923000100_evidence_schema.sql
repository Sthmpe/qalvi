-- M4 Stage 1, part 1 of 3: the evidence schema.
--
--   Study -> Participant -> Conversation -> Raw Evidence -> Derived Findings
--
-- Raw evidence (messages, visual displays, visual responses) is the source of
-- truth. Findings are derived from it and point back at exact messages.
--
-- Fail closed: every table is created with row level security enabled and the
-- Supabase default grants to `anon` and `authenticated` revoked. Until the
-- access policies migration runs, no client role can read or write anything.
--
-- Tenancy is enforced structurally. Every row below a study carries its
-- `workspace_id` and `study_id`, and each child references its parent through a
-- composite key that includes both. A row can therefore never point at a
-- parent in another study or workspace, regardless of policy mistakes.

create schema if not exists private;
revoke all on schema private from public;
comment on schema private is
  'Internal helpers for policies and triggers. Not exposed through the Data API.';

-- ---------------------------------------------------------------------------
-- People and workspaces
-- ---------------------------------------------------------------------------

-- Researchers and team members only. Participants are never auth users.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workspaces_created_by_idx on public.workspaces (created_by);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
-- "Which workspaces am I in?" The primary key already serves the reverse lookup.
create index workspace_members_user_idx on public.workspace_members (user_id);

-- ---------------------------------------------------------------------------
-- Studies and participants
-- ---------------------------------------------------------------------------

create table public.studies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text,
  research_goal text,
  audience text,
  category text,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'completed', 'archived')),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create index studies_workspace_idx on public.studies (workspace_id, created_at desc);
create index studies_created_by_idx on public.studies (created_by);

-- A pseudonymous participant within one study. There is deliberately no name,
-- email, phone, or other contact column: researchers see an alias. The same
-- person taking part in two studies is two unlinked participants.
create table public.participants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  study_id uuid not null,
  alias text not null check (char_length(btrim(alias)) between 1 and 60),
  segment text check (segment is null or char_length(segment) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (study_id, workspace_id)
    references public.studies (id, workspace_id) on delete cascade,
  unique (study_id, alias),
  unique (id, study_id, workspace_id)
);
comment on table public.participants is
  'Pseudonymous participant in one study. Holds no direct identifiers by design.';

-- ---------------------------------------------------------------------------
-- Conversations and raw evidence
-- ---------------------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  study_id uuid not null,
  participant_id uuid not null,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'interrupted', 'failed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  -- The LiveKit room that carried the conversation. An explicit rejoin reuses
  -- the room name, so it maps back to the same conversation.
  livekit_room text check (livekit_room is null or char_length(livekit_room) <= 200),
  -- Provenance of the AI interviewer (providers, models, prompt version). Its
  -- shape follows the provider, so it is JSONB; it never holds participant data.
  interviewer_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(interviewer_metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (participant_id, study_id, workspace_id)
    references public.participants (id, study_id, workspace_id) on delete cascade,
  check (ended_at is null or ended_at >= started_at),
  unique (id, study_id, workspace_id)
);
create index conversations_study_idx on public.conversations (study_id, started_at desc);
create index conversations_participant_idx on public.conversations (participant_id);
create unique index conversations_livekit_room_key
  on public.conversations (livekit_room) where livekit_room is not null;

-- Raw evidence: every final utterance, typed message, and on-screen answer, in
-- order, exactly as received. Never updated (see the evidence integrity
-- migration). An on-screen answer is a participant message on the `visual`
-- channel whose content is the plain summary the participant saw confirmed,
-- without the `[On screen]` transport marker.
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  study_id uuid not null,
  conversation_id uuid not null,
  sequence integer not null check (sequence >= 0),
  speaker text not null check (speaker in ('participant', 'interviewer')),
  channel text not null check (channel in ('voice', 'text', 'visual')),
  content text not null check (btrim(content) <> ''),
  occurred_at timestamptz not null,
  -- Stable LiveKit segment or stream id, so a retried write cannot duplicate evidence.
  transport_segment_id text check (transport_segment_id is null or char_length(transport_segment_id) <= 200),
  -- Language-neutral search: participants may not write in English.
  content_search tsvector generated always as (to_tsvector('simple', content)) stored,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, study_id, workspace_id)
    references public.conversations (id, study_id, workspace_id) on delete cascade,
  check (channel <> 'visual' or speaker = 'participant'),
  unique (conversation_id, sequence),
  unique (id, study_id, workspace_id),
  unique (id, conversation_id, channel)
);
create unique index messages_transport_segment_key
  on public.messages (conversation_id, transport_segment_id)
  where transport_segment_id is not null;
create index messages_study_speaker_idx on public.messages (study_id, speaker);
create index messages_search_idx on public.messages using gin (content_search);

-- What was put on the participant's screen, as it was shown. A response is only
-- interpretable against the exact options offered, and a display with no
-- response (a chart, a skipped question) is still evidence of what was shown.
create table public.visual_displays (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  study_id uuid not null,
  conversation_id uuid not null,
  action_id text not null check (char_length(action_id) between 1 and 200),
  visual_type text not null
    check (visual_type in ('comparison_cards', 'bar_chart', 'slider', 'multiple_choice')),
  prompt text not null check (btrim(prompt) <> ''),
  -- The validated display action exactly as rendered. Its shape differs per
  -- visual type (options, bars, slider bounds), so it is JSONB; the fields that
  -- are searched on are also relational columns and must agree with it.
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  shown_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, study_id, workspace_id)
    references public.conversations (id, study_id, workspace_id) on delete cascade,
  check (
    definition ->> 'id' = action_id
    and definition ->> 'type' = visual_type
    and definition ->> 'prompt' = prompt
  ),
  unique (conversation_id, action_id),
  unique (id, conversation_id, visual_type)
);
create index visual_displays_study_type_idx on public.visual_displays (study_id, visual_type);

-- The structured answer to a display. Always paired with the participant
-- message that recorded it, so transcript order and structured value can never
-- drift apart, and findings cite both through that one message.
create table public.visual_responses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  study_id uuid not null,
  conversation_id uuid not null,
  display_id uuid not null,
  message_id uuid not null,
  -- Charts are read, not answered, so they have no response type.
  visual_type text not null check (visual_type in ('comparison_cards', 'slider', 'multiple_choice')),
  -- Pins the linked message to the visual channel through the foreign key below.
  message_channel text not null default 'visual' check (message_channel = 'visual'),
  selected_option_ids text[] not null default '{}',
  numeric_value numeric,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, study_id, workspace_id)
    references public.conversations (id, study_id, workspace_id) on delete cascade,
  foreign key (display_id, conversation_id, visual_type)
    references public.visual_displays (id, conversation_id, visual_type) on delete cascade,
  foreign key (message_id, conversation_id, message_channel)
    references public.messages (id, conversation_id, channel) on delete cascade,
  check (
    (visual_type = 'comparison_cards' and cardinality(selected_option_ids) = 1 and numeric_value is null)
    or (visual_type = 'multiple_choice' and cardinality(selected_option_ids) >= 1 and numeric_value is null)
    or (visual_type = 'slider' and cardinality(selected_option_ids) = 0 and numeric_value is not null)
  ),
  -- One confirmed answer per display, as the participant room enforces.
  unique (display_id),
  unique (message_id)
);
create index visual_responses_conversation_idx on public.visual_responses (conversation_id);
create index visual_responses_study_type_idx on public.visual_responses (study_id, visual_type);
create index visual_responses_options_idx on public.visual_responses using gin (selected_option_ids);

-- ---------------------------------------------------------------------------
-- Derived findings
-- ---------------------------------------------------------------------------

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  study_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  summary text,
  category text not null default 'other'
    check (category in ('behaviour', 'pain_point', 'alternative', 'objection',
                        'willingness_to_pay', 'tradeoff', 'preference', 'commitment', 'other')),
  origin text not null default 'researcher' check (origin in ('researcher', 'ai')),
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'rejected')),
  -- Model, prompt version, and confidence for AI-derived findings only.
  ai_metadata jsonb check (ai_metadata is null or jsonb_typeof(ai_metadata) = 'object'),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (study_id, workspace_id)
    references public.studies (id, workspace_id) on delete cascade,
  check (origin = 'ai' or ai_metadata is null),
  unique (id, study_id, workspace_id)
);
create index findings_study_status_idx on public.findings (study_id, status);
create index findings_created_by_idx on public.findings (created_by);

-- The link from an interpretation back to exact evidence. A finding can cite
-- many messages, a message can support many findings, and a link can record
-- counter-evidence. Both sides must be in the same study.
--
-- Deleting a cited message on its own is refused (NO ACTION), so evidence can
-- never disappear from under a finding. Deleting the whole study still works,
-- because its findings and their links go in the same statement.
create table public.finding_evidence (
  finding_id uuid not null,
  message_id uuid not null,
  workspace_id uuid not null,
  study_id uuid not null,
  relation text not null default 'supports' check (relation in ('supports', 'contradicts')),
  note text check (note is null or char_length(note) <= 1000),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (finding_id, message_id),
  foreign key (finding_id, study_id, workspace_id)
    references public.findings (id, study_id, workspace_id) on delete cascade,
  foreign key (message_id, study_id, workspace_id)
    references public.messages (id, study_id, workspace_id) on delete no action
);
-- "Which findings cite this message?", and the check behind the NO ACTION rule.
create index finding_evidence_message_idx on public.finding_evidence (message_id);
create index finding_evidence_created_by_idx on public.finding_evidence (created_by);

-- ---------------------------------------------------------------------------
-- Fail closed
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.studies enable row level security;
alter table public.participants enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.visual_displays enable row level security;
alter table public.visual_responses enable row level security;
alter table public.findings enable row level security;
alter table public.finding_evidence enable row level security;

-- Supabase grants every new public table to anon and authenticated by default.
-- Take that back; the access policies migration grants exactly what is needed.
revoke all on
  public.profiles, public.workspaces, public.workspace_members, public.studies,
  public.participants, public.conversations, public.messages, public.visual_displays,
  public.visual_responses, public.findings, public.finding_evidence
from anon, authenticated;
