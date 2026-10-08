// Stage 2B.4B server lifecycle: replacement dispatch, terminal endings and the ejection outbox.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file, dependencies) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require(name) {
    assert.ok(name in dependencies, `Unexpected import: ${name}`);
    return dependencies[name];
  }, process, Date, setTimeout });
  return exports;
}

// Objects created inside the vm realm carry its prototypes; compare by value.
const same = (actual, expected, message) =>
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), message);

const profilesModule = load("../src/lib/interview/livekitProfiles.ts", { "server-only": {} });
const failures = load("../src/lib/interview/livekitFailures.ts", {});
const lifecycle = load("../src/lib/interview/lifecycle.ts", {
  "server-only": {}, "node:crypto": await import("node:crypto"), "livekit-server-sdk": {},
  "@/lib/supabase/secret": { createSupabaseSecretClient() { throw new Error("tests inject a client"); } },
  "./livekitProfiles": profilesModule, "./livekitFailures": failures,
});

const profiles = profilesModule.loadLiveKitProfiles({
  LIVEKIT_PROFILE_IDS: "primary,backup_1,off",
  LIVEKIT_PROFILE_PRIMARY_URL: "wss://primary.livekit.cloud", LIVEKIT_PROFILE_PRIMARY_API_KEY: "primary-key",
  LIVEKIT_PROFILE_PRIMARY_API_SECRET: "primary-secret", LIVEKIT_PROFILE_PRIMARY_AGENT_NAME: "qalvi-primary",
  LIVEKIT_PROFILE_BACKUP_1_URL: "wss://backup.livekit.cloud", LIVEKIT_PROFILE_BACKUP_1_API_KEY: "backup-key",
  LIVEKIT_PROFILE_BACKUP_1_API_SECRET: "backup-secret", LIVEKIT_PROFILE_BACKUP_1_AGENT_NAME: "qalvi-backup",
  LIVEKIT_PROFILE_OFF_URL: "wss://off.livekit.cloud", LIVEKIT_PROFILE_OFF_API_KEY: "off-key",
  LIVEKIT_PROFILE_OFF_API_SECRET: "off-secret", LIVEKIT_PROFILE_OFF_AGENT_NAME: "qalvi-off",
  LIVEKIT_PROFILE_OFF_ENABLED: "false",
});
const ROOM = "qalvi-real-22222222-2222-4222-8222-222222222222";

function admin({ reservation = "reserved", conversation = { livekit_profile_id: "backup_1", livekit_room: ROOM,
  status: "interrupted", writer_generation: 3 }, outbox = [] } = {}) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push([name, args]);
      if (name === "reserve_interview_writer_recovery") return { data: reservation, error: null };
      if (name === "end_interview_conversation") return { data: args.p_status, error: null };
      if (name === "lease_interview_lifecycle_outbox") return { data: outbox, error: null };
      if (name === "settle_interview_lifecycle_outbox") {
        return { data: args.p_succeeded ? "completed" : "retry", error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from(table) {
      assert.equal(table, "conversations");
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: conversation, error: null }) };
      return query;
    },
  };
}

function liveKit({ roomExists = false, dispatches = [], deleteFailure = null } = {}) {
  const calls = [];
  const clients = {
    rooms(profile) {
      return {
        async listRooms() { calls.push(["listRooms", profile.id]); return roomExists ? [{ name: ROOM }] : []; },
        async createRoom(options) { calls.push(["createRoom", profile.id, options]); roomExists = true; },
        async deleteRoom(room) {
          calls.push(["deleteRoom", profile.id, profile.apiKey, room]);
          if (deleteFailure) throw deleteFailure;
        },
      };
    },
    dispatches(profile) {
      return {
        async listDispatch() { calls.push(["listDispatch", profile.id]); return dispatches; },
        async deleteDispatch(id) { calls.push(["deleteDispatch", profile.id, id]); },
        async createDispatch(room, agentName) {
          calls.push(["createDispatch", profile.id, profile.apiKey, room, agentName]);
          return { id: "AD_new" };
        },
      };
    },
  };
  return { calls, clients };
}

test("only a reserved recovery dispatches; every other server answer is passed through untouched", async () => {
  for (const reservation of ["active", "recovering", "terminal", "exhausted", "unavailable"]) {
    const db = admin({ reservation });
    const provider = liveKit();
    assert.equal(await lifecycle.ensureInterviewWriter("c1", { admin: db, profiles, clients: provider.clients }),
      reservation);
    same(provider.calls, [], reservation);
  }
});

