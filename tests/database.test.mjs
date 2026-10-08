// Executes the real Supabase migrations against Postgres (PGlite, in process)
// and checks the evidence model, row level security, and integrity rules as
// each Supabase role would meet them.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { before, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const root = join(import.meta.dirname, "..");
const migrations = join(root, "supabase", "migrations");

// The parts of a Supabase database the migrations rely on: its roles, the auth
// schema, auth.uid() reading the request's JWT claims, and the default grants
// Supabase gives every new public table (which the migrations must revoke).
const SUPABASE = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(
      current_setting('request.jwt.claim.sub', true),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

const TABLES = [
  "profiles", "workspaces", "workspace_members", "studies", "participants", "conversations",
  "messages", "visual_displays", "visual_responses", "findings", "finding_evidence",
  "interview_invitations", "interview_resumes", "interview_turn_controls", "interview_lifecycle_outbox",
];

const users = {
  alice: "00000000-0000-4000-8000-00000000000a",  // owner of Alpha
  bob: "00000000-0000-4000-8000-00000000000b",    // member of Alpha
  carol: "00000000-0000-4000-8000-00000000000c",  // owner of Beta, outsider to Alpha
};

let db;
const ids = {};

async function as(role, user, work) {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claims', $1, false)",
    [JSON.stringify(user ? { sub: user, role } : { role })]);
  try {
    return await work();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}
const researcher = (name, work) => as("authenticated", users[name], work);
const pipeline = (work) => as("service_role", null, work);
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const rows = async (sql, params) => (await db.query(sql, params)).rows;

async function conversationIn(workspace, study, alias) {
  const participant = await one(
    "insert into participants (workspace_id, study_id, alias) values ($1, $2, $3) returning id",
    [workspace, study, alias]);
  return (await one(
    `insert into conversations (workspace_id, study_id, participant_id, livekit_room,
                                status, consented_at, consent_version)
     values ($1, $2, $3, $4, 'in_progress', now(), 'test-v1') returning id`,
    [workspace, study, participant.id, `qalvi-demo-${randomUUID()}`])).id;
}

async function message(conversation, sequence, speaker, channel, content, segment = `test:${randomUUID()}`) {
  const scope = await one("select workspace_id, study_id from conversations where id = $1", [conversation]);
  return (await one(
    `insert into messages (workspace_id, study_id, conversation_id, sequence, speaker, channel,
                           content, occurred_at, transport_segment_id)
     values ($1, $2, $3, $4, $5, $6, $7, now(), $8) returning id`,
    [scope.workspace_id, scope.study_id, conversation, sequence, speaker, channel, content, segment])).id;
}

const CARDS = {
  type: "comparison_cards", id: "demo-cards", prompt: "Which of these feels closest to how your week runs?",
  options: [
    { id: "planned", label: "Planned in advance", description: "Mapped out before it starts." },
    { id: "shaped", label: "Shaped as it goes", description: "Priorities shift." },
    { id: "mixed", label: "A mix of both", description: "A few fixed anchors." },
  ],
};
const SLIDER = {
  type: "slider", id: "demo-slider", prompt: "Roughly how much of a typical day gets interrupted?",
  min: 0, max: 100, step: 5, initial: 30, unit: "%",
};

async function display(conversation, action) {
  const scope = await one("select workspace_id, study_id from conversations where id = $1", [conversation]);
  return (await one(
    `insert into visual_displays (workspace_id, study_id, conversation_id, action_id, visual_type,
                                  prompt, definition, issued_at, rendered_at)
     values ($1, $2, $3, $4, $5, $6, $7, now(), now()) returning id`,
    [scope.workspace_id, scope.study_id, conversation, action.id, action.type, action.prompt,
     JSON.stringify(action)])).id;
}

async function respond(conversation, displayId, messageId, type, options = [], value = null) {
  const scope = await one("select workspace_id, study_id from conversations where id = $1", [conversation]);
  return (await one(
    `insert into visual_responses (workspace_id, study_id, conversation_id, display_id, message_id,
                                   visual_type, selected_option_ids, numeric_value)
     values ($1, $2, $3, $4, $5, $6, $7::text[], $8) returning id`,
    [scope.workspace_id, scope.study_id, conversation, displayId, messageId, type, options, value])).id;
}

before(async () => {
  db = new PGlite();
  await db.exec(SUPABASE);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(migrations, file), "utf8"));
  }

  for (const [name, id] of Object.entries(users)) {
    await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)",
      [id, `${name}@example.test`, JSON.stringify({ display_name: name })]);
  }
  ids.alpha = await researcher("alice", async () => (await one("select public.create_workspace('Alpha') id")).id);
  ids.beta = await researcher("carol", async () => (await one("select public.create_workspace('Beta') id")).id);
  await pipeline(() => db.query(
    "insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')",
    [ids.alpha, users.bob]));

  ids.alphaStudy = await researcher("alice", async () => (await one(
    "insert into studies (workspace_id, title) values ($1, 'Focused work') returning id", [ids.alpha])).id);
  ids.betaStudy = await researcher("carol", async () => (await one(
    "insert into studies (workspace_id, title) values ($1, 'Pricing') returning id", [ids.beta])).id);
  await researcher("alice", () => db.query("update studies set status = 'active' where id = $1", [ids.alphaStudy]));

  await pipeline(async () => {
    ids.conversation = await conversationIn(ids.alpha, ids.alphaStudy, "Participant 01");
    ids.betaConversation = await conversationIn(ids.beta, ids.betaStudy, "Participant 01");
    ids.question = await message(ids.conversation, 0, "interviewer", "voice", "How does your week usually run?");
    ids.spoken = await message(ids.conversation, 1, "participant", "voice",
      "Mostly shaped by client messages, honestly.", "seg-1");
    ids.cards = await display(ids.conversation, CARDS);
    ids.picked = await message(ids.conversation, 2, "participant", "visual", 'Chose "A mix of both"');
    await respond(ids.conversation, ids.cards, ids.picked, "comparison_cards", ["mixed"]);
    ids.betaMessage = await message(ids.betaConversation, 0, "participant", "text", "Price matters most.");
  });
});

