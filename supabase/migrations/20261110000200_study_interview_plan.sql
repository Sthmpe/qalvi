-- Milestone 5: the live interview follows the study the participant was invited to.
--
-- The study plan reaches the agent only through the trusted server path that
-- already binds a consented conversation to its study: invitation -> claim ->
-- conversation -> fenced writer. The agent asks for the plan of the conversation
-- it has claimed, proving its writer generation. The browser never supplies or
-- receives the plan, and anon/authenticated cannot call this function.

create function public.read_interview_study_plan(
  p_conversation_id uuid, p_writer_generation bigint
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.conversations%rowtype; s public.studies%rowtype;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if not found or c.writer_generation <> p_writer_generation or c.consented_at is null or
     c.status not in ('pending', 'in_progress') then
    raise exception 'conversation is not readable by this generation'
      using errcode = 'insufficient_privilege';
  end if;
  select * into s from public.studies
    where id = c.study_id and workspace_id = c.workspace_id;
  if not found or s.status <> 'active' then
    raise exception 'study is not open for interviews' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object(
    'study_id', s.id,
    'title', s.title,
    'research_goal', coalesce(s.research_goal, ''),
    'audience', coalesce(s.audience, ''),
    'objectives', s.objectives,
    'assumptions', to_jsonb(s.assumptions),
    'updated_at', s.updated_at
  );
end;
$$;

revoke all on function public.read_interview_study_plan(uuid, bigint) from public, anon, authenticated;
grant execute on function public.read_interview_study_plan(uuid, bigint) to service_role;

-- A control record made under a study plan cannot be replayed with the default
-- (planless) methodology, so it carries its own version. The replay module
-- refuses versions it does not implement; nothing else about the record changes.
alter table public.interview_turn_controls
  drop constraint interview_turn_controls_methodology_version_check;
alter table public.interview_turn_controls
  add constraint interview_turn_controls_methodology_version_check
  check (methodology_version in ('real-default-v1', 'study-plan-v1'));

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
     source.channel not in ('voice', 'text') or source.control_protocol_version is distinct from 1 then
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

-- create or replace keeps existing grants; restate them so the boundary is explicit.
revoke all on function public.record_interview_turn_control(uuid,bigint,uuid,jsonb,text,text,text)
  from public, anon, authenticated;
grant execute on function public.record_interview_turn_control(uuid,bigint,uuid,jsonb,text,text,text)
  to service_role;
