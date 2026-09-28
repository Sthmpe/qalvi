-- M4 Stage 2B.4A: mark turns governed by the durable control-before-reply
-- protocol, store one immutable derived decision per participant message, and
-- expose a narrow service-only transcript read by hashed resume capability.

alter table public.messages add column control_protocol_version smallint;
alter table public.messages add constraint messages_control_protocol_version_check
  check (control_protocol_version is null or
         (control_protocol_version = 1 and speaker = 'participant' and channel in ('voice', 'text')));
alter table public.messages add constraint messages_id_conversation_key unique (id, conversation_id);

create table public.interview_turn_controls (
  message_id uuid primary key,
  conversation_id uuid not null,
  schema_version smallint not null check (schema_version = 1),
  methodology_version text not null check (methodology_version = 'real-default-v1'),
  signals jsonb not null check (jsonb_typeof(signals) = 'object' and length(signals::text) <= 1500),
  decision_action text not null check (char_length(btrim(decision_action)) between 1 and 80),
  state_sha256 text not null check (state_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (message_id, conversation_id)
    references public.messages(id, conversation_id) on delete cascade
);
create index interview_turn_controls_conversation_idx
  on public.interview_turn_controls(conversation_id, message_id);
alter table public.interview_turn_controls enable row level security;
revoke all on public.interview_turn_controls from public, anon, authenticated;
revoke insert, update, delete on public.interview_turn_controls from service_role;
grant select on public.interview_turn_controls to service_role;

create function private.guard_interview_turn_control()
returns trigger language plpgsql security definer set search_path = '' as $$
declare source public.messages%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception 'interview control records are immutable' using errcode = 'restrict_violation';
  end if;
  select * into source from public.messages
    where id = new.message_id and conversation_id = new.conversation_id;
  if not found or source.speaker <> 'participant' or
     source.channel not in ('voice', 'text') or source.control_protocol_version is distinct from 1 then
    raise exception 'control record requires a versioned participant message'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger interview_turn_controls_guard
  before insert or update or delete on public.interview_turn_controls
  for each row execute function private.guard_interview_turn_control();

-- The older append RPC remains available for existing assistant writes and for
-- an older deployed worker during rollout. Only this RPC marks a participant
-- turn as subject to the new control-before-reply guarantee.
create function public.append_recoverable_interview_message(
  p_conversation_id uuid, p_writer_generation bigint, p_event_key text,
  p_channel text, p_content text, p_occurred_at timestamptz
)
returns table(message_id uuid, message_sequence integer, inserted boolean)
language plpgsql security definer set search_path = '' as $$
declare c public.conversations%rowtype; existing public.messages%rowtype; allocated integer;
begin
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found or c.writer_generation <> p_writer_generation or
     c.consented_at is null or c.status <> 'in_progress' then
    raise exception 'conversation is not writable by this generation'
      using errcode = 'insufficient_privilege';
  end if;
  if p_channel not in ('voice', 'text') or
     char_length(btrim(coalesce(p_event_key, ''))) not between 1 and 200 or
     char_length(btrim(coalesce(p_content, ''))) < 1 or p_occurred_at is null then
    raise exception 'invalid canonical participant turn' using errcode = 'check_violation';
  end if;
  select * into existing from public.messages m
    where m.conversation_id = p_conversation_id and m.transport_segment_id = p_event_key;
  if found then
    if existing.speaker <> 'participant' or existing.channel is distinct from p_channel or
       existing.content is distinct from p_content or existing.occurred_at is distinct from p_occurred_at or
       existing.control_protocol_version <> 1 then
      raise exception 'event key reused with conflicting payload' using errcode = 'unique_violation';
    end if;
    return query select existing.id, existing.sequence, false;
    return;
  end if;
  update public.conversations set next_message_sequence = next_message_sequence + 1
    where id = p_conversation_id returning next_message_sequence - 1 into allocated;
  return query
    insert into public.messages(workspace_id, study_id, conversation_id, sequence,
      speaker, channel, content, occurred_at, transport_segment_id, control_protocol_version)
    values (c.workspace_id, c.study_id, p_conversation_id, allocated,
      'participant', p_channel, p_content, p_occurred_at, p_event_key, 1)
    returning id, sequence, true;
end;
$$;

create function public.record_interview_turn_control(
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
  if p_methodology_version <> 'real-default-v1' or
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

-- This function accepts a capability HASH, never a browser-selected conversation
-- ID. The server calculates the hash from its HTTP-only cookie and alone can
-- execute this function. Completed/cancelled sessions remain readable until the
-- same capability expires or is revoked, but the join RPC still denies them.
create function public.read_participant_interview_recovery(
  p_resume_hash text, p_after_sequence integer default -1, p_limit integer default 100
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.conversations%rowtype; result jsonb; last_message public.messages%rowtype;
begin
  if p_resume_hash !~ '^[0-9a-f]{64}$' or p_after_sequence < -1 or
     p_limit not between 1 and 100 then
    return null;
  end if;
  select conversation.* into c
  from public.interview_resumes r
  join public.conversations conversation on conversation.id = r.conversation_id
  where r.token_hash = p_resume_hash and r.revoked_at is null
    and r.expires_at > clock_timestamp();
  if not found then return null; end if;
  select * into last_message from public.messages
    where conversation_id = c.id order by sequence desc limit 1;
  with page as (
    select m.id, m.sequence, m.speaker, m.channel, m.content, m.interrupted,
      m.transport_segment_id, m.control_protocol_version
    from public.messages m where m.conversation_id = c.id and m.sequence > p_after_sequence
    order by m.sequence limit p_limit
  )
  select jsonb_build_object(
    'status', c.status,
    'sessionKey', c.id::text,
    'messages', coalesce(jsonb_agg(jsonb_build_object(
      'id', page.id, 'sequence', page.sequence, 'speaker', page.speaker,
      'channel', page.channel, 'content', page.content,
      'interrupted', page.interrupted, 'eventKey', page.transport_segment_id,
      'protocolVersion', page.control_protocol_version) order by page.sequence)
      filter (where page.id is not null), '[]'::jsonb),
    'nextCursor', coalesce(max(page.sequence), p_after_sequence),
    'hasMore', exists(select 1 from public.messages m
      where m.conversation_id = c.id and m.sequence > coalesce(max(page.sequence), p_after_sequence)),
    'replyUnconfirmed', coalesce(last_message.speaker = 'participant', false),
    'controlPending', exists(select 1 from public.messages m
      left join public.interview_turn_controls t on t.message_id = m.id
      where m.conversation_id = c.id and m.speaker = 'participant'
        and m.control_protocol_version = 1 and t.message_id is null),
    'legacyHistory', exists(select 1 from public.messages m
      where m.conversation_id = c.id and m.speaker = 'participant'
        and m.control_protocol_version is null)
  ) into result from page;
  return result;
end;
$$;

revoke all on function public.append_recoverable_interview_message(uuid,bigint,text,text,text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.record_interview_turn_control(uuid,bigint,uuid,jsonb,text,text,text)
  from public, anon, authenticated;
revoke all on function public.read_participant_interview_recovery(text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.append_recoverable_interview_message(uuid,bigint,text,text,text,timestamptz)
  to service_role;
grant execute on function public.record_interview_turn_control(uuid,bigint,uuid,jsonb,text,text,text)
  to service_role;
grant execute on function public.read_participant_interview_recovery(text,integer,integer)
  to service_role;
