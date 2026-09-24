-- M4 Stage 1, part 2 of 3: evidence integrity.
--
-- These rules hold for every role, including the service role, because they
-- are triggers and constraints rather than policies:
--   * raw evidence is never rewritten;
--   * a visual answer must match what was actually shown;
--   * a finding must always cite at least one supporting message.

-- ---------------------------------------------------------------------------
-- Raw evidence is immutable
-- ---------------------------------------------------------------------------

-- A correction is a new message, never an edit. Only final transcript segments
-- are persisted, so there is no interim text to update later.
create function private.reject_evidence_rewrite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'raw evidence in % is immutable: record new evidence instead of changing it',
    tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

create trigger messages_are_immutable
  before update on public.messages
  for each row execute function private.reject_evidence_rewrite();
create trigger visual_displays_are_immutable
  before update on public.visual_displays
  for each row execute function private.reject_evidence_rewrite();
create trigger visual_responses_are_immutable
  before update on public.visual_responses
  for each row execute function private.reject_evidence_rewrite();

-- ---------------------------------------------------------------------------
-- A visual answer must match what was shown
-- ---------------------------------------------------------------------------

-- Security definer so the comparison always runs, whoever inserts the answer.
create function private.check_visual_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  shown jsonb;
  offered text[];
begin
  select d.definition into shown from public.visual_displays d where d.id = new.display_id;
  if shown is null then
    return new; -- the foreign key reports a missing display
  end if;
  if shown ->> 'type' <> new.visual_type then
    raise exception 'visual response type does not match the display that was shown'
      using errcode = 'check_violation';
  end if;

  if new.visual_type = 'slider' then
    if new.numeric_value < (shown ->> 'min')::numeric
       or new.numeric_value > (shown ->> 'max')::numeric then
      raise exception 'visual response is outside the slider range that was shown'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select coalesce(array_agg(option ->> 'id'), '{}')
    into offered
    from jsonb_array_elements(coalesce(shown -> 'options', '[]'::jsonb)) as option;

  if not new.selected_option_ids <@ offered then
    raise exception 'visual response selects an option that was not shown'
      using errcode = 'check_violation';
  end if;
  if cardinality(new.selected_option_ids)
     <> (select count(distinct id) from unnest(new.selected_option_ids) as id) then
    raise exception 'visual response selects the same option twice'
      using errcode = 'check_violation';
  end if;
  if new.visual_type = 'multiple_choice'
     and coalesce((shown ->> 'multiple')::boolean, false) = false
     and cardinality(new.selected_option_ids) > 1 then
    raise exception 'visual response selects several options where only one was allowed'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger visual_responses_match_display
  before insert on public.visual_responses
  for each row execute function private.check_visual_response();

-- ---------------------------------------------------------------------------
-- A finding always cites supporting evidence
-- ---------------------------------------------------------------------------

-- Checked at commit, so a finding and its first evidence links are written in
-- one transaction (see public.create_finding). Removing or recasting the last
-- supporting link is refused unless the finding itself goes too.
create function private.require_supporting_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if tg_table_name = 'findings' then
    target := new.id;
  else
    target := old.finding_id;
  end if;

  if exists (select 1 from public.findings f where f.id = target)
     and not exists (
       select 1 from public.finding_evidence e
       where e.finding_id = target and e.relation = 'supports'
     ) then
    raise exception 'finding % must cite at least one supporting message', target
      using errcode = 'integrity_constraint_violation';
  end if;
  return null;
end;
$$;

create constraint trigger findings_require_supporting_evidence
  after insert on public.findings
  deferrable initially deferred
  for each row execute function private.require_supporting_evidence();

create constraint trigger finding_evidence_keeps_support
  after update or delete on public.finding_evidence
  deferrable initially deferred
  for each row execute function private.require_supporting_evidence();

-- ---------------------------------------------------------------------------
-- Housekeeping
-- ---------------------------------------------------------------------------

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger workspaces_touch_updated_at before update on public.workspaces
  for each row execute function private.touch_updated_at();
create trigger studies_touch_updated_at before update on public.studies
  for each row execute function private.touch_updated_at();
create trigger participants_touch_updated_at before update on public.participants
  for each row execute function private.touch_updated_at();
create trigger conversations_touch_updated_at before update on public.conversations
  for each row execute function private.touch_updated_at();
create trigger findings_touch_updated_at before update on public.findings
  for each row execute function private.touch_updated_at();

-- Every researcher account gets a profile. Participants never sign in, so this
-- only ever runs for team members.
create function private.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(left(btrim(coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      ''
    )), 120), '')
  );
  return new;
end;
$$;

create trigger create_profile_for_new_user
  after insert on auth.users
  for each row execute function private.create_profile_for_new_user();
