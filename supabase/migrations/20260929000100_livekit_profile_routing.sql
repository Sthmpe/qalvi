-- LiveKit projects are replaceable transports; the consented conversation and
-- its canonical evidence remain the authority. Store aliases, never keys/tokens.
alter table public.conversations
  add column transport_provider text not null default 'livekit'
    check (transport_provider = 'livekit'),
  add column livekit_profile_id text not null default 'primary'
    check (livekit_profile_id ~ '^[a-z][a-z0-9_]{0,39}$'),
  add column transport_generation integer not null default 1
    check (transport_generation > 0),
  add column previous_livekit_profile_id text
    check (previous_livekit_profile_id is null or previous_livekit_profile_id ~ '^[a-z][a-z0-9_]{0,39}$'),
  add column transport_failure_reason text
    check (transport_failure_reason is null or transport_failure_reason in
      ('quota', 'assignment_timeout', 'transport_unavailable', 'service_unavailable', 'profile_disabled')),
  add column transport_failed_profiles text[] not null default '{}',
  add column transport_connection_failure_ids uuid[] not null default '{}',
  add column transport_connection_failures integer not null default 0
    check (transport_connection_failures between 0 and 2),
  add column transport_changed_at timestamptz not null default now(),
  add column transport_preparation_nonce uuid,
  add column transport_preparation_at timestamptz,
  add column transport_ready_at timestamptz,
  add constraint conversations_transport_preparation_pair
    check ((transport_preparation_nonce is null) = (transport_preparation_at is null));

