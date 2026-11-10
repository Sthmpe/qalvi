-- Milestone 5: a researcher-authored study setup on the existing studies table.
--
-- Objectives are an ordered JSONB array because each may carry an optional
-- predefined visual whose fields differ per visual type (the same reason
-- visual_displays.definition is JSONB). Deep visual validation lives in the
-- application validator and is repeated by the agent before anything is shown;
-- the database enforces shape, bounds, identifiers, and the four allowed types.
-- Row level security and policies are unchanged: members read and edit their
-- workspace's studies; nobody else can.

create function private.valid_study_objectives(objectives jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(objectives) = 'array'
    and jsonb_array_length(objectives) <= 10
    and not exists (
      select 1 from jsonb_array_elements(objectives) item
      where jsonb_typeof(item) <> 'object'
         or exists (select 1 from jsonb_object_keys(item) k
                    where k not in ('id', 'topic', 'priority', 'visual'))
         or jsonb_typeof(item -> 'id') is distinct from 'string'
         or (item ->> 'id') !~ '^[a-z0-9_]{1,40}$'
         or jsonb_typeof(item -> 'topic') is distinct from 'string'
         or char_length(btrim(item ->> 'topic')) not between 1 and 300
         or (item ->> 'priority') is null
         or (item ->> 'priority') not in ('high', 'low')
         or (item ? 'visual' and jsonb_typeof(item -> 'visual') not in ('null', 'object'))
         or (jsonb_typeof(item -> 'visual') = 'object' and (
               (item -> 'visual' ->> 'type') is null
               or (item -> 'visual' ->> 'type') not in
                  ('comparison_cards', 'bar_chart', 'slider', 'multiple_choice')
               or char_length(btrim(coalesce(item -> 'visual' ->> 'prompt', ''))) not between 1 and 300
               or (item -> 'visual' ->> 'id') is distinct from 'study-' || (item ->> 'id')
               or length((item -> 'visual')::text) > 4000))
    )
    and (select count(distinct item ->> 'id') from jsonb_array_elements(objectives) item)
        = jsonb_array_length(objectives)
$$;

create function private.valid_study_assumptions(assumptions text[])
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(cardinality(assumptions), 0) <= 10
    and not exists (
      select 1 from unnest(assumptions) a
      where a is null or char_length(btrim(a)) not between 1 and 300
    )
$$;

alter table public.studies
  add column objectives jsonb not null default '[]'::jsonb,
  add column assumptions text[] not null default '{}'::text[];

alter table public.studies
  add constraint studies_objectives_check check (private.valid_study_objectives(objectives)),
  add constraint studies_assumptions_check check (private.valid_study_assumptions(assumptions)),
  add constraint studies_text_bounds_check check (
    (description is null or char_length(description) <= 500) and
    (research_goal is null or char_length(research_goal) <= 1200) and
    (audience is null or char_length(audience) <= 300)
  ) not valid,
  -- An interview needs something to pursue. Rows that predate this rule are not
  -- rechecked; any insert or update from now on is.
  add constraint studies_active_setup_check check (
    status <> 'active' or (
      char_length(btrim(coalesce(research_goal, ''))) > 0 and
      char_length(btrim(coalesce(audience, ''))) > 0 and
      jsonb_array_length(objectives) >= 1
    )
  ) not valid;

grant insert (objectives, assumptions) on public.studies to authenticated;
grant update (objectives, assumptions) on public.studies to authenticated;
