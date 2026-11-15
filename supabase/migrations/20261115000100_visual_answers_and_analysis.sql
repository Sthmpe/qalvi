-- Release work: tap-to-answer visual evidence in real interviews, and durable,
-- retryable interview analysis whose findings always cite canonical messages.

-- ---------------------------------------------------------------------------
-- Visual answers join the control-before-reply protocol
-- ---------------------------------------------------------------------------
-- A structured on-screen answer is a participant turn like any other: the agent
-- must record its control decision before replying, and a replacement worker
-- must be able to replay it. The answer message therefore carries the same
-- protocol marker as a spoken or typed turn.

alter table public.messages drop constraint messages_control_protocol_version_check;
alter table public.messages add constraint messages_control_protocol_version_check
  check (control_protocol_version is null or
         (control_protocol_version = 1 and speaker = 'participant'
          and channel in ('voice', 'text', 'visual')));

create or replace function public.append_interview_visual_response(
  p_conversation_id uuid, p_writer_generation bigint, p_event_key text,
  p_action_id text, p_content text, p_occurred_at timestamptz,
  p_selected_option_ids text[] default '{}', p_numeric_value numeric default null
)
returns table(message_id uuid, message_sequence integer, inserted boolean)
language plpgsql security definer set search_path = '' as $$
declare c public.conversations%rowtype; d public.visual_displays%rowtype;
  existing public.messages%rowtype; answer public.visual_responses%rowtype;
  allocated integer; created uuid;
begin
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found or c.writer_generation <> p_writer_generation or c.status <> 'in_progress' or
     c.consented_at is null then
    raise exception 'conversation is not writable by this generation'
      using errcode = 'insufficient_privilege';
  end if;
  select * into d from public.visual_displays
    where conversation_id = p_conversation_id and action_id = p_action_id and rendered_at is not null;
  if not found then raise exception 'visual action was not rendered' using errcode = 'check_violation'; end if;
  select * into existing from public.messages m
    where m.conversation_id = p_conversation_id and m.transport_segment_id = p_event_key;
  if found then
    select * into answer from public.visual_responses v where v.message_id = existing.id;
    if existing.speaker <> 'participant' or existing.channel <> 'visual' or
       existing.content is distinct from p_content or existing.occurred_at is distinct from p_occurred_at or
       answer.display_id is distinct from d.id or
       answer.selected_option_ids is distinct from p_selected_option_ids or
       answer.numeric_value is distinct from p_numeric_value then
      raise exception 'event key reused with conflicting visual answer'
        using errcode = 'unique_violation';
    end if;
    return query select existing.id, existing.sequence, false;
    return;
  end if;
  if c.status <> 'in_progress' then
    raise exception 'conversation is not writable by this generation'
      using errcode = 'insufficient_privilege';
  end if;
  update public.conversations set next_message_sequence = next_message_sequence + 1
    where id = p_conversation_id returning next_message_sequence - 1 into allocated;
  insert into public.messages(workspace_id, study_id, conversation_id, sequence,
    speaker, channel, content, occurred_at, transport_segment_id, control_protocol_version)
  values(c.workspace_id, c.study_id, p_conversation_id, allocated,
    'participant', 'visual', p_content, p_occurred_at, p_event_key, 1)
  returning id into created;
  insert into public.visual_responses(workspace_id, study_id, conversation_id,
    display_id, message_id, visual_type, selected_option_ids, numeric_value)
  values(c.workspace_id, c.study_id, p_conversation_id,
    d.id, created, d.visual_type, p_selected_option_ids, p_numeric_value);
  return query select created, allocated, true;
end;
$$;