describe("schema", () => {
  test("every table has row level security enabled", async () => {
    const tables = await rows(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' order by 1`);
    assert.deepEqual(tables.map((table) => table.relname).sort(), [...TABLES].sort());
    for (const table of tables) assert.equal(table.relrowsecurity, true, table.relname);
  });

  test("Supabase's default grants to anon are revoked from every table", async () => {
    const granted = await rows(
      `select table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'anon'`);
    assert.deepEqual(granted, []);
  });

  test("participants hold no direct identifiers", async () => {
    const columns = (await rows(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'participants'"))
      .map((column) => column.column_name);
    for (const identifier of ["name", "full_name", "email", "phone", "user_id"]) {
      assert.ok(!columns.includes(identifier), identifier);
    }
    assert.ok(columns.includes("alias"));
  });

  test("the helper schema is not exposed through the Data API", () => {
    const config = readFileSync(join(root, "supabase", "config.toml"), "utf8");
    const exposed = config.match(/^\s*schemas\s*=\s*\[(.*)\]/m)[1];
    assert.ok(!exposed.includes("private"));
  });

  test("a new account gets a profile, and only accounts do", async () => {
    const profile = await one("select display_name from profiles where id = $1", [users.bob]);
    assert.equal(profile.display_name, "bob");
    assert.equal((await one("select count(*)::int as n from profiles")).n, Object.keys(users).length);
  });
});

describe("access", () => {
  test("anon can read, write, and call nothing", async () => {
    for (const table of TABLES) {
      await assert.rejects(as("anon", null, () => db.query(`select * from ${table}`)), /permission denied/, table);
    }
    await assert.rejects(as("anon", null, () => db.query("select public.create_workspace('x')")), /permission denied/);
    await assert.rejects(as("anon", null, () => db.query("select private.is_workspace_member(gen_random_uuid())")),
      /permission denied/);
  });

  test("members see their workspace's evidence and nothing from any other", async () => {
    for (const name of ["alice", "bob"]) {
      const seen = await researcher(name, () => rows("select id from messages order by sequence"));
      assert.deepEqual(seen.map((row) => row.id), [ids.question, ids.spoken, ids.picked], name);
    }
    const outsider = await researcher("carol", async () => ({
      messages: await rows("select id from messages"),
      studies: await rows("select id from studies"),
      responses: await rows("select id from visual_responses"),
    }));
    assert.deepEqual(outsider.messages.map((row) => row.id), [ids.betaMessage]);
    assert.deepEqual(outsider.studies.map((row) => row.id), [ids.betaStudy]);
    assert.deepEqual(outsider.responses, []);
  });

  test("researchers can never write raw evidence", async () => {
    await researcher("alice", async () => {
      await assert.rejects(db.query(
        `insert into messages (workspace_id, study_id, conversation_id, sequence, speaker, channel, content, occurred_at, transport_segment_id)
         values ($1, $2, $3, 9, 'participant', 'text', 'invented', now(), 'forged:1')`,
        [ids.alpha, ids.alphaStudy, ids.conversation]), /permission denied/);
      await assert.rejects(db.query("update messages set content = 'edited' where id = $1", [ids.spoken]),
        /permission denied/);
      await assert.rejects(db.query("delete from messages where id = $1", [ids.spoken]), /permission denied/);
      await assert.rejects(db.query(
        "insert into conversations (workspace_id, study_id, participant_id) select workspace_id, study_id, participant_id from conversations limit 1"),
        /permission denied/);
      await assert.rejects(db.query("delete from studies where id = $1", [ids.alphaStudy]), /permission denied/);
    });
  });

  test("tenancy, authorship, and provenance cannot be set through the API", async () => {
    await researcher("alice", async () => {
      await assert.rejects(db.query("update studies set workspace_id = $1 where id = $2", [ids.beta, ids.alphaStudy]),
        /permission denied/);
      await assert.rejects(db.query(
        "insert into findings (workspace_id, study_id, title, origin) values ($1, $2, 'x', 'ai')",
        [ids.alpha, ids.alphaStudy]), /permission denied/);
      await assert.rejects(db.query("update findings set created_by = $1", [users.bob]), /permission denied/);
    });
  });

  test("a researcher cannot create research in a workspace they do not belong to", async () => {
    await assert.rejects(researcher("carol", () => db.query(
      "insert into studies (workspace_id, title) values ($1, 'Intrusion')", [ids.alpha])),
      /row-level security/);
    await assert.rejects(researcher("carol", () => db.query(
      "select public.create_finding($1, 'x', null, null, $2::uuid[])", [ids.alphaStudy, [ids.spoken]])),
      /study not found/);
  });

  test("only owners rename a workspace, and membership is not self-service", async () => {
    const byMember = await researcher("bob", () => db.query("update workspaces set name = 'Renamed' where id = $1", [ids.alpha]));
    assert.equal(byMember.affectedRows, 0);
    const byOwner = await researcher("alice", () => db.query("update workspaces set name = 'Alpha team' where id = $1", [ids.alpha]));
    assert.equal(byOwner.affectedRows, 1);
    await assert.rejects(researcher("carol", () => db.query(
      "insert into workspace_members (workspace_id, user_id) values ($1, $2)", [ids.alpha, users.carol])),
      /permission denied/);
  });

  test("teammates see each other's profiles; outsiders do not", async () => {
    const seen = await researcher("alice", () => rows("select id from profiles order by id"));
    assert.deepEqual(seen.map((row) => row.id), [users.alice, users.bob]);
  });
});

describe("raw evidence integrity", () => {
  test("not even the service role can rewrite evidence", async () => {
    await pipeline(async () => {
      await assert.rejects(db.query("update messages set content = 'edited' where id = $1", [ids.spoken]), /immutable/);
      await assert.rejects(db.query("update visual_displays set prompt = 'edited' where id = $1", [ids.cards]), /immutable/);
      await assert.rejects(db.query("update visual_responses set selected_option_ids = '{planned}'"), /immutable/);
    });
    assert.equal((await one("select content from messages where id = $1", [ids.spoken])).content,
      "Mostly shaped by client messages, honestly.");
  });

  test("evidence can only attach to a conversation in its own study and workspace", async () => {
    await assert.rejects(pipeline(() => db.query(
      `insert into messages (workspace_id, study_id, conversation_id, sequence, speaker, channel, content, occurred_at, transport_segment_id)
       values ($1, $2, $3, 50, 'participant', 'text', 'misfiled', now(), 'test:misfiled')`,
      [ids.alpha, ids.alphaStudy, ids.betaConversation])), /foreign key/);
  });

  test("only participants answer on screen, and a retried segment cannot duplicate evidence", async () => {
    await pipeline(async () => {
      await assert.rejects(message(ids.conversation, 10, "interviewer", "visual", "Chose X"), /check constraint/);
      await assert.rejects(message(ids.conversation, 11, "participant", "voice", "again", "seg-1"), /duplicate key/);
      await assert.rejects(message(ids.conversation, 1, "participant", "voice", "same position"), /duplicate key/);
    });
  });

  test("a visual answer must match the display that was shown", async () => {
    await pipeline(async () => {
      const slider = await display(ids.conversation, SLIDER);
      const answer = (sequence) => message(ids.conversation, sequence, "participant", "visual", "Set 40%");

      await assert.rejects(respond(ids.conversation, slider, await answer(20), "slider", [], 140), /outside the slider range/);
      await assert.rejects(respond(ids.conversation, slider, ids.spoken, "slider", [], 40), /foreign key/); // not a visual message
      await assert.rejects(respond(ids.conversation, slider, await answer(21), "comparison_cards", ["mixed"]),
        /does not match the display/);
      await assert.rejects(respond(ids.conversation, ids.cards, await answer(22), "comparison_cards", ["planned"]), /duplicate key/); // already answered
      assert.ok(await respond(ids.conversation, slider, await answer(23), "slider", [], 40));

      const other = await display(ids.conversation, { ...CARDS, id: "demo-cards-2" });
      await assert.rejects(respond(ids.conversation, other, await answer(24), "comparison_cards", ["invented"]), /not shown/);
      await assert.rejects(respond(ids.conversation, other, await answer(25), "comparison_cards", ["planned", "mixed"]),
        /check constraint/);
      // The searchable columns can never disagree with the snapshot of what was shown.
      await assert.rejects(db.query(
        `insert into visual_displays (workspace_id, study_id, conversation_id, action_id, visual_type, prompt, definition, issued_at)
         values ($1, $2, $3, 'demo-cards-3', 'bar_chart', $4, $5, now())`,
        [ids.alpha, ids.alphaStudy, ids.conversation, CARDS.prompt, JSON.stringify({ ...CARDS, id: "demo-cards-3" })]),
        /check constraint/);
    });
  });

  test("original messages are searchable without any derived data", async () => {
    const found = await researcher("bob", () => rows(
      "select id from messages where study_id = $1 and speaker = 'participant' and content_search @@ plainto_tsquery('simple', 'client')",
      [ids.alphaStudy]));
    assert.deepEqual(found.map((row) => row.id), [ids.spoken]);
  });
});

describe("live interview persistence foundation", () => {
  const hash = () => randomBytes(32).toString("hex");
  const now = () => new Date().toISOString();
  const append = (conversation, generation, eventKey, content, occurredAt, speaker = "participant", channel = "text") =>
    one(`select * from public.append_interview_message($1,$2,$3,$4,$5,$6,$7)` ,
      [conversation, generation, eventKey, speaker, channel, content, occurredAt]);
  const issueInvitation = async (study = ids.alphaStudy, workspace = ids.alpha, issuer = users.alice) => {
    const token = hash();
    const id = await pipeline(async () => (await one(
      `insert into interview_invitations(workspace_id, study_id, issued_by, token_hash)
       values ($1,$2,$3,$4) returning id`, [workspace, study, issuer, token])).id);
    return { id, token };
  };
  const claim = async (token, resume = hash(), room = `qalvi-real-${randomUUID()}`) =>
    pipeline(async () => (await one(
      "select public.claim_interview_invitation($1,$2,$3,'consent-v1') as id",
      [token, resume, room])).id);

  test("privileged RPCs have a safe search path and only service_role execution", async () => {
    const names = ["claim_interview_invitation", "resolve_interview_resume", "claim_conversation_writer",
      "transition_interview_conversation", "append_interview_message", "issue_interview_visual",
      "acknowledge_interview_visual", "append_interview_visual_response",
      "append_recoverable_interview_message", "record_interview_turn_control",
      "read_participant_interview_recovery", "claim_interview_invitation_with_profile",
      "reserve_interview_transport", "confirm_interview_transport",
      "rotate_interview_transport", "fail_interview_transport",
      "report_interview_transport_connection_failure"];
    for (const name of names) {
      const routine = await one(
        `select p.oid::regprocedure::text as signature, p.prosecdef, p.proconfig
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = $1`, [name]);
      assert.equal(routine.prosecdef, true, name);
      assert.ok(routine.proconfig.some((setting) => setting.startsWith("search_path=")), name);
      const permissions = await one(
        `select has_function_privilege('anon', $1::regprocedure, 'EXECUTE') as anon,
                has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') as researcher,
                has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') as service`,
        [routine.signature]);
      assert.deepEqual(permissions, { anon: false, researcher: false, service: true }, name);
    }
    await assert.rejects(researcher("alice", () => db.query(
      "select public.claim_conversation_writer($1, 'x')", [ids.conversation])), /permission denied/);
    await assert.rejects(as("anon", null, () => db.query(
      "select public.resolve_interview_resume($1)", [hash()])), /permission denied/);
  });

  test("invitation scope, issuer membership, expiry, and single use are enforced", async () => {
    await assert.rejects(pipeline(() => db.query(
      `insert into interview_invitations(workspace_id, study_id, issued_by, token_hash)
       values ($1,$2,$3,$4)`, [ids.beta, ids.alphaStudy, users.carol, hash()])), /foreign key/);
    await assert.rejects(pipeline(() => db.query(
      `insert into interview_invitations(workspace_id, study_id, issued_by, token_hash)
       values ($1,$2,$3,$4)`, [ids.alpha, ids.alphaStudy, users.carol, hash()])), /issuer must belong/);
    await assert.rejects(pipeline(() => db.query(
      `insert into interview_invitations(workspace_id, study_id, issued_by, token_hash, expires_at)
       values ($1,$2,$3,$4, now() + interval '8 days')`,
      [ids.alpha, ids.alphaStudy, users.alice, hash()])), /check constraint/);
    const { id, token } = await issueInvitation();
    await assert.rejects(pipeline(() => db.query(
      "update interview_invitations set study_id = $1 where id = $2", [ids.betaStudy, id])), /cannot be rewritten/);
    const conversation = await claim(token);
    assert.equal((await one("select status, consent_version from conversations where id = $1", [conversation])).status, "pending");
    assert.equal((await one("select consent_version from conversations where id = $1", [conversation])).consent_version, "consent-v1");
    await assert.rejects(claim(token), /invitation is unavailable/);
    const saved = await one("select count(*)::int as n from conversations where id = $1", [conversation]);
    assert.equal(saved.n, 1);
    assert.equal((await one("select count(*)::int as n from participants where id = (select participant_id from conversations where id = $1)",
      [conversation])).n, 1);
    const simultaneous = await issueInvitation();
    const attempts = await pipeline(() => Promise.allSettled([
      db.query("select public.claim_interview_invitation($1,$2,$3,'consent-v1') as id",
        [simultaneous.token, hash(), `qalvi-real-${randomUUID()}`]),
      db.query("select public.claim_interview_invitation($1,$2,$3,'consent-v1') as id",
        [simultaneous.token, hash(), `qalvi-real-${randomUUID()}`]),
    ]));
    assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 1);
    assert.equal((await one("select count(*)::int as n from conversations where id = (select conversation_id from interview_invitations where id = $1)",
      [simultaneous.id])).n, 1);
    const revoked = await issueInvitation();
    await pipeline(() => db.query("update interview_invitations set revoked_at = now() where id = $1", [revoked.id]));
    await assert.rejects(claim(revoked.token), /invitation is unavailable/);
    const expired = await issueInvitation();
    await pipeline(() => db.query(
      "update interview_invitations set revoked_at = now() where id = $1", [expired.id]));
    const pastHash = hash();
    await pipeline(() => db.query(
      `insert into interview_invitations(workspace_id, study_id, issued_by, token_hash, created_at, expires_at)
       values ($1,$2,$3,$4, now() - interval '8 days', now() - interval '1 day')`,
      [ids.alpha, ids.alphaStudy, users.alice, pastHash]));
    await assert.rejects(claim(pastHash), /invitation is unavailable/);
  });

  test("resume hashes are unique, limited to 24 hours, and revocable", async () => {
    const invite = await issueInvitation();
    const resume = hash();
    const conversation = await claim(invite.token, resume);
    assert.equal((await pipeline(() => one("select public.resolve_interview_resume($1) as id", [resume]))).id,
      conversation);
    await assert.rejects(pipeline(() => db.query(
      "insert into interview_resumes(conversation_id, token_hash) values ($1,$2)",
      [conversation, resume])), /duplicate key/);
    await assert.rejects(pipeline(() => db.query(
      `insert into interview_resumes(conversation_id, token_hash, expires_at)
       values ($1,$2,now() + interval '25 hours')`, [conversation, hash()])), /check constraint/);
    await pipeline(() => db.query(
      "update interview_resumes set revoked_at = now() where token_hash = $1", [resume]));
    assert.equal((await pipeline(() => one("select public.resolve_interview_resume($1) as id", [resume]))).id, null);
    await pipeline(() => db.query(
      "insert into interview_resumes(conversation_id, token_hash) values ($1,$2)", [conversation, hash()]));
    const another = await claim((await issueInvitation()).token);
    await pipeline(() => db.query("update interview_resumes set revoked_at = now() where conversation_id = $1", [another]));
    const expiredHash = hash();
    await pipeline(() => db.query(
      `insert into interview_resumes(conversation_id, token_hash, created_at, expires_at)
       values ($1,$2,now() - interval '25 hours',now() - interval '1 hour')`, [another, expiredHash]));
    assert.equal((await pipeline(() => one("select public.resolve_interview_resume($1) as id", [expiredHash]))).id, null);
  });

  test("writer generations fence replacements; ordered append retries do not duplicate evidence", async () => {
    const invite = await issueInvitation();
    const room = `qalvi-real-${randomUUID()}`;
    const conversation = await claim(invite.token, hash(), room);
    const firstWriter = (await pipeline(() => one(
      "select public.claim_conversation_writer($1,$2) as n", [conversation, room]))).n;
    const at = now();
    const first = await pipeline(() => append(conversation, firstWriter, "chat:one", "First answer", at));
    const replay = await pipeline(() => append(conversation, firstWriter, "chat:one", "First answer", at));
    assert.deepEqual(replay, { ...first, inserted: false });
    await assert.rejects(pipeline(() => append(conversation, firstWriter, "chat:one", "Different answer", at)),
      /conflicting payload/);
    const secondWriter = (await pipeline(() => one(
      "select public.claim_conversation_writer($1,$2) as n", [conversation, room]))).n;
    assert.equal(secondWriter, firstWriter + 1);
    await assert.rejects(pipeline(() => append(conversation, firstWriter, "chat:two", "Stale", now())),
      /not writable by this generation/);
    const results = await pipeline(async () => [
      await append(conversation, secondWriter, "voice:two", "Second answer", now(), "participant", "voice"),
      await append(conversation, secondWriter, "agent:three", "Follow-up", now(), "interviewer", "text"),
    ]);
    assert.deepEqual([first, ...results].map((item) => item.message_sequence), [0, 1, 2]);
    assert.deepEqual((await rows("select sequence, content from messages where conversation_id = $1 order by sequence", [conversation]))
      .map((row) => row.content), ["First answer", "Second answer", "Follow-up"]);
    await assert.rejects(pipeline(() => db.query(
      "select public.transition_interview_conversation($1,$2,'completed')", [conversation, firstWriter])),
      /stale conversation writer/);
    await pipeline(() => db.query(
      "select public.transition_interview_conversation($1,$2,'completed')", [conversation, secondWriter]));
    const finalTime = (await one(
      "select occurred_at from messages where conversation_id = $1 and transport_segment_id = 'agent:three'",
      [conversation])).occurred_at;
    const terminalReplay = await pipeline(() => append(conversation, secondWriter, "agent:three",
      "Follow-up", finalTime, "interviewer", "text"));
    assert.equal(terminalReplay.inserted, false);
    await assert.rejects(pipeline(() => append(conversation, secondWriter, "agent:four", "Too late", now(), "interviewer")),
      /not writable by this generation/);
  });

  test("lifecycle transitions require consent and reject impossible resumptions", async () => {
    const invite = await issueInvitation();
    const room = `qalvi-real-${randomUUID()}`;
    const resume = hash();
    const conversation = await claim(invite.token, resume, room);
    await assert.rejects(pipeline(() => db.query(
      "select public.transition_interview_conversation($1,0,'completed')", [conversation])),
      /invalid conversation status transition/);
    const generation = (await pipeline(() => one(
      "select public.claim_conversation_writer($1,$2) as n", [conversation, room]))).n;
    await pipeline(() => db.query(
      "select public.transition_interview_conversation($1,$2,'interrupted')", [conversation, generation]));
    assert.equal((await one("select status from conversations where id = $1", [conversation])).status, "interrupted");
    const resumed = (await pipeline(() => one(
      "select public.claim_conversation_writer($1,$2) as n", [conversation, room]))).n;
    await pipeline(() => db.query(
      "select public.transition_interview_conversation($1,$2,'completed')", [conversation, resumed]));
    await assert.rejects(pipeline(() => db.query(
      "select public.claim_conversation_writer($1,$2)", [conversation, room])), /cannot accept a writer/);
    await assert.rejects(pipeline(() => db.query(
      "update conversations set status = 'pending' where id = $1", [conversation])), /invalid conversation status transition/);
    await assert.rejects(pipeline(() => db.query(
      "update conversations set consent_version = 'changed' where id = $1", [conversation])), /consent is immutable/);
    assert.equal((await one("select ended_at is not null as ended from conversations where id = $1", [conversation])).ended, true);
    assert.equal((await pipeline(() => one("select public.resolve_interview_resume($1) as id", [resume]))).id, null);
  });

  test("visual issue, render receipt and answer are distinct atomic evidence steps", async () => {
    const invite = await issueInvitation();
    const room = `qalvi-real-${randomUUID()}`;
    const conversation = await claim(invite.token, hash(), room);
    const generation = (await pipeline(() => one(
      "select public.claim_conversation_writer($1,$2) as n", [conversation, room]))).n;
    const displayId = (await pipeline(() => one(
      "select public.issue_interview_visual($1,$2,$3::jsonb) as id",
      [conversation, generation, JSON.stringify(CARDS)]))).id;
    assert.equal((await one("select rendered_at from visual_displays where id = $1", [displayId])).rendered_at, null);
    await assert.rejects(pipeline(() => db.query(
      "select * from public.append_interview_visual_response($1,$2,$3,$4,$5,$6,$7::text[],$8)",
      [conversation, generation, "visual:one", CARDS.id, "Chose mixed", now(), ["mixed"], null])),
      /not rendered/);
    assert.equal((await one("select count(*)::int as n from messages where conversation_id = $1", [conversation])).n, 0);
    await pipeline(() => db.query("select public.acknowledge_interview_visual($1,$2,$3)",
      [conversation, generation, CARDS.id]));
    const issued = await one("select issued_at, rendered_at from visual_displays where id = $1", [displayId]);
    assert.ok(issued.rendered_at >= issued.issued_at);
    const at = now();
    const saved = await pipeline(() => one(
      "select * from public.append_interview_visual_response($1,$2,$3,$4,$5,$6,$7::text[],$8)",
      [conversation, generation, "visual:one", CARDS.id, "Chose mixed", at, ["mixed"], null]));
    const replay = await pipeline(() => one(
      "select * from public.append_interview_visual_response($1,$2,$3,$4,$5,$6,$7::text[],$8)",
      [conversation, generation, "visual:one", CARDS.id, "Chose mixed", at, ["mixed"], null]));
    assert.equal(saved.message_sequence, 0);
    assert.deepEqual(replay, { ...saved, inserted: false });
    await assert.rejects(pipeline(() => db.query(
      "select * from public.append_interview_visual_response($1,$2,$3,$4,$5,$6,$7::text[],$8)",
      [conversation, generation, "visual:one", CARDS.id, "Chose mixed", at, ["planned"], null])),
      /conflicting visual answer/);
    await assert.rejects(pipeline(() => db.query(
      "select * from public.append_interview_message($1,$2,$3,'participant','visual',$4,$5)",
      [conversation, generation, "visual:bypass", "Forged", now()])), /atomic visual-response/);
    const answer = await one("select message_id, selected_option_ids from visual_responses where display_id = $1", [displayId]);
    assert.equal(answer.message_id, saved.message_id);
    assert.deepEqual(answer.selected_option_ids, ["mixed"]);
    await assert.rejects(pipeline(() => db.query(
      "update visual_displays set prompt = 'rewritten' where id = $1", [displayId])), /immutable/);
    const wrongStudy = await issueInvitation(ids.betaStudy, ids.beta, users.carol);
    await pipeline(() => db.query("update studies set status = 'active' where id = $1", [ids.betaStudy]));
    const otherConversation = await claim(wrongStudy.token);
    const otherRoom = (await one("select livekit_room from conversations where id = $1", [otherConversation])).livekit_room;
    const otherGeneration = (await pipeline(() => one(
      "select public.claim_conversation_writer($1,$2) as n", [otherConversation, otherRoom]))).n;
    await assert.rejects(pipeline(() => db.query(
      "select * from public.append_interview_visual_response($1,$2,$3,$4,$5,$6,$7::text[],$8)",
      [otherConversation, otherGeneration, "visual:foreign", CARDS.id, "Chose mixed", now(), ["mixed"], null])),
      /not rendered/);
  });

  test("versioned participant controls are immutable, idempotent and conversation-bound", async () => {
    const invite = await issueInvitation();
    const room = `qalvi-real-${randomUUID()}`;
    const conversation = await claim(invite.token, hash(), room);
    const generation = (await pipeline(() => one(
      "select public.claim_conversation_writer($1,$2) as n", [conversation, room]))).n;
    const at = now();
    const saved = await pipeline(() => one(
      "select * from public.append_recoverable_interview_message($1,$2,$3,'text',$4,$5)",
      [conversation, generation, "text:stable", "A canonical answer", at]));
    const retry = await pipeline(() => one(
      "select * from public.append_recoverable_interview_message($1,$2,$3,'text',$4,$5)",
      [conversation, generation, "text:stable", "A canonical answer", at]));
    assert.deepEqual(retry, { ...saved, inserted: false });
    assert.equal((await one("select control_protocol_version from messages where id = $1", [saved.message_id])).control_protocol_version, 1);
    const signals = { intent: "continue", engagement: "neutral", covered: [], partial: [], probe: null, ambiguous: false };
    const record = (target = saved.message_id, decision = "continue", owner = conversation) =>
      pipeline(() => one("select public.record_interview_turn_control($1,$2,$3,$4::jsonb,$5,$6) as id",
        [owner, generation, target, JSON.stringify(signals), decision, "a".repeat(64)]));
    assert.equal((await record()).id, saved.message_id);
    assert.equal((await record()).id, saved.message_id);
    assert.equal((await one("select count(*)::int as n from interview_turn_controls where message_id = $1", [saved.message_id])).n, 1);
    await assert.rejects(record(saved.message_id, "stop"), /conflicting control/);
    await assert.rejects(pipeline(() => db.query(
      "update interview_turn_controls set decision_action = 'stop' where message_id = $1", [saved.message_id])), /immutable|permission denied/);
    const assistant = await pipeline(() => append(conversation, generation, "assistant:one", "Hello", now(), "interviewer"));
    await assert.rejects(record(assistant.message_id), /versioned participant/);
    const legacy = await pipeline(() => append(conversation, generation, "text:legacy", "Old answer", now()));
    await assert.rejects(record(legacy.message_id), /versioned participant/);
    const otherInvite = await issueInvitation();
    const otherRoom = `qalvi-real-${randomUUID()}`;
    const other = await claim(otherInvite.token, hash(), otherRoom);
    await assert.rejects(record(saved.message_id, "continue", other), /not writable|versioned participant/);
    await assert.rejects(researcher("alice", () => db.query(
      "select public.record_interview_turn_control($1,$2,$3,$4::jsonb,$5,$6)",
      [conversation, generation, saved.message_id, JSON.stringify(signals), "continue", "a".repeat(64)])), /permission denied/);
    await assert.rejects(researcher("alice", () => db.query(
      "select * from interview_turn_controls where message_id = $1", [saved.message_id])), /permission denied/);
    await assert.rejects(as("anon", null, () => db.query(
      "select * from interview_turn_controls where message_id = $1", [saved.message_id])), /permission denied/);
  });

  test("immutable controls allow authorized whole-study cleanup without allowing direct deletion", async () => {
    const study = (await pipeline(() => one(
      "insert into studies (workspace_id, title, status) values ($1,'Control cascade cleanup','active') returning id",
      [ids.alpha]))).id;
    const invite = await issueInvitation(study, ids.alpha, users.alice);
    const room = `qalvi-real-${randomUUID()}`;
    const conversation = await claim(invite.token, hash(), room);
    const generation = (await pipeline(() => one(
      "select public.claim_conversation_writer($1,$2) as n", [conversation, room]))).n;
    const saved = await pipeline(() => one(
      "select * from public.append_recoverable_interview_message($1,$2,$3,'text',$4,$5)",
      [conversation, generation, "text:cleanup", "A canonical answer", now()]));
    const signals = { intent: "continue", engagement: "neutral", covered: [], partial: [], probe: null, ambiguous: false };
    await pipeline(() => db.query(
      "select public.record_interview_turn_control($1,$2,$3,$4::jsonb,'continue',$5)",
      [conversation, generation, saved.message_id, JSON.stringify(signals), "a".repeat(64)]));
    await assert.rejects(db.query("delete from interview_turn_controls where message_id = $1", [saved.message_id]), /immutable/);
    await assert.rejects(pipeline(() => db.query(
      "delete from interview_turn_controls where message_id = $1", [saved.message_id])), /permission denied/);
    await assert.rejects(db.query(
      "update interview_turn_controls set decision_action = 'stop' where message_id = $1", [saved.message_id]), /immutable/);
    await pipeline(() => db.query("delete from studies where id = $1", [study]));
    assert.equal((await one("select count(*)::int as n from messages where conversation_id = $1", [conversation])).n, 0);
    assert.equal((await one("select count(*)::int as n from interview_turn_controls where conversation_id = $1", [conversation])).n, 0);
  });

  test("recovery reads only one resume's ordered evidence and allows terminal read-only state", async () => {
    const invite = await issueInvitation();
    const resume = hash();
    const room = `qalvi-real-${randomUUID()}`;
    const conversation = await claim(invite.token, resume, room);
    const generation = (await pipeline(() => one(
      "select public.claim_conversation_writer($1,$2) as n", [conversation, room]))).n;
    await pipeline(() => append(conversation, generation, "assistant:greeting", "Welcome", now(), "interviewer"));
    await pipeline(() => one("select * from public.append_recoverable_interview_message($1,$2,$3,'text',$4,$5)",
      [conversation, generation, "text:answer", "My answer", now()]));
    const read = async (capability, after = -1, limit = 100) => (await pipeline(() => one(
      "select public.read_participant_interview_recovery($1,$2,$3) as state", [capability, after, limit]))).state;
    const first = await read(resume, -1, 1);
    assert.equal(first.messages.length, 1);
    assert.equal(first.hasMore, true);
    const second = await read(resume, first.nextCursor, 1);
    assert.equal(second.messages.length, 1);
    assert.ok(first.messages[0].sequence < second.messages[0].sequence);
    assert.equal(second.messages[0].eventKey, "text:answer");
    assert.equal(second.controlPending, true);
    assert.equal(second.replyUnconfirmed, true);
    assert.equal(first.workspace_id, undefined);
    assert.equal(first.messages[0].study_id, undefined);
    assert.equal(await read(hash()), null);
    assert.equal(await read(resume, -2), null);
    await pipeline(() => db.query(
      "select public.transition_interview_conversation($1,$2,'completed')", [conversation, generation]));
    assert.equal((await read(resume)).status, "completed");
    await assert.rejects(pipeline(() => db.query(
      "select public.claim_conversation_writer($1,$2)", [conversation, room])), /cannot accept a writer/);
    await pipeline(() => db.query("update interview_resumes set revoked_at = now() where token_hash = $1", [resume]));
    assert.equal(await read(resume), null);
    const expired = hash();
    await pipeline(() => db.query(
      "insert into interview_resumes(conversation_id, token_hash, created_at, expires_at) values ($1,$2,now()-interval '2 days',now()-interval '1 day')",
      [conversation, expired]));
    assert.equal(await read(expired), null);
  });
});

describe("server boundary", () => {
  const source = (path) => readFileSync(join(root, path), "utf8");
  const clientFiles = () => readdirSync(join(root, "src"), { recursive: true })
    .filter((path) => /\.tsx?$/.test(path))
    .filter((path) => /^\s*["']use client["']/.test(source(join("src", path))));

  test("the Supabase secret key is only read by a server-only module", () => {
    const secret = source("src/lib/supabase/secret.ts");
    assert.match(secret, /^import "server-only";/);
    assert.match(secret, /process\.env\.SUPABASE_SECRET_KEY/);
    assert.match(source("src/lib/supabase/server.ts"), /^import "server-only";/);
    for (const path of readdirSync(join(root, "src"), { recursive: true }).filter((p) => /\.tsx?$/.test(p))) {
      const text = source(join("src", path));
      assert.doesNotMatch(text, /NEXT_PUBLIC_[A-Z_]*SECRET/, path);
      if (!path.endsWith("secret.ts")) assert.doesNotMatch(text, /SUPABASE_SECRET_KEY/, path);
    }
  });

  test("no client component imports a server Supabase client", () => {
    for (const path of clientFiles()) {
      assert.doesNotMatch(source(join("src", path)), /supabase\/(server|secret)/, path);
    }
  });

  test("the env template carries placeholders, never credentials", () => {
    const template = source(".env.example");
    for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]) {
      assert.match(template, new RegExp(`^${name}=`, "m"), name);
    }
    assert.doesNotMatch(template, /eyJ[A-Za-z0-9_-]{10,}|sb_(publishable|secret)_[A-Za-z0-9]{8,}/);
  });
});

describe("findings and their evidence", () => {
  test("a researcher's finding is written together with the messages that support it", async () => {
    const finding = await researcher("alice", async () => (await one(
      "select public.create_finding($1, 'Client messages drive the week', null, 'behaviour', $2::uuid[]) as id",
      [ids.alphaStudy, [ids.spoken, ids.picked, ids.spoken]])).id);
    const saved = await one("select origin, status, created_by from findings where id = $1", [finding]);
    assert.deepEqual(saved, { origin: "researcher", status: "accepted", created_by: users.alice });
    const links = await rows(
      `select m.id, m.speaker, m.channel, e.relation from finding_evidence e join messages m on m.id = e.message_id
       where e.finding_id = $1 order by m.sequence`, [finding]);
    assert.deepEqual(links.map((link) => link.id), [ids.spoken, ids.picked]);
    // An on-screen answer is cited through its message, and its structured value is one join away.
    const structured = await one("select selected_option_ids from visual_responses where message_id = $1", [ids.picked]);
    assert.deepEqual(structured.selected_option_ids, ["mixed"]);
  });

  test("no finding can exist without supporting evidence", async () => {
    await assert.rejects(pipeline(() => db.query(
      "insert into findings (workspace_id, study_id, title, origin, ai_metadata) values ($1, $2, 'Unsupported', 'ai', '{}')",
      [ids.alpha, ids.alphaStudy])), /must cite at least one supporting message/);
    await assert.rejects(researcher("alice", () => db.query(
      "select public.create_finding($1, 'Unsupported', null, null, '{}'::uuid[])", [ids.alphaStudy])),
      /must cite at least one supporting message/);
    assert.equal((await one("select count(*)::int as n from findings where title = 'Unsupported'")).n, 0);
  });

  test("counter-evidence can be linked, but the last supporting link cannot be removed", async () => {
    await researcher("bob", async () => {
      const finding = (await one(
        "select public.create_finding($1, 'Weeks are reactive', null, 'behaviour', $2::uuid[]) as id",
        [ids.alphaStudy, [ids.spoken]])).id;
      await db.query(
        `insert into finding_evidence (finding_id, message_id, workspace_id, study_id, relation, note)
         values ($1, $2, $3, $4, 'contradicts', 'They chose a mix, not fully reactive')`,
        [finding, ids.picked, ids.alpha, ids.alphaStudy]);
      await assert.rejects(db.query("delete from finding_evidence where finding_id = $1 and message_id = $2", [finding, ids.spoken]),
        /must cite at least one supporting message/);
      await assert.rejects(db.query("update finding_evidence set relation = 'contradicts' where finding_id = $1 and message_id = $2",
        [finding, ids.spoken]), /must cite at least one supporting message/);
      await db.query("delete from finding_evidence where finding_id = $1 and message_id = $2", [finding, ids.picked]);
      const remaining = await rows("select message_id, relation from finding_evidence where finding_id = $1", [finding]);
      assert.deepEqual(remaining, [{ message_id: ids.spoken, relation: "supports" }]);
    });
  });

  test("a finding cannot cite evidence from another study", async () => {
    await assert.rejects(researcher("alice", () => db.query(
      "select public.create_finding($1, 'Mixed sources', null, null, $2::uuid[])", [ids.alphaStudy, [ids.betaMessage]])),
      /foreign key/);
  });

  test("cited evidence cannot be deleted from under a finding, but a whole study can be", async () => {
    const study = await researcher("alice", async () => (await one(
      "insert into studies (workspace_id, title) values ($1, 'Disposable') returning id", [ids.alpha])).id);
    const cited = await pipeline(async () => {
      const conversation = await conversationIn(ids.alpha, study, "Participant 09");
      return message(conversation, 0, "participant", "text", "Evidence worth keeping.");
    });
    await researcher("alice", () => db.query(
      "select public.create_finding($1, 'Kept', null, null, $2::uuid[])", [study, [cited]]));

    await assert.rejects(pipeline(() => db.query("delete from messages where id = $1", [cited])), /foreign key/);
    await pipeline(() => db.query("delete from studies where id = $1", [study]));
    for (const table of ["participants", "conversations", "messages", "findings", "finding_evidence"]) {
      assert.equal((await one(`select count(*)::int as n from ${table} where study_id = $1`, [study])).n, 0, table);
    }
  });
});

describe("LiveKit profile routing and transport fencing", () => {
  test("a profile claim and pre-evidence rotation keep one consented conversation and participant", async () => {
    const invitationHash = randomBytes(32).toString("hex");
    const resumeHash = randomBytes(32).toString("hex");
    const firstRoom = `qalvi-real-${randomUUID()}`;
    const secondRoom = `qalvi-real-${randomUUID()}`;
    await pipeline(() => db.query(
      `insert into interview_invitations(workspace_id, study_id, issued_by, token_hash)
       values ($1,$2,$3,$4)`, [ids.alpha, ids.alphaStudy, users.alice, invitationHash]));
    const conversationId = await pipeline(async () => (await one(
      "select public.claim_interview_invitation_with_profile($1,$2,$3,'consent-v1','primary') as id",
      [invitationHash, resumeHash, firstRoom])).id);
    const first = await one("select participant_id, livekit_profile_id, transport_generation from conversations where id = $1",
      [conversationId]);
    assert.equal(first.livekit_profile_id, "primary");
    assert.equal(first.transport_generation, 1);
    const nonce = randomUUID();
    assert.equal((await pipeline(() => one(
      "select public.reserve_interview_transport($1,'primary',1,$2,50) as reserved",
      [conversationId, nonce]))).reserved, true);
    assert.equal((await pipeline(() => one(
      "select public.reserve_interview_transport($1,'primary',1,$2,50) as reserved",
      [conversationId, randomUUID()]))).reserved, false);
    const rotated = await pipeline(() => one(
      "select public.rotate_interview_transport($1,'primary',1,$2,$3,'backup_1',$4,'assignment_timeout') as generation",
      [conversationId, firstRoom, nonce, secondRoom]));
    assert.equal(rotated.generation, 2);
    const second = await one(`select participant_id, livekit_profile_id, livekit_room,
      transport_generation, previous_livekit_profile_id, transport_failed_profiles,
      transport_failure_reason from conversations where id = $1`, [conversationId]);
    assert.equal(second.participant_id, first.participant_id);
    assert.equal(second.livekit_profile_id, "backup_1");
    assert.equal(second.livekit_room, secondRoom);
    assert.equal(second.transport_generation, 2);
    assert.equal(second.previous_livekit_profile_id, "primary");
    assert.deepEqual(second.transport_failed_profiles, ["primary"]);
    assert.equal(second.transport_failure_reason, "assignment_timeout");
    assert.equal((await one("select count(*)::int as n from messages where conversation_id = $1",
      [conversationId])).n, 0);
    assert.equal((await one("select count(*)::int as n from participants where id = $1",
      [first.participant_id])).n, 1);
    await assert.rejects(pipeline(() => db.query(
      "select public.rotate_interview_transport($1,'primary',1,$2,$3,'backup_1',$4,'quota')",
      [conversationId, firstRoom, nonce, `qalvi-real-${randomUUID()}`])), /unsafe or stale/);
    const secondNonce = randomUUID();
    assert.equal((await pipeline(() => one(
      "select public.reserve_interview_transport($1,'backup_1',2,$2,50) as reserved",
      [conversationId, secondNonce]))).reserved, true);
    assert.equal((await pipeline(() => one(
      "select public.confirm_interview_transport($1,'backup_1',2,$2) as confirmed",
      [conversationId, secondNonce]))).confirmed, true);
    const generation = await pipeline(async () => (await one(
      "select public.claim_conversation_writer($1,$2) as generation",
      [conversationId, secondRoom])).generation);
    assert.equal(generation, 1);
    await assert.rejects(pipeline(() => db.query(
      "select public.rotate_interview_transport($1,'backup_1',2,$2,$3,'primary',$4,'quota')",
      [conversationId, secondRoom, secondNonce, `qalvi-real-${randomUUID()}`])), /unsafe or stale/);
    await assert.rejects(researcher("alice", () => db.query(
      "select public.reserve_interview_transport($1,'backup_1',2,$2,50)",
      [conversationId, randomUUID()])), /permission denied/);
    await assert.rejects(as("anon", null, () => db.query(
      "select public.rotate_interview_transport($1,'backup_1',2,$2,$3,'primary',$4,'quota')",
      [conversationId, secondRoom, secondNonce, `qalvi-real-${randomUUID()}`])), /permission denied/);
  });

  test("two distinct failed WebRTC connects are counted once each and fenced to the pending generation", async () => {
    const invitationHash = randomBytes(32).toString("hex");
    const firstRoom = `qalvi-real-${randomUUID()}`;
    await pipeline(() => db.query(
      `insert into interview_invitations(workspace_id, study_id, issued_by, token_hash)
       values ($1,$2,$3,$4)`, [ids.alpha, ids.alphaStudy, users.alice, invitationHash]));
    const conversationId = await pipeline(async () => (await one(
      "select public.claim_interview_invitation_with_profile($1,$2,$3,'consent-v1','primary') as id",
      [invitationHash, randomBytes(32).toString("hex"), firstRoom])).id);
    const nonce = randomUUID();
    await pipeline(() => db.query("select public.reserve_interview_transport($1,'primary',1,$2,50)",
      [conversationId, nonce]));
    await pipeline(() => db.query("select public.confirm_interview_transport($1,'primary',1,$2)",
      [conversationId, nonce]));
    const eventA = randomUUID();
    const eventB = randomUUID();
    const report = (generation, event) => pipeline(() => one(
      "select public.report_interview_transport_connection_failure($1,$2,$3) as count",
      [conversationId, generation, event]));
    assert.equal((await report(1, eventA)).count, 1);
    assert.equal((await report(1, eventA)).count, 1);
    assert.equal((await report(1, eventB)).count, 2);
    const reserved = randomUUID();
    assert.equal((await pipeline(() => one(
      "select public.reserve_interview_transport($1,'primary',1,$2,50) as reserved",
      [conversationId, reserved]))).reserved, true);
    await pipeline(() => db.query(
      "select public.rotate_interview_transport($1,'primary',1,$2,$3,'backup_1',$4,'transport_unavailable')",
      [conversationId, firstRoom, reserved, `qalvi-real-${randomUUID()}`]));
    const after = await one("select transport_generation, transport_connection_failures from conversations where id = $1",
      [conversationId]);
    assert.equal(after.transport_generation, 2);
    assert.equal(after.transport_connection_failures, 0);
    await assert.rejects(report(1, eventA), /stale or unsafe/);
    const secondNonce = randomUUID();
    assert.equal((await pipeline(() => one(
      "select public.reserve_interview_transport($1,'backup_1',2,$2,50) as reserved",
      [conversationId, secondNonce]))).reserved, true);
    assert.equal((await pipeline(() => one(
      "select public.confirm_interview_transport($1,'backup_1',2,$2) as confirmed",
      [conversationId, secondNonce]))).confirmed, true);
    await pipeline(() => message(conversationId, 0, "participant", "text", "Persisted before the report."));
    // A direct canonical row must also fence browser reports, even if a
    // legacy writer has not advanced next_message_sequence yet.
    assert.equal((await one("select next_message_sequence from conversations where id = $1",
      [conversationId])).next_message_sequence, 0);
    await assert.rejects(report(2, randomUUID()), /stale or unsafe/);
    await assert.rejects(researcher("alice", () => db.query(
      "select public.report_interview_transport_connection_failure($1,2,$2)",
      [conversationId, randomUUID()])), /permission denied/);
  });
});

describe("writer lease, replacement recovery and terminal lifecycle (2B.4B)", () => {
  const hash = () => randomBytes(32).toString("hex");
  const now = () => new Date().toISOString();
  const LEASE = 30;
  async function started({ profile = "primary" } = {}) {
    const token = hash();
    const resume = hash();
    const room = `qalvi-real-${randomUUID()}`;
    await pipeline(() => db.query(
      "insert into interview_invitations(workspace_id, study_id, issued_by, token_hash) values ($1,$2,$3,$4)",
      [ids.alpha, ids.alphaStudy, users.alice, token]));
    const conversation = (await pipeline(() => one(
      "select public.claim_interview_invitation_with_profile($1,$2,$3,'consent-v1',$4) as id",
      [token, resume, room, profile]))).id;
    return { conversation, room, resume };
  }
  const claimLease = (conversation, room, job, profile = "primary", seconds = LEASE) =>
    pipeline(async () => (await one(
      "select public.claim_interview_writer_lease($1,$2,$3,$4,$5) as lease",
      [conversation, room, profile, job, seconds])).lease);
  const heartbeat = (conversation, generation, job) => pipeline(async () => (await one(
    "select public.heartbeat_interview_writer($1,$2,$3,$4) as beat", [conversation, generation, job, LEASE])).beat);
  const append = (conversation, generation, key, content) => pipeline(() => one(
    "select * from public.append_interview_message($1,$2,$3,'participant','text',$4,$5)",
    [conversation, generation, key, content, now()]));
  const expireLease = (conversation) => db.query(
    "update conversations set writer_lease_expires_at = clock_timestamp() - interval '1 second' where id = $1",
    [conversation]);
  const reserve = (conversation) => pipeline(async () => (await one(
    "select public.reserve_interview_writer_recovery($1,$2,60) as state", [conversation, randomUUID()])).state);
  const end = (conversation, status, reason, generation = null) => pipeline(async () => (await one(
    "select public.end_interview_conversation($1,$2,$3,$4) as status", [conversation, status, reason, generation])).status);
  const state = (conversation) => one(
    `select status, writer_generation, writer_job_id, writer_lease_expires_at, ended_at, end_reason,
            opening_started_at, writer_recovery_attempts from conversations where id = $1`, [conversation]);

  test("new lifecycle RPCs are security definer, pinned search path and service_role only", async () => {
    for (const name of ["claim_interview_writer_lease", "heartbeat_interview_writer", "release_interview_writer",
      "mark_interview_opening", "end_interview_conversation", "reserve_interview_writer_recovery",
      "lease_interview_lifecycle_outbox", "settle_interview_lifecycle_outbox"]) {
      const routine = await one(
        `select p.oid::regprocedure::text as signature, p.prosecdef, p.proconfig from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [name]);
      assert.equal(routine.prosecdef, true, name);
      assert.ok(routine.proconfig.some((setting) => setting.startsWith("search_path=")), name);
      const permissions = await one(
        `select has_function_privilege('anon', $1::regprocedure, 'EXECUTE') as anon,
                has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') as researcher,
                has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') as service`, [routine.signature]);
      assert.deepEqual(permissions, { anon: false, researcher: false, service: true }, name);
    }
    await assert.rejects(as("anon", null, () => db.query("select * from interview_lifecycle_outbox")),
      /permission denied/);
    await assert.rejects(researcher("alice", () => db.query("select * from interview_lifecycle_outbox")),
      /permission denied/);
  });

  test("a live lease cannot be stolen; its holder renews idempotently", async () => {
    const { conversation, room } = await started();
    const first = await claimLease(conversation, room, "AJ_first");
    assert.equal(first.generation, 1);
    assert.equal(first.renewed, false);
    assert.equal(first.openingStarted, false);
    const renewed = await claimLease(conversation, room, "AJ_first");
    assert.equal(renewed.generation, 1);
    assert.equal(renewed.renewed, true);
    await assert.rejects(claimLease(conversation, room, "AJ_thief"), /held by another worker/);
    await assert.rejects(pipeline(() => db.query("select public.claim_conversation_writer($1,$2)",
      [conversation, room])), /held by another worker/);
    const beat = await heartbeat(conversation, 1, "AJ_first");
    assert.equal(beat.status, "in_progress");
    assert.ok(new Date(beat.leaseExpiresAt) > new Date());
    await assert.rejects(heartbeat(conversation, 1, "AJ_thief"), /stale conversation writer/);
    assert.equal(Number((await state(conversation)).writer_generation), 1);
  });

  test("the lease respects the conversation's current profile, room and resume capability", async () => {
    const { conversation, room } = await started();
    await assert.rejects(claimLease(conversation, room, "AJ_x", "backup_1"), /cannot accept a writer/);
    await assert.rejects(claimLease(conversation, `qalvi-real-${randomUUID()}`, "AJ_x"), /cannot accept a writer/);
    await assert.rejects(claimLease(conversation, room, "AJ_x", "primary", 5), /invalid writer lease request/);
    await pipeline(() => db.query(
      "update interview_resumes set revoked_at = clock_timestamp() where conversation_id = $1", [conversation]));
    await assert.rejects(claimLease(conversation, room, "AJ_x"), /cannot accept a writer/);
  });

  test("an expired lease allows generation N+1, and the replaced worker can never write again", async () => {
    const { conversation, room } = await started();
    await claimLease(conversation, room, "AJ_original");
    await append(conversation, 1, "text:before", "Before the crash");
    await expireLease(conversation);
    const replacement = await claimLease(conversation, room, "AJ_replacement");
    assert.equal(replacement.generation, 2);
    await assert.rejects(append(conversation, 1, "text:late", "Late write"), /not writable by this generation/);
    await assert.rejects(heartbeat(conversation, 1, "AJ_original"), /stale conversation writer/);
    assert.equal((await append(conversation, 2, "text:after", "After takeover")).message_sequence, 1);
    const release = (generation, job) => pipeline(async () => (await one(
      "select public.release_interview_writer($1,$2,$3) as released", [conversation, generation, job])).released);
    assert.equal(await release(1, "AJ_original"), false);
    assert.equal(await release(2, "AJ_replacement"), true);
    assert.equal((await state(conversation)).writer_job_id, null);
  });

  test("recovery reservation fences the lapsed writer at once and is bounded", async () => {
    const { conversation, room } = await started();
    assert.equal(await reserve(conversation), "unavailable"); // never started: transport routing owns it
    await claimLease(conversation, room, "AJ_one");
    assert.equal(await reserve(conversation), "active");
    await expireLease(conversation);
    assert.equal(await reserve(conversation), "reserved");
    await assert.rejects(append(conversation, 1, "text:zombie", "Zombie write"), /not writable by this generation/);
    assert.equal(await reserve(conversation), "recovering");
    const claimed = await claimLease(conversation, room, "AJ_two");
    assert.equal(claimed.generation, 3);
    assert.equal((await state(conversation)).writer_recovery_attempts, 0);
    await expireLease(conversation);
    for (const expected of ["reserved", "reserved", "reserved", "exhausted"]) {
      await db.query(
        "update conversations set writer_recovery_at = writer_recovery_at - interval '10 minutes' where id = $1 and writer_recovery_at is not null",
        [conversation]);
      assert.equal(await reserve(conversation), expected);
    }
  });

  test("the opening marker is written once and only by the current writer", async () => {
    const { conversation, room } = await started();
    await claimLease(conversation, room, "AJ_open");
    const mark = (generation) => pipeline(async () => (await one(
      "select public.mark_interview_opening($1,$2) as first", [conversation, generation])).first);
    assert.equal(await mark(1), true);
    assert.equal(await mark(1), false);
    await assert.rejects(mark(9), /not writable by this generation/);
    await expireLease(conversation);
    assert.equal((await claimLease(conversation, room, "AJ_next")).openingStarted, true);
  });

  test("recovery read exposes lifecycle facts without transport or tenant details", async () => {
    const { conversation, room, resume } = await started();
    const read = () => pipeline(async () => (await one(
      "select public.read_participant_interview_recovery($1) as snapshot", [resume])).snapshot);
    await claimLease(conversation, room, "AJ_read");
    await pipeline(() => db.query("select public.mark_interview_opening($1,1)", [conversation]));
    let snapshot = await read();
    assert.equal(snapshot.writerActive, true);
    assert.equal(snapshot.openingUncertain, true);
    assert.equal(snapshot.recovering, false);
    assert.equal(snapshot.endReason, null);
    const text = JSON.stringify(snapshot);
    for (const hidden of [room, "primary", "AJ_read", ids.alpha]) assert.equal(text.includes(hidden), false, hidden);
    await append(conversation, 1, "text:first", "Hello");
    snapshot = await read();
    assert.equal(snapshot.openingUncertain, false);
  });

  test("terminal endings set ended_at, clear the lease, enqueue one ejection and are idempotent", async () => {
    const { conversation, room, resume } = await started();
    await claimLease(conversation, room, "AJ_end");
    assert.equal(await end(conversation, "completed", "participant_ended"), "completed");
    const ended = await state(conversation);
    assert.equal(ended.status, "completed");
    assert.equal(ended.end_reason, "participant_ended");
    assert.ok(ended.ended_at);
    assert.equal(ended.writer_job_id, null);
    assert.equal(await end(conversation, "cancelled", "researcher_cancelled"), "completed");
    const outbox = await rows(
      "select kind, livekit_profile_id, livekit_room from interview_lifecycle_outbox where conversation_id = $1",
      [conversation]);
    assert.deepEqual(outbox, [{ kind: "eject_room", livekit_profile_id: "primary", livekit_room: room }]);
    // Terminal blocks every path back in, but stays readable through the capability.
    await assert.rejects(claimLease(conversation, room, "AJ_late"), /cannot accept a writer/);
    await assert.rejects(append(conversation, 1, "text:late", "Too late"), /not writable by this generation/);
    assert.equal((await pipeline(() => one("select public.resolve_interview_resume($1) as id", [resume]))).id, null);
    await assert.rejects(heartbeat(conversation, 1, "AJ_end"), /stale conversation writer/);
    const snapshot = (await pipeline(() => one(
      "select public.read_participant_interview_recovery($1) as s", [resume]))).s;
    assert.deepEqual([snapshot.status, snapshot.endReason, snapshot.writerActive],
      ["completed", "participant_ended", false]);
  });

  test("stale worker endings are refused and only integrity failure may be 'failed'", async () => {
    const { conversation, room } = await started();
    await claimLease(conversation, room, "AJ_hb");
    await assert.rejects(end(conversation, "completed", "interview_closed", 7), /stale conversation writer/);
    await assert.rejects(end(conversation, "completed", "recovery_integrity"), /invalid interview ending/);
    await assert.rejects(end(conversation, "failed", "participant_ended"), /invalid interview ending/);
    assert.equal(await end(conversation, "failed", "recovery_integrity", 1), "failed");
    const pending = await started();
    assert.equal(await end(pending.conversation, "completed", "participant_ended"), "cancelled");
  });

  test("a heartbeat on a terminal conversation reports the ending and clears the lease", async () => {
    const { conversation, room } = await started();
    await claimLease(conversation, room, "AJ_t");
    await db.query(`update conversations set status = 'cancelled', end_reason = 'researcher_cancelled',
      ended_at = clock_timestamp() where id = $1`, [conversation]);
    assert.deepEqual(await heartbeat(conversation, 1, "AJ_t"), { status: "cancelled", leaseExpiresAt: null });
    assert.equal((await state(conversation)).writer_job_id, null);
  });

  test("the legacy worker transition releases the lease and enqueues ejection on terminal", async () => {
    const { conversation, room } = await started();
    await claimLease(conversation, room, "AJ_legacy");
    await pipeline(() => db.query("select public.transition_interview_conversation($1,1,'interrupted')", [conversation]));
    assert.equal((await state(conversation)).writer_job_id, null);
    await pipeline(() => db.query("select public.transition_interview_conversation($1,1,'completed')", [conversation]));
    assert.equal((await rows("select 1 from interview_lifecycle_outbox where conversation_id = $1", [conversation])).length, 1);
  });

  test("ejection outbox leases due rows once, backs off failures, completes and finally abandons", async () => {
    const { conversation, room } = await started();
    await claimLease(conversation, room, "AJ_o");
    await end(conversation, "completed", "participant_ended");
    const due = (where = "conversation_id = $1", value = conversation) => db.query(
      `update interview_lifecycle_outbox set next_attempt_at = clock_timestamp() - interval '1 second' where ${where}`, [value]);
    await due();
    const lease = (nonce) => pipeline(async () => (await rows(
      "select * from public.lease_interview_lifecycle_outbox($1,50,60)", [nonce]))
      .filter((row) => row.conversation_id === conversation));
    const settle = (id, nonce, ok, error = null) => pipeline(async () => (await one(
      "select public.settle_interview_lifecycle_outbox($1,$2,$3,$4) as result", [id, nonce, ok, error])).result);
    const nonce = randomUUID();
    const [job] = await lease(nonce);
    assert.equal(job.livekit_room, room);
    assert.deepEqual(await lease(randomUUID()), []); // locked by the first processor
    assert.equal(await settle(job.id, randomUUID(), true), "stale");
    assert.equal(await settle(job.id, nonce, false, "LiveKit 503"), "retry");
    assert.deepEqual(await one(
      "select attempts, next_attempt_at > clock_timestamp() as later, last_error from interview_lifecycle_outbox where id = $1",
      [job.id]), { attempts: 1, later: true, last_error: "LiveKit 503" });
    assert.deepEqual(await lease(randomUUID()), []); // not due yet
    await due("id = $1", job.id);
    const again = randomUUID();
    await lease(again);
    assert.equal(await settle(job.id, again, true), "completed");
    assert.equal(await settle(job.id, again, true), "stale");
    // A row that keeps failing is abandoned after ten attempts rather than retried forever.
    await db.query(`update interview_lifecycle_outbox set completed_at = null, attempts = 9,
      next_attempt_at = clock_timestamp() - interval '1 second' where id = $1`, [job.id]);
    const last = randomUUID();
    await lease(last);
    assert.equal(await settle(job.id, last, false, "still failing"), "abandoned");
  });
});
