-- M4 Stage 2B.4B correction: an ending recorded by the server (participant end,
-- researcher cancellation) clears the writer's job ID with the lease. The holder's
-- next heartbeat then failed the job check and stopped as "stale", so the worker
-- never performed its own ejection: only the server outbox did. The current
-- generation now learns the terminal status even after its job ID was cleared,
-- so the worker ejects from its own project as a second, independent path.
-- A replaced generation is still answered "stale" and never ejects.
create or replace function public.heartbeat_interview_writer(
  p_conversation_id uuid, p_writer_generation bigint, p_job_id text, p_lease_seconds integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.conversations%rowtype;
begin
  if p_lease_seconds not between 15 and 120 then
    raise exception 'invalid writer lease request' using errcode = 'check_violation';
  end if;
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found or c.writer_generation <> p_writer_generation then
    raise exception 'stale conversation writer' using errcode = 'insufficient_privilege';
  end if;
  if c.status in ('completed', 'cancelled', 'failed') then
    if c.writer_job_id is not distinct from p_job_id then
      update public.conversations set writer_job_id = null, writer_lease_expires_at = null
        where id = p_conversation_id;
    end if;
    return jsonb_build_object('status', c.status, 'leaseExpiresAt', null);
  end if;
  if c.writer_job_id is distinct from p_job_id then
    raise exception 'stale conversation writer' using errcode = 'insufficient_privilege';
  end if;
  update public.conversations set
    writer_lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    writer_heartbeat_at = clock_timestamp()
  where id = p_conversation_id returning * into c;
  return jsonb_build_object('status', c.status, 'leaseExpiresAt', c.writer_lease_expires_at);
end;
$$;

revoke all on function public.heartbeat_interview_writer(uuid,bigint,text,integer) from public, anon, authenticated;
grant execute on function public.heartbeat_interview_writer(uuid,bigint,text,integer) to service_role;
