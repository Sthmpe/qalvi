// Executes the real Supabase migrations against Postgres (PGlite, in process)
// and checks the evidence model, row level security, and integrity rules as
// each Supabase role would meet them.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
    `insert into conversations (workspace_id, study_id, participant_id, livekit_room)
     values ($1, $2, $3, $4) returning id`,
    [workspace, study, participant.id, `qalvi-demo-${randomUUID()}`])).id;
}

async function message(conversation, sequence, speaker, channel, content, segment = null) {
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
                                  prompt, definition, shown_at)
     values ($1, $2, $3, $4, $5, $6, $7, now()) returning id`,
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
        `insert into messages (workspace_id, study_id, conversation_id, sequence, speaker, channel, content, occurred_at)
         values ($1, $2, $3, 9, 'participant', 'text', 'invented', now())`,
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
      `insert into messages (workspace_id, study_id, conversation_id, sequence, speaker, channel, content, occurred_at)
       values ($1, $2, $3, 50, 'participant', 'text', 'misfiled', now())`,
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
        `insert into visual_displays (workspace_id, study_id, conversation_id, action_id, visual_type, prompt, definition, shown_at)
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