create or replace function public.record_interview_turn_control(
  p_conversation_id uuid, p_writer_generation bigint, p_message_id uuid,
  p_signals jsonb, p_decision_action text, p_state_sha256 text,
  p_methodology_version text default 'real-default-v1'
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.conversations%rowtype; source public.messages%rowtype;
  existing public.interview_turn_controls%rowtype;
begin
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found or c.writer_generation <> p_writer_generation or c.status <> 'in_progress' then
    raise exception 'conversation is not writable by this generation'
      using errcode = 'insufficient_privilege';
  end if;
  select * into source from public.messages
    where id = p_message_id and conversation_id = p_conversation_id;
  if not found or source.speaker <> 'participant' or
     source.channel not in ('voice', 'text', 'visual') or source.control_protocol_version is distinct from 1 then
    raise exception 'control record requires a versioned participant message'
      using errcode = 'check_violation';
  end if;
  if coalesce(p_methodology_version, '') not in ('real-default-v1', 'study-plan-v1') or
     char_length(btrim(coalesce(p_decision_action, ''))) not between 1 and 80 or
     coalesce(p_state_sha256, '') !~ '^[0-9a-f]{64}$' or
     jsonb_typeof(p_signals) <> 'object' or length(p_signals::text) > 1500 or
     not (p_signals ?& array['intent','engagement','covered','partial','probe','ambiguous']) or
     exists (select 1 from jsonb_object_keys(p_signals) k
             where k not in ('intent','engagement','covered','partial','probe','ambiguous')) or
     jsonb_typeof(p_signals -> 'intent') <> 'string' or
     jsonb_typeof(p_signals -> 'engagement') <> 'string' or
     p_signals ->> 'intent' not in ('continue','concern','fatigue','time_left','stop','skip',
       'detour','question','unclear','resume','visuals') or
     p_signals ->> 'engagement' not in ('engaged','neutral','low') or
     jsonb_typeof(p_signals -> 'covered') <> 'array' or
     jsonb_typeof(p_signals -> 'partial') <> 'array' or
     exists (select 1 from jsonb_array_elements(p_signals -> 'covered') item
             where jsonb_typeof(item) <> 'string') or
     exists (select 1 from jsonb_array_elements(p_signals -> 'partial') item
             where jsonb_typeof(item) <> 'string') or
     jsonb_typeof(p_signals -> 'ambiguous') <> 'boolean' or
     jsonb_typeof(p_signals -> 'probe') not in ('boolean', 'null') then
    raise exception 'invalid deterministic control record' using errcode = 'check_violation';
  end if;
  select * into existing from public.interview_turn_controls where message_id = p_message_id;
  if found then
    if existing.conversation_id <> p_conversation_id or existing.schema_version <> 1 or
       existing.methodology_version <> p_methodology_version or
       existing.signals <> p_signals or existing.decision_action <> p_decision_action or
       existing.state_sha256 <> p_state_sha256 then
      raise exception 'conflicting control record for participant message'
        using errcode = 'unique_violation';
    end if;
    return existing.message_id;
  end if;
  insert into public.interview_turn_controls(message_id, conversation_id, schema_version,
    methodology_version, signals, decision_action, state_sha256)
  values (p_message_id, p_conversation_id, 1,
          p_methodology_version, p_signals, p_decision_action, p_state_sha256);
  return p_message_id;
end;
$$;

create or replace function private.guard_interview_turn_control()
returns trigger language plpgsql security definer set search_path = '' as $$
declare source public.messages%rowtype;
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.messages where id = old.message_id) then
      raise exception 'interview control records are immutable' using errcode = 'restrict_violation';
    end if;
    return old; -- only the canonical parent's foreign-key cascade can reach here
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'interview control records are immutable' using errcode = 'restrict_violation';
  end if;
  select * into source from public.messages
    where id = new.message_id and conversation_id = new.conversation_id;
  if not found or source.speaker <> 'participant' or
     source.channel not in ('voice', 'text', 'visual') or source.control_protocol_version is distinct from 1 then
    raise exception 'control record requires a versioned participant message'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.append_interview_visual_response(uuid,bigint,text,text,text,timestamptz,text[],numeric)
  from public, anon, authenticated;
grant execute on function public.append_interview_visual_response(uuid,bigint,text,text,text,timestamptz,text[],numeric)
  to service_role;
revoke all on function public.record_interview_turn_control(uuid,bigint,uuid,jsonb,text,text,text)
  from public, anon, authenticated;
