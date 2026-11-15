-- M4 Stage 2B.4B: server-authoritative writer lease, replacement-worker recovery
-- reservation, durable opening marker, terminal lifecycle with ejection outbox.
--
-- Fencing stays generation-based: every evidence write already requires the
-- current writer_generation, so a replaced worker can never write again. The
-- lease decides WHEN a replacement may take generation N+1: only after the
-- current holder's lease has expired or been released. All clocks are the
-- database clock. Older deployed workers (legacy claim, no lease) keep working
-- while no lease is held, and can never steal a live lease.

alter table public.conversations
  add column writer_job_id text
    check (writer_job_id is null or char_length(writer_job_id) between 1 and 200),
  add column writer_lease_expires_at timestamptz,
  add column writer_heartbeat_at timestamptz,
  add column writer_transport_generation integer
    check (writer_transport_generation is null or writer_transport_generation > 0),
  add column writer_recovery_nonce uuid,
  add column writer_recovery_at timestamptz,
  add column writer_recovery_attempts integer not null default 0
    check (writer_recovery_attempts between 0 and 100),
  add column opening_started_at timestamptz,
  add column end_reason text
    check (end_reason is null or end_reason in
      ('participant_ended', 'interview_closed', 'researcher_cancelled', 'recovery_integrity')),
  add constraint conversations_writer_lease_pair
    check ((writer_job_id is null) = (writer_lease_expires_at is null)),
  add constraint conversations_writer_recovery_pair
    check ((writer_recovery_nonce is null) = (writer_recovery_at is null)),
  add constraint conversations_end_reason_terminal
    check (end_reason is null or status in ('completed', 'cancelled', 'failed'));

-- Ejection and other provider side effects are recorded in the same transaction
-- as the terminal transition, then performed by trusted server code with
-- retries. A temporary LiveKit failure can delay ejection; it cannot lose it.
create table public.interview_lifecycle_outbox (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  kind text not null check (kind = 'eject_room'),
  livekit_profile_id text not null check (livekit_profile_id ~ '^[a-z][a-z0-9_]{0,39}$'),
  livekit_room text not null check (char_length(livekit_room) between 1 and 200),
  created_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts between 0 and 100),
  next_attempt_at timestamptz not null default now(),
  lock_nonce uuid,
  locked_at timestamptz,
  completed_at timestamptz,
  abandoned_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 200),
  unique (conversation_id, kind, livekit_room),
  check ((lock_nonce is null) = (locked_at is null)),
  check (completed_at is null or abandoned_at is null)
);
create index interview_lifecycle_outbox_due_idx
  on public.interview_lifecycle_outbox(next_attempt_at)
  where completed_at is null and abandoned_at is null;
alter table public.interview_lifecycle_outbox enable row level security;
revoke all on public.interview_lifecycle_outbox from public, anon, authenticated;
grant select on public.interview_lifecycle_outbox to service_role;

create function private.enqueue_room_ejection(c public.conversations)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if c.livekit_room is null then return; end if;
  insert into public.interview_lifecycle_outbox(conversation_id, kind, livekit_profile_id, livekit_room)
  values (c.id, 'eject_room', c.livekit_profile_id, c.livekit_room)
  on conflict (conversation_id, kind, livekit_room) do nothing;
end;
$$;
revoke all on function private.enqueue_room_ejection(public.conversations) from public;

