-- Keep derived control decisions immutable while allowing their canonical
-- parent to be deleted through the existing authorized study cleanup path.
-- No table grants, RPC grants, or RLS policies change.
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
     source.channel not in ('voice', 'text') or source.control_protocol_version is distinct from 1 then
    raise exception 'control record requires a versioned participant message'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