grant execute on function public.record_interview_turn_control(uuid,bigint,uuid,jsonb,text,text,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Interview analysis: derived, optional, and never a substitute for evidence
-- ---------------------------------------------------------------------------
-- One row per conversation records whether analysis ran, failed, or is running.
-- The transcript stays fully usable whatever this row says.

create table public.conversation_analyses (
  conversation_id uuid primary key,
  workspace_id uuid not null,
  study_id uuid not null,
  status text not null check (status in ('processing', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  error text check (error is null or char_length(error) <= 300),
  summary text check (summary is null or char_length(summary) <= 1200),
  objective_coverage jsonb not null default '[]'::jsonb
    check (jsonb_typeof(objective_coverage) = 'array' and length(objective_coverage::text) <= 8000),
  model text check (model is null or char_length(model) <= 120),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (conversation_id, study_id, workspace_id)
    references public.conversations (id, study_id, workspace_id) on delete cascade
);
create index conversation_analyses_study_idx on public.conversation_analyses (study_id);
alter table public.conversation_analyses enable row level security;
revoke all on public.conversation_analyses from public, anon, authenticated;
grant select on public.conversation_analyses to authenticated;
grant select, insert, update, delete on public.conversation_analyses to service_role;
create policy "Analyses are visible to members"
  on public.conversation_analyses for select to authenticated
  using (private.is_workspace_member(workspace_id));

-- Start (or restart) analysis. Returns false while another run is in flight,
-- so two requests never analyse the same interview at once. A run that has
-- been "processing" for over three minutes is treated as abandoned.
create function public.begin_conversation_analysis(p_conversation_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare c public.conversations%rowtype; a public.conversation_analyses%rowtype;
begin
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found then
    raise exception 'conversation not found' using errcode = 'no_data_found';
  end if;
  select * into a from public.conversation_analyses where conversation_id = p_conversation_id;
  if found and a.status = 'processing' and a.started_at > clock_timestamp() - interval '3 minutes' then
    return false;
  end if;
  insert into public.conversation_analyses(conversation_id, workspace_id, study_id, status, attempts, started_at)
  values (p_conversation_id, c.workspace_id, c.study_id, 'processing', 1, clock_timestamp())
  on conflict (conversation_id) do update
    set status = 'processing', attempts = public.conversation_analyses.attempts + 1,
        error = null, started_at = clock_timestamp(), updated_at = clock_timestamp();
  return true;
end;
$$;

create function public.fail_conversation_analysis(p_conversation_id uuid, p_error text)
returns void language sql security definer set search_path = '' as $$
  update public.conversation_analyses
  set status = 'failed', error = left(coalesce(p_error, 'Analysis failed'), 300),
      updated_at = clock_timestamp()
  where conversation_id = p_conversation_id and status = 'processing';
$$;

-- Save one analysis atomically. Every finding must cite at least one supporting
-- message, and every cited message must be a participant or interviewer message
-- of THIS conversation: an interpretation can never point at evidence it was
-- not derived from. Earlier AI proposals for the same conversation that the
-- researcher has not accepted or rejected are replaced; reviewed ones are kept.
create function public.complete_conversation_analysis(
  p_conversation_id uuid, p_summary text, p_objective_coverage jsonb, p_findings jsonb, p_model text
)
returns integer language plpgsql security definer set search_path = '' as $$
declare c public.conversations%rowtype; item jsonb; created uuid; saved integer := 0;
  supports uuid[]; contradicts uuid[];
begin
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found then
    raise exception 'conversation not found' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from public.conversation_analyses
                 where conversation_id = p_conversation_id and status = 'processing') then
    raise exception 'analysis is not in progress' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_findings) <> 'array' or jsonb_array_length(p_findings) > 12 or
     jsonb_typeof(p_objective_coverage) <> 'array' then
    raise exception 'invalid analysis' using errcode = 'check_violation';
  end if;
  delete from public.findings f
    where f.study_id = c.study_id and f.origin = 'ai' and f.status = 'proposed'
      and f.ai_metadata ->> 'conversation_id' = p_conversation_id::text;
  for item in select * from jsonb_array_elements(p_findings) loop
    select coalesce(array_agg(distinct value::uuid), '{}') into supports
      from jsonb_array_elements_text(coalesce(item -> 'supports', '[]'::jsonb));
    select coalesce(array_agg(distinct value::uuid), '{}') into contradicts
      from jsonb_array_elements_text(coalesce(item -> 'contradicts', '[]'::jsonb));
    if cardinality(supports) = 0 or exists (
         select 1 from unnest(supports || contradicts) cited
         where not exists (select 1 from public.messages m
                           where m.id = cited and m.conversation_id = p_conversation_id)) then
      raise exception 'finding cites evidence outside its conversation'
        using errcode = 'integrity_constraint_violation';
    end if;
    insert into public.findings(workspace_id, study_id, title, summary, category, origin, status, ai_metadata, created_by)
    values (c.workspace_id, c.study_id, item ->> 'title', item ->> 'summary',
            coalesce(item ->> 'category', 'other'), 'ai', 'proposed',
            jsonb_build_object('conversation_id', p_conversation_id, 'model', p_model), null)
    returning id into created;
    insert into public.finding_evidence(finding_id, message_id, workspace_id, study_id, relation)
      select created, cited, c.workspace_id, c.study_id, 'supports' from unnest(supports) cited;
    insert into public.finding_evidence(finding_id, message_id, workspace_id, study_id, relation)
      select created, cited, c.workspace_id, c.study_id, 'contradicts' from unnest(contradicts) cited
      where cited <> all (supports);
    saved := saved + 1;
  end loop;
  update public.conversation_analyses
  set status = 'completed', summary = left(p_summary, 1200), objective_coverage = p_objective_coverage,
      model = left(p_model, 120), error = null, completed_at = clock_timestamp(), updated_at = clock_timestamp()
  where conversation_id = p_conversation_id;
  return saved;
end;
$$;

revoke all on function public.begin_conversation_analysis(uuid) from public, anon, authenticated;
revoke all on function public.fail_conversation_analysis(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_conversation_analysis(uuid, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.begin_conversation_analysis(uuid) to service_role;
grant execute on function public.fail_conversation_analysis(uuid, text) to service_role;
grant execute on function public.complete_conversation_analysis(uuid, text, jsonb, jsonb, text) to service_role;
