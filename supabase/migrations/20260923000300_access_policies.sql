-- M4 Stage 1, part 3 of 3: who may read and write what.
--
-- Roles:
--   anon           Nothing. Participants reach Qalvi through the interview
--                  server, never through direct database access.
--   authenticated  Researchers. Read everything in workspaces they belong to.
--                  Write research framing (studies, participants, findings,
--                  evidence links). Never write raw evidence.
--   service_role   Trusted server code (the interview pipeline). Bypasses RLS,
--                  but not the integrity triggers: it still cannot rewrite
--                  evidence or create an unsupported finding.
--
-- Deleting studies, conversations, or evidence is not granted to researchers.
-- Findings are retired by status, not deleted. Membership is managed by the
-- service role until team management is in scope.

-- ---------------------------------------------------------------------------
-- Membership helpers
-- ---------------------------------------------------------------------------

-- Security definer so policies can consult membership without recursing
-- through the policies on workspace_members itself.
create function private.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace and m.user_id = (select auth.uid())
  );
$$;

create function private.is_workspace_owner(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  );
$$;

create function private.shares_workspace_with(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs using (workspace_id)
    where mine.user_id = (select auth.uid()) and theirs.user_id = other_user
  );
$$;

revoke all on function private.is_workspace_member(uuid) from public;
revoke all on function private.is_workspace_owner(uuid) from public;
revoke all on function private.shares_workspace_with(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.is_workspace_owner(uuid) to authenticated;
grant execute on function private.shares_workspace_with(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Grants. Column lists keep ids, tenancy, authorship, and provenance out of
-- reach of the API even where a policy allows the row.
-- ---------------------------------------------------------------------------

grant select on
  public.profiles, public.workspaces, public.workspace_members, public.studies,
  public.participants, public.conversations, public.messages, public.visual_displays,
  public.visual_responses, public.findings, public.finding_evidence
to authenticated;

grant update (display_name) on public.profiles to authenticated;
grant update (name) on public.workspaces to authenticated;

grant insert (workspace_id, title, description, research_goal, audience, category, status)
  on public.studies to authenticated;
grant update (title, description, research_goal, audience, category, status)
  on public.studies to authenticated;

grant insert (workspace_id, study_id, alias, segment) on public.participants to authenticated;
grant update (alias, segment) on public.participants to authenticated;

grant insert (workspace_id, study_id, title, summary, category, status)
  on public.findings to authenticated;
grant update (title, summary, category, status) on public.findings to authenticated;

grant insert (finding_id, message_id, workspace_id, study_id, relation, note)
  on public.finding_evidence to authenticated;
grant update (relation, note) on public.finding_evidence to authenticated;
grant delete on public.finding_evidence to authenticated;

grant select, insert, update, delete on
  public.profiles, public.workspaces, public.workspace_members, public.studies,
  public.participants, public.conversations, public.messages, public.visual_displays,
  public.visual_responses, public.findings, public.finding_evidence
to service_role;

-- ---------------------------------------------------------------------------
-- Policies (authenticated only; nothing is granted to anon)
-- ---------------------------------------------------------------------------

create policy "Profiles are visible to themselves and teammates"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_workspace_with(id));
create policy "Profiles are edited by their owner"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "Workspaces are visible to members"
  on public.workspaces for select to authenticated
  using (private.is_workspace_member(id));
create policy "Workspaces are renamed by owners"
  on public.workspaces for update to authenticated
  using (private.is_workspace_owner(id))
  with check (private.is_workspace_owner(id));

create policy "Memberships are visible within the workspace"
  on public.workspace_members for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy "Studies are visible to members"
  on public.studies for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy "Studies are created by members"
  on public.studies for insert to authenticated
  with check (private.is_workspace_member(workspace_id));
create policy "Studies are edited by members"
  on public.studies for update to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

create policy "Participants are visible to members"
  on public.participants for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy "Participants are added by members"
  on public.participants for insert to authenticated
  with check (private.is_workspace_member(workspace_id));
create policy "Participants are edited by members"
  on public.participants for update to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

-- Raw evidence: read only. Only the interview pipeline writes it.
create policy "Conversations are visible to members"
  on public.conversations for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy "Messages are visible to members"
  on public.messages for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy "Visual displays are visible to members"
  on public.visual_displays for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy "Visual responses are visible to members"
  on public.visual_responses for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy "Findings are visible to members"
  on public.findings for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy "Findings are created by members"
  on public.findings for insert to authenticated
  with check (private.is_workspace_member(workspace_id));
create policy "Findings are edited by members"
  on public.findings for update to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

create policy "Evidence links are visible to members"
  on public.finding_evidence for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy "Evidence links are added by members"
  on public.finding_evidence for insert to authenticated
  with check (private.is_workspace_member(workspace_id));
create policy "Evidence links are edited by members"
  on public.finding_evidence for update to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));
create policy "Evidence links are removed by members"
  on public.finding_evidence for delete to authenticated
  using (private.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Operations that must happen in one transaction
-- ---------------------------------------------------------------------------

-- A new workspace and its first owner. Security definer because no one is a
-- member of a workspace before it exists.
create function public.create_workspace(workspace_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  created uuid;
begin
  if caller is null then
    raise exception 'sign in to create a workspace' using errcode = 'insufficient_privilege';
  end if;
  insert into public.workspaces (name, created_by) values (workspace_name, caller)
    returning id into created;
  insert into public.workspace_members (workspace_id, user_id, role)
    values (created, caller, 'owner');
  return created;
end;
$$;

-- A researcher's finding and the messages that support it, written together
-- so the finding never exists without evidence. Security invoker: the caller's
-- own policies and column grants apply to every insert.
create function public.create_finding(
  target_study uuid,
  finding_title text,
  finding_summary text,
  finding_category text,
  supporting_message_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_workspace uuid;
  created uuid;
begin
  if coalesce(cardinality(supporting_message_ids), 0) = 0 then
    raise exception 'a finding must cite at least one supporting message'
      using errcode = 'integrity_constraint_violation';
  end if;
  select s.workspace_id into target_workspace from public.studies s where s.id = target_study;
  if target_workspace is null then
    raise exception 'study not found' using errcode = 'no_data_found';
  end if;

  insert into public.findings (workspace_id, study_id, title, summary, category, status)
    values (target_workspace, target_study, finding_title, finding_summary,
            coalesce(finding_category, 'other'), 'accepted')
    returning id into created;
  insert into public.finding_evidence (finding_id, message_id, workspace_id, study_id, relation)
    select created, message_id, target_workspace, target_study, 'supports'
    from unnest(supporting_message_ids) as message_id
    group by message_id;
  return created;
end;
$$;

revoke all on function public.create_workspace(text) from public, anon;
revoke all on function public.create_finding(uuid, text, text, text, uuid[]) from public, anon;
grant execute on function public.create_workspace(text) to authenticated;
grant execute on function public.create_finding(uuid, text, text, text, uuid[]) to authenticated;