-- Wrapping the existing proven atomic claim keeps invitation/resume creation in
-- the same transaction as transport assignment. Legacy callers still work.
create function public.claim_interview_invitation_with_profile(
  p_invitation_hash text, p_resume_hash text, p_livekit_room text,
  p_consent_version text, p_livekit_profile_id text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare created_conversation uuid;
begin
  if p_livekit_profile_id !~ '^[a-z][a-z0-9_]{0,39}$' then
    raise exception 'invalid LiveKit profile identifier' using errcode = 'check_violation';
  end if;
  created_conversation := public.claim_interview_invitation(
    p_invitation_hash, p_resume_hash, p_livekit_room, p_consent_version);
  update public.conversations set livekit_profile_id = p_livekit_profile_id
    where id = created_conversation;
  return created_conversation;
end;
$$;

-- A short database lease prevents concurrent token requests from dispatching
-- two workers. A later request may recover an abandoned preparation by listing
-- the room's existing dispatch before creating another.
create function public.reserve_interview_transport(
  p_conversation_id uuid, p_profile_id text, p_generation integer,
  p_nonce uuid, p_lease_seconds integer
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare c public.conversations%rowtype;
begin
  if p_nonce is null or p_lease_seconds not between 10 and 180 then
    raise exception 'invalid transport reservation' using errcode = 'check_violation';
  end if;
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found or c.status <> 'pending' or c.writer_generation <> 0 or
     c.next_message_sequence <> 0 or c.livekit_profile_id <> p_profile_id or
     c.transport_generation <> p_generation then
    return false;
  end if;
  if c.transport_preparation_nonce is not null and
     c.transport_preparation_at > clock_timestamp() - make_interval(secs => p_lease_seconds) then
    return false;
  end if;
  update public.conversations set transport_preparation_nonce = p_nonce,
    transport_preparation_at = clock_timestamp(), transport_ready_at = null
    where id = p_conversation_id;
  return true;
end;
$$;

create function public.confirm_interview_transport(
  p_conversation_id uuid, p_profile_id text, p_generation integer, p_nonce uuid
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.conversations set transport_ready_at = clock_timestamp(),
    transport_preparation_nonce = null, transport_preparation_at = null
  where id = p_conversation_id and status = 'pending' and writer_generation = 0
    and next_message_sequence = 0 and livekit_profile_id = p_profile_id
    and transport_generation = p_generation and transport_preparation_nonce = p_nonce;
  return found;
end;
$$;

-- A participant can report a failed WebRTC connect, but cannot choose a
-- project/room or rotate a conversation directly. Stable event IDs make an
-- uncertain HTTP retry idempotent. Two distinct failures are the server-side
-- bound; this capability affects only its own pending conversation.
create function public.report_interview_transport_connection_failure(
  p_conversation_id uuid, p_generation integer, p_event_id uuid
)
returns integer language plpgsql security definer set search_path = '' as $$
declare c public.conversations%rowtype;
begin
  if p_event_id is null then
    raise exception 'invalid connection failure event' using errcode = 'check_violation';
  end if;
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found or c.status <> 'pending' or c.writer_generation <> 0 or
     c.next_message_sequence <> 0 or c.transport_generation <> p_generation or
     c.transport_ready_at is null or
     exists (select 1 from public.messages where conversation_id = p_conversation_id) then
    raise exception 'connection failure is stale or unsafe' using errcode = 'insufficient_privilege';
  end if;
  if p_event_id = any(c.transport_connection_failure_ids) then
    return c.transport_connection_failures;
  end if;
  if c.transport_connection_failures < 2 then
    update public.conversations set
      transport_connection_failure_ids = array_append(transport_connection_failure_ids, p_event_id),
      transport_connection_failures = transport_connection_failures + 1
    where id = p_conversation_id returning transport_connection_failures into c.transport_connection_failures;
  end if;
  return c.transport_connection_failures;
end;
$$;

-- Compare-and-swap fencing ensures an old token/room can never claim the new
-- conversation writer. Mid-interview rotation remains deliberately forbidden.
create function public.rotate_interview_transport(
  p_conversation_id uuid, p_profile_id text, p_generation integer,
  p_room text, p_nonce uuid, p_next_profile_id text, p_next_room text,
  p_reason text
)
returns integer language plpgsql security definer set search_path = '' as $$
declare c public.conversations%rowtype; next_generation integer;
begin
  if p_nonce is null or p_reason is null or
     p_next_profile_id !~ '^[a-z][a-z0-9_]{0,39}$' or
     p_next_profile_id = p_profile_id or
     p_reason not in ('quota', 'assignment_timeout', 'transport_unavailable',
                      'service_unavailable', 'profile_disabled') or
     p_next_room !~ '^qalvi-real-[0-9a-f-]{36}$' or p_next_room = p_room then
    raise exception 'invalid transport rotation' using errcode = 'check_violation';
  end if;
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found or c.status <> 'pending' or c.writer_generation <> 0 or
     c.next_message_sequence <> 0 or c.livekit_profile_id <> p_profile_id or
     c.transport_generation <> p_generation or c.livekit_room <> p_room or
     c.transport_preparation_nonce is distinct from p_nonce or
     p_profile_id = any(c.transport_failed_profiles) or
     p_next_profile_id = any(c.transport_failed_profiles) or
     exists (select 1 from public.messages where conversation_id = p_conversation_id) then
    raise exception 'transport rotation is unsafe or stale' using errcode = 'insufficient_privilege';
  end if;
  update public.conversations set
    livekit_profile_id = p_next_profile_id, livekit_room = p_next_room,
    transport_generation = transport_generation + 1,
    previous_livekit_profile_id = p_profile_id,
    transport_failure_reason = p_reason,
    transport_failed_profiles = array_append(transport_failed_profiles, p_profile_id),
    transport_connection_failure_ids = '{}', transport_connection_failures = 0,
    transport_changed_at = clock_timestamp(), transport_ready_at = null,
    transport_preparation_nonce = null, transport_preparation_at = null
  where id = p_conversation_id returning transport_generation into next_generation;
  return next_generation;
end;
$$;

create function public.fail_interview_transport(
  p_conversation_id uuid, p_profile_id text, p_generation integer,
  p_nonce uuid, p_reason text
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_nonce is null or p_reason is null or p_reason not in
     ('quota', 'assignment_timeout', 'transport_unavailable', 'service_unavailable', 'profile_disabled') then
    raise exception 'invalid transport failure' using errcode = 'check_violation';
  end if;
  update public.conversations set
    transport_failure_reason = p_reason,
    transport_failed_profiles = array_append(transport_failed_profiles, p_profile_id),
    transport_changed_at = clock_timestamp(),
    transport_preparation_nonce = null, transport_preparation_at = null
  where id = p_conversation_id and status = 'pending' and writer_generation = 0
    and next_message_sequence = 0 and livekit_profile_id = p_profile_id
    and transport_generation = p_generation and transport_preparation_nonce = p_nonce
    and not p_profile_id = any(transport_failed_profiles);
  return found;
end;
$$;

revoke all on function public.claim_interview_invitation_with_profile(text,text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.reserve_interview_transport(uuid,text,integer,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.confirm_interview_transport(uuid,text,integer,uuid)
  from public, anon, authenticated;
revoke all on function public.report_interview_transport_connection_failure(uuid,integer,uuid)
  from public, anon, authenticated;
revoke all on function public.rotate_interview_transport(uuid,text,integer,text,uuid,text,text,text)
  from public, anon, authenticated;
revoke all on function public.fail_interview_transport(uuid,text,integer,uuid,text)
  from public, anon, authenticated;
grant execute on function public.claim_interview_invitation_with_profile(text,text,text,text,text)
  to service_role;
grant execute on function public.reserve_interview_transport(uuid,text,integer,uuid,integer)
  to service_role;
grant execute on function public.confirm_interview_transport(uuid,text,integer,uuid)
  to service_role;
grant execute on function public.report_interview_transport_connection_failure(uuid,integer,uuid)
  to service_role;
grant execute on function public.rotate_interview_transport(uuid,text,integer,text,uuid,text,text,text)
  to service_role;
grant execute on function public.fail_interview_transport(uuid,text,integer,uuid,text)
  to service_role;