test("a replacement goes to the conversation's own project and room, recreating the room with retention", async () => {
  const db = admin();
  const provider = liveKit({ roomExists: false });
  assert.equal(await lifecycle.ensureInterviewWriter("c1", { admin: db, profiles, clients: provider.clients }),
    "recovering");
  const created = provider.calls.find((call) => call[0] === "createRoom");
  same(created, ["createRoom", "backup_1", { name: ROOM, emptyTimeout: 180, departureTimeout: 150 }]);
  same(provider.calls.find((call) => call[0] === "createDispatch"),
    ["createDispatch", "backup_1", "backup-key", ROOM, "qalvi-backup"]);
  assert.ok(provider.calls.every((call) => call[1] === "backup_1"), "no other project is touched");
  const reservation = db.calls.find((call) => call[0] === "reserve_interview_writer_recovery")[1];
  assert.equal(reservation.p_window_seconds, 90);
});

test("dispatch reuse: a pending job is reused, a running lapsed job is kept, ended dispatches are replaced", async () => {
  const pending = liveKit({ roomExists: true, dispatches: [
    { id: "AD_pending", agentName: "qalvi-backup", state: { jobs: [{ state: { status: 0 } }] } }] });
  await lifecycle.dispatchReplacementWorker(profiles[1], ROOM, pending.clients);
  assert.equal(pending.calls.some((call) => call[0] === "createDispatch"), false);

  const running = liveKit({ roomExists: true, dispatches: [
    { id: "AD_running", agentName: "qalvi-backup", state: { jobs: [{ state: { status: 1 } }] } },
    { id: "AD_done", agentName: "qalvi-backup", state: { jobs: [{ state: { status: 2 } }] } },
    { id: "AD_other", agentName: "someone-else", state: { jobs: [] } }] });
  await lifecycle.dispatchReplacementWorker(profiles[1], ROOM, running.clients);
  same(running.calls.filter((call) => call[0] === "deleteDispatch").map((call) => call[2]), ["AD_done"]);
  assert.equal(running.calls.filter((call) => call[0] === "createDispatch").length, 1);
});

test("an established interview never moves projects: a disabled or unknown profile is unavailable", async () => {
  for (const profileId of ["off", "unknown"]) {
    const provider = liveKit();
    const db = admin({ conversation: { livekit_profile_id: profileId, livekit_room: ROOM, status: "in_progress",
      writer_generation: 2 } });
    assert.equal(await lifecycle.ensureInterviewWriter("c1", { admin: db, profiles, clients: provider.clients }),
      "unavailable");
    same(provider.calls, []);
  }
});

test("provider failures wait for the next recovery window; application errors are not hidden", async () => {
  const flaky = liveKit();
  flaky.clients.rooms = () => ({ async listRooms() { throw Object.assign(new Error("down"), { status: 503 }); } });
  assert.equal(await lifecycle.ensureInterviewWriter("c1", { admin: admin(), profiles, clients: flaky.clients }),
    "recovering");
  const broken = liveKit();
  broken.clients.rooms = () => ({ async listRooms() { throw Object.assign(new Error("bad key"), { status: 401 }); } });
  await assert.rejects(lifecycle.ensureInterviewWriter("c1", { admin: admin(), profiles, clients: broken.clients }),
    /bad key/);
});

test("ending an interview records it first, then ejects from the room's own project", async () => {
  const db = admin({ outbox: [{ id: "o1", livekit_profile_id: "backup_1", livekit_room: ROOM }] });
  const provider = liveKit();
  assert.equal(await lifecycle.endInterview("c1", "cancelled", "researcher_cancelled",
    { admin: db, profiles, clients: provider.clients }), "cancelled");
  same(db.calls[0], ["end_interview_conversation",
    { p_conversation_id: "c1", p_status: "cancelled", p_reason: "researcher_cancelled" }]);
  same(provider.calls, [["deleteRoom", "backup_1", "backup-key", ROOM]]);
  assert.equal(db.calls.at(-1)[1].p_succeeded, true);
});

test("outbox: a missing room is already ejected, provider failures retry, unknown profiles never borrow credentials", async () => {
  const gone = liveKit({ deleteFailure: Object.assign(new Error("not found"), { status: 404 }) });
  let db = admin({ outbox: [{ id: "o1", livekit_profile_id: "primary", livekit_room: ROOM }] });
  same(await lifecycle.drainLifecycleOutbox({ admin: db, profiles, clients: gone.clients }),
    { completed: 1, retrying: 0, abandoned: 0 });

  const down = liveKit({ deleteFailure: Object.assign(new Error("unavailable"), { status: 503 }) });
  db = admin({ outbox: [{ id: "o2", livekit_profile_id: "primary", livekit_room: ROOM }] });
  same(await lifecycle.drainLifecycleOutbox({ admin: db, profiles, clients: down.clients }),
    { completed: 0, retrying: 1, abandoned: 0 });
  assert.equal(db.calls.at(-1)[1].p_error, "service_unavailable");

  const any = liveKit();
  db = admin({ outbox: [{ id: "o3", livekit_profile_id: "retired_project", livekit_room: ROOM }] });
  await lifecycle.drainLifecycleOutbox({ admin: db, profiles, clients: any.clients });
  same(any.calls, []);
  assert.equal(db.calls.at(-1)[1].p_error, "profile not configured");
});