-- Claim generation N+1, or renew the caller's own lease. A different job may
-- not claim while the current lease is live. Profile, room and transport
-- generation must match the conversation's current transport.
create function public.claim_interview_writer_lease(
  p_conversation_id uuid, p_livekit_room text, p_profile_id text,
  p_job_id text, p_lease_seconds integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.conversations%rowtype; renewed boolean := false;
begin
  if char_length(btrim(coalesce(p_job_id, ''))) not between 1 and 200 or
     p_lease_seconds not between 15 and 120 or
     (p_profile_id is not null and p_profile_id !~ '^[a-z][a-z0-9_]{0,39}$') then
    raise exception 'invalid writer lease request' using errcode = 'check_violation';
  end if;
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found or c.livekit_room is distinct from p_livekit_room or c.consented_at is null or
     (p_profile_id is not null and c.livekit_profile_id is distinct from p_profile_id) or
     not (c.status in ('pending', 'in_progress') or
       (c.status = 'interrupted' and c.interrupted_at > clock_timestamp() - interval '24 hours')) or
     not exists (select 1 from public.interview_resumes r where r.conversation_id = c.id
       and r.revoked_at is null and r.expires_at > clock_timestamp()) then
    raise exception 'conversation cannot accept a writer' using errcode = 'insufficient_privilege';
  end if;
  if c.writer_lease_expires_at > clock_timestamp() then
    if c.writer_job_id is distinct from p_job_id then
      raise exception 'writer lease is held by another worker' using errcode = 'lock_not_available';
    end if;
    renewed := true;
  end if;
  update public.conversations set
    writer_generation = case when renewed then writer_generation else writer_generation + 1 end,
    writer_job_id = p_job_id,
    writer_lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    writer_heartbeat_at = clock_timestamp(),
    writer_transport_generation = transport_generation,
    writer_recovery_nonce = null, writer_recovery_at = null, writer_recovery_attempts = 0,
    status = 'in_progress', interrupted_at = null
  where id = p_conversation_id
  returning * into c;
  return jsonb_build_object(
    'generation', c.writer_generation,
    'renewed', renewed,
    'transportGeneration', c.transport_generation,
    'openingStarted', c.opening_started_at is not null,
    'leaseExpiresAt', c.writer_lease_expires_at);
end;
$$;

-- Extend the caller's lease. A replaced worker learns it is stale here and must
-- stop. A terminal conversation reports its status so the worker can eject and
-- shut down; its lease is cleared.
create function public.heartbeat_interview_writer(
  p_conversation_id uuid, p_writer_generation bigint, p_job_id text, p_lease_seconds integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.conversations%rowtype;
begin
  if p_lease_seconds not between 15 and 120 then
    raise exception 'invalid writer lease request' using errcode = 'check_violation';
  end if;
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found or c.writer_generation <> p_writer_generation or
     c.writer_job_id is distinct from p_job_id then
    raise exception 'stale conversation writer' using errcode = 'insufficient_privilege';
  end if;
  if c.status in ('completed', 'cancelled', 'failed') then
    update public.conversations set writer_job_id = null, writer_lease_expires_at = null
      where id = p_conversation_id;
    return jsonb_build_object('status', c.status, 'leaseExpiresAt', null);
  end if;
  update public.conversations set
    writer_lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    writer_heartbeat_at = clock_timestamp()
  where id = p_conversation_id returning * into c;
  return jsonb_build_object('status', c.status, 'leaseExpiresAt', c.writer_lease_expires_at);
end;
$$;

create function public.release_interview_writer(
  p_conversation_id uuid, p_writer_generation bigint, p_job_id text
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.conversations set writer_job_id = null, writer_lease_expires_at = null
  where id = p_conversation_id and writer_generation = p_writer_generation
    and writer_job_id = p_job_id;
  return found;
end;
$$;

-- Written durably BEFORE the greeting is generated. Its presence with no saved
-- assistant row means the greeting may have reached the participant, so a
-- replacement must not greet again.
create function public.mark_interview_opening(p_conversation_id uuid, p_writer_generation bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare c public.conversations%rowtype;
begin
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found or c.writer_generation <> p_writer_generation or c.status <> 'in_progress' then
    raise exception 'conversation is not writable by this generation'
      using errcode = 'insufficient_privilege';
  end if;
  if c.opening_started_at is not null then return false; end if;
  update public.conversations set opening_started_at = clock_timestamp() where id = p_conversation_id;
  return true;
end;
$$;

-- The single terminal-transition authority for server and worker. Idempotent:
-- an already terminal conversation returns its existing status unchanged. A
-- worker passes its generation; trusted server code (participant end,
-- researcher cancellation) passes null. A pending interview has not started, so
-- a request to complete it is recorded as cancelled.
create function public.end_interview_conversation(
  p_conversation_id uuid, p_status text, p_reason text, p_writer_generation bigint default null
)
returns text language plpgsql security definer set search_path = '' as $$
declare c public.conversations%rowtype; target text := p_status;
begin
  if p_status not in ('completed', 'cancelled', 'failed') or p_reason is null or
     p_reason not in ('participant_ended', 'interview_closed', 'researcher_cancelled', 'recovery_integrity') or
     (p_status = 'failed') <> (p_reason = 'recovery_integrity') then
    raise exception 'invalid interview ending' using errcode = 'check_violation';
  end if;
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found then
    raise exception 'conversation not found' using errcode = 'no_data_found';
  end if;
  if c.status in ('completed', 'cancelled', 'failed') then return c.status; end if;
  if p_writer_generation is not null and c.writer_generation <> p_writer_generation then
    raise exception 'stale conversation writer' using errcode = 'insufficient_privilege';
  end if;
  if c.status = 'pending' and target = 'completed' then target := 'cancelled'; end if;
  update public.conversations set status = target, end_reason = p_reason,
      ended_at = clock_timestamp(), interrupted_at = null,
      writer_job_id = null, writer_lease_expires_at = null,
      writer_recovery_nonce = null, writer_recovery_at = null
  where id = p_conversation_id returning * into c;
  perform private.enqueue_room_ejection(c);
  return target;
end;
$$;

-- Reserve the right to dispatch ONE replacement worker. Only for a started
-- conversation whose writer lease has lapsed, at most one reservation per
-- window, and at most three consecutive attempts without a successful claim.
-- The reservation itself advances the generation: the lapsed writer is fenced
-- from the moment takeover is decided, not only once a replacement claims.
create function public.reserve_interview_writer_recovery(
  p_conversation_id uuid, p_nonce uuid, p_window_seconds integer
)
returns text language plpgsql security definer set search_path = '' as $$
declare c public.conversations%rowtype;
begin
  if p_nonce is null or p_window_seconds not between 15 and 300 then
    raise exception 'invalid writer recovery request' using errcode = 'check_violation';
  end if;
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found or c.consented_at is null then return 'unavailable'; end if;
  if c.status in ('completed', 'cancelled', 'failed') then return 'terminal'; end if;
  if c.writer_generation = 0 or not (c.status = 'in_progress' or
     (c.status = 'interrupted' and c.interrupted_at > clock_timestamp() - interval '24 hours')) then
    return 'unavailable';
  end if;
  if c.writer_lease_expires_at > clock_timestamp() then return 'active'; end if;
  if c.writer_recovery_at > clock_timestamp() - make_interval(secs => p_window_seconds) then
    return 'recovering';
  end if;
  if c.writer_recovery_attempts >= 3 then return 'exhausted'; end if;
  update public.conversations set writer_recovery_nonce = p_nonce,
      writer_recovery_at = clock_timestamp(),
      writer_recovery_attempts = writer_recovery_attempts + 1,
      writer_generation = writer_generation + 1,
      writer_job_id = null, writer_lease_expires_at = null
  where id = p_conversation_id;
  return 'reserved';
end;
$$;

-- Outbox processing by trusted server code: lease due rows, then complete or
-- reschedule each with bounded exponential backoff.
create function public.lease_interview_lifecycle_outbox(
  p_nonce uuid, p_limit integer, p_lock_seconds integer
)
returns setof public.interview_lifecycle_outbox
language plpgsql security definer set search_path = '' as $$
begin
  if p_nonce is null or p_limit not between 1 and 50 or p_lock_seconds not between 10 and 300 then
    raise exception 'invalid outbox lease' using errcode = 'check_violation';
  end if;
  return query
    update public.interview_lifecycle_outbox o
    set lock_nonce = p_nonce, locked_at = clock_timestamp()
    where o.id in (
      select id from public.interview_lifecycle_outbox
      where completed_at is null and abandoned_at is null and next_attempt_at <= clock_timestamp()
        and (locked_at is null or locked_at < clock_timestamp() - make_interval(secs => p_lock_seconds))
      order by next_attempt_at limit p_limit
      for update skip locked)
    returning o.*;
end;
$$;

create function public.settle_interview_lifecycle_outbox(
  p_id uuid, p_nonce uuid, p_succeeded boolean, p_error text default null
)
returns text language plpgsql security definer set search_path = '' as $$
declare o public.interview_lifecycle_outbox%rowtype;
begin
  select * into o from public.interview_lifecycle_outbox where id = p_id for update;
  if not found or o.lock_nonce is distinct from p_nonce or
     o.completed_at is not null or o.abandoned_at is not null then
    return 'stale';
  end if;
  if p_succeeded then
    update public.interview_lifecycle_outbox set completed_at = clock_timestamp(),
      lock_nonce = null, locked_at = null, last_error = null where id = p_id;
    return 'completed';
  end if;
  if o.attempts + 1 >= 10 then
    update public.interview_lifecycle_outbox set attempts = attempts + 1, abandoned_at = clock_timestamp(),
      lock_nonce = null, locked_at = null, last_error = left(coalesce(p_error, 'failed'), 200)
    where id = p_id;
    return 'abandoned';
  end if;
  update public.interview_lifecycle_outbox set attempts = attempts + 1,
    next_attempt_at = clock_timestamp() + make_interval(secs => least(600, 5 * power(2, o.attempts)::integer)),
    lock_nonce = null, locked_at = null, last_error = left(coalesce(p_error, 'failed'), 200)
  where id = p_id;
  return 'retry';
end;
$$;

-- Existing RPCs, redefined forward-only.

-- The legacy claim used by already deployed workers keeps its behavior while no
-- lease is held, but can never take over a live lease.
create or replace function public.claim_conversation_writer(p_conversation_id uuid, p_livekit_room text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare c public.conversations%rowtype;
begin
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found or c.livekit_room is distinct from p_livekit_room or c.consented_at is null or
     not (c.status = 'pending' or c.status = 'in_progress' or
       (c.status = 'interrupted' and c.interrupted_at > clock_timestamp() - interval '24 hours')) then
    raise exception 'conversation cannot accept a writer' using errcode = 'insufficient_privilege';
  end if;
  if c.writer_lease_expires_at > clock_timestamp() then
    raise exception 'writer lease is held by another worker' using errcode = 'lock_not_available';
  end if;
  update public.conversations
  set writer_generation = writer_generation + 1,
      status = 'in_progress', interrupted_at = null,
      writer_job_id = null, writer_lease_expires_at = null,
      writer_recovery_nonce = null, writer_recovery_at = null
  where id = p_conversation_id
  returning writer_generation into c.writer_generation;
  return c.writer_generation;
end;
$$;

-- A worker's own interruption releases its lease; a terminal transition through
-- this older path also records the ending and enqueues ejection.
create or replace function public.transition_interview_conversation(
  p_conversation_id uuid, p_writer_generation bigint, p_next_status text
)
returns text language plpgsql security definer set search_path = '' as $$
declare c public.conversations%rowtype;
begin
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found or c.writer_generation <> p_writer_generation then
    raise exception 'stale conversation writer' using errcode = 'insufficient_privilege';
  end if;
  if c.status = p_next_status then return c.status; end if;
  -- The lifecycle trigger enforces the permitted transition graph for every role.
  update public.conversations set status = p_next_status,
      interrupted_at = case when p_next_status = 'interrupted' then clock_timestamp() else null end,
      ended_at = case when p_next_status in ('completed', 'cancelled', 'failed')
                      then clock_timestamp() else null end,
      writer_job_id = case when p_next_status = 'in_progress' then writer_job_id else null end,
      writer_lease_expires_at = case when p_next_status = 'in_progress'
                                     then writer_lease_expires_at else null end
  where id = p_conversation_id returning * into c;
  if p_next_status in ('completed', 'cancelled', 'failed') then
    perform private.enqueue_room_ejection(c);
  end if;
  return p_next_status;
end;
$$;

-- The participant recovery read gains lifecycle facts the UI needs. Existing
-- keys are unchanged; new keys are additive. Still no tenant IDs, profile,
-- room, job or control metadata.
create or replace function public.read_participant_interview_recovery(
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
        and m.control_protocol_version is null),
    'endReason', c.end_reason,
    'writerActive', coalesce(c.writer_lease_expires_at > clock_timestamp(), false),
    'recovering', coalesce(c.writer_recovery_at > clock_timestamp() - interval '90 seconds', false),
    'openingUncertain', c.opening_started_at is not null and last_message.id is null
  ) into result from page;
  return result;
end;
$$;

revoke all on function public.claim_interview_writer_lease(uuid,text,text,text,integer) from public, anon, authenticated;
revoke all on function public.heartbeat_interview_writer(uuid,bigint,text,integer) from public, anon, authenticated;
revoke all on function public.release_interview_writer(uuid,bigint,text) from public, anon, authenticated;
revoke all on function public.mark_interview_opening(uuid,bigint) from public, anon, authenticated;
revoke all on function public.end_interview_conversation(uuid,text,text,bigint) from public, anon, authenticated;
revoke all on function public.reserve_interview_writer_recovery(uuid,uuid,integer) from public, anon, authenticated;
revoke all on function public.lease_interview_lifecycle_outbox(uuid,integer,integer) from public, anon, authenticated;
revoke all on function public.settle_interview_lifecycle_outbox(uuid,uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.claim_interview_writer_lease(uuid,text,text,text,integer) to service_role;
grant execute on function public.heartbeat_interview_writer(uuid,bigint,text,integer) to service_role;
grant execute on function public.release_interview_writer(uuid,bigint,text) to service_role;
grant execute on function public.mark_interview_opening(uuid,bigint) to service_role;
grant execute on function public.end_interview_conversation(uuid,text,text,bigint) to service_role;
grant execute on function public.reserve_interview_writer_recovery(uuid,uuid,integer) to service_role;
grant execute on function public.lease_interview_lifecycle_outbox(uuid,integer,integer) to service_role;
grant execute on function public.settle_interview_lifecycle_outbox(uuid,uuid,boolean,text) to service_role;
