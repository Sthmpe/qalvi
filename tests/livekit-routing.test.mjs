import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file, dependencies, globals = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require(name) {
    assert.ok(name in dependencies, `Unexpected import: ${name}`);
    return dependencies[name];
  }, process, Date, setTimeout, ...globals });
  return exports;
}

const profilesModule = load("../src/lib/interview/livekitProfiles.ts", { "server-only": {} });
const failures = load("../src/lib/interview/livekitFailures.ts", {});
const router = load("../src/lib/interview/livekitRouter.ts", {
  "server-only": {},
  "node:crypto": await import("node:crypto"),
  "livekit-server-sdk": {},
  "./livekitProfiles": profilesModule,
  "./livekitFailures": failures,
});

function config() {
  return {
    LIVEKIT_PROFILE_IDS: "backup_1,primary,disabled",
    LIVEKIT_PROFILE_PRIMARY_URL: "wss://primary.livekit.cloud",
    LIVEKIT_PROFILE_PRIMARY_API_KEY: "primary-key",
    LIVEKIT_PROFILE_PRIMARY_API_SECRET: "primary-secret",
    LIVEKIT_PROFILE_PRIMARY_AGENT_NAME: "qalvi-interview",
    LIVEKIT_PROFILE_PRIMARY_PRIORITY: "0",
    LIVEKIT_PROFILE_BACKUP_1_URL: "wss://backup.livekit.cloud",
    LIVEKIT_PROFILE_BACKUP_1_API_KEY: "backup-key",
    LIVEKIT_PROFILE_BACKUP_1_API_SECRET: "backup-secret",
    LIVEKIT_PROFILE_BACKUP_1_AGENT_NAME: "qalvi-interview",
    LIVEKIT_PROFILE_BACKUP_1_PRIORITY: "1",
    LIVEKIT_PROFILE_DISABLED_URL: "wss://disabled.livekit.cloud",
    LIVEKIT_PROFILE_DISABLED_API_KEY: "disabled-key",
    LIVEKIT_PROFILE_DISABLED_API_SECRET: "disabled-secret",
    LIVEKIT_PROFILE_DISABLED_AGENT_NAME: "qalvi-interview",
    LIVEKIT_PROFILE_DISABLED_ENABLED: "false",
  };
}

function session() {
  return { id: "conversation-1", livekit_room: "qalvi-real-11111111-1111-4111-8111-111111111111",
    livekit_profile_id: "primary", transport_generation: 1, transport_failed_profiles: [],
    transport_failure_reason: null, transport_connection_failures: 0, transport_ready_at: null,
    status: "pending", writer_generation: 0, next_message_sequence: 0 };
}

function store(initial = session()) {
  let state = initial;
  const changes = [];
  return {
    changes,
    current: () => state,
    markFailedConnects: () => { state = { ...state, transport_connection_failures: 2,
      transport_ready_at: new Date().toISOString() }; },
    async read() { return state; },
    async reserve(snapshot, nonce) {
      assert.equal(snapshot.transport_generation, state.transport_generation);
      changes.push(["reserve", nonce]);
      return true;
    },
    async confirm(snapshot) {
      assert.equal(snapshot.id, state.id);
      state = { ...state, transport_ready_at: new Date().toISOString() };
      changes.push(["confirm", state.livekit_profile_id]);
      return true;
    },
    async rotate(snapshot, nonce, next, room, reason) {
      assert.equal(snapshot.id, state.id);
      assert.notEqual(room, state.livekit_room);
      changes.push(["rotate", reason, next.id]);
      state = { ...state, livekit_profile_id: next.id, livekit_room: room,
        transport_generation: state.transport_generation + 1,
        transport_connection_failures: 0,
        transport_ready_at: null,
        transport_failed_profiles: [...state.transport_failed_profiles, snapshot.livekit_profile_id],
        transport_failure_reason: reason };
    },
    async fail(snapshot, nonce, reason) {
      changes.push(["fail", reason]);
      state = { ...state, transport_failed_profiles: [...state.transport_failed_profiles, snapshot.livekit_profile_id],
        transport_failure_reason: reason };
    },
  };
}

test("single-profile legacy configuration stays unnamed and requires no backup", () => {
  const only = profilesModule.loadLiveKitProfiles({ LIVEKIT_URL: "wss://one.livekit.cloud",
    LIVEKIT_API_KEY: "key", LIVEKIT_API_SECRET: "secret" });
  assert.equal(only.length, 1);
  assert.equal(only[0].id, "primary");
  assert.equal(only[0].agentName, null);
  assert.equal(profilesModule.liveKitApiUrl(only[0]), "https://one.livekit.cloud");
});

test("profile loader orders by priority, skips disabled, rejects incomplete and duplicate configuration", () => {
  const profiles = profilesModule.loadLiveKitProfiles(config());
  assert.deepEqual(Array.from(profiles, (p) => p.id), ["primary", "backup_1", "disabled"]);
  assert.equal(profiles.find((p) => p.id === "disabled").enabled, false);
  assert.throws(() => profilesModule.loadLiveKitProfiles({ ...config(),
    LIVEKIT_PROFILE_BACKUP_1_API_SECRET: undefined }), /Invalid LiveKit profile configuration/);
  assert.throws(() => profilesModule.loadLiveKitProfiles({ ...config(),
    LIVEKIT_PROFILE_IDS: "primary,primary" }), /Invalid LiveKit profile identifiers/);
  assert.throws(() => profilesModule.loadLiveKitProfiles({ ...config(),
    LIVEKIT_PROFILE_IDS: "" }), /Invalid LiveKit profile identifiers/);
  assert.throws(() => profilesModule.loadLiveKitProfiles({ ...config(),
    LIVEKIT_PROFILE_IDS: "primary,unknown" }), /Invalid LiveKit profile configuration: unknown/);
  assert.throws(() => profilesModule.loadLiveKitProfiles({ ...config(),
    LIVEKIT_PROFILE_BACKUP_1_PRIORITY: "0" }), /Duplicate LiveKit profile priorities/);
  assert.throws(() => profilesModule.loadLiveKitProfiles({ ...config(),
    LIVEKIT_PROFILE_PRIMARY_API_SECRET: undefined, LIVEKIT_API_SECRET: "legacy-secret" }),
  /Invalid LiveKit profile configuration: primary/);
  assert.throws(() => profilesModule.loadLiveKitProfiles({ ...config(),
    LIVEKIT_PROFILE_IDS: "primary", LIVEKIT_PROFILE_PRIMARY_AGENT_NAME: undefined }),
  /requires a named agent/);
});

test("explicitly configured but all-disabled profiles are never legacy fallback", async () => {
  const profiles = profilesModule.loadLiveKitProfiles({ ...config(),
    LIVEKIT_PROFILE_PRIMARY_ENABLED: "false", LIVEKIT_PROFILE_BACKUP_1_ENABLED: "false" });
  const backend = store();
  await assert.rejects(router.routeLiveKitTransport(profiles, backend, 35_000,
    async () => { throw Error("disabled profile must not be contacted"); }), /transport_unavailable/);
  assert.equal(backend.changes.filter((entry) => entry[0] === "rotate").length, 0);
});

test("highest-priority healthy profile is assigned and no secrets enter the routing result payload", async () => {
  const profiles = profilesModule.loadLiveKitProfiles(config());
  const backend = store();
  const selected = await router.routeLiveKitTransport(profiles, backend, 35_000,
    async (profile, room) => {
      assert.equal(profile.id, "primary");
      assert.equal(profile.apiKey, "primary-key");
      assert.equal(room, session().livekit_room);
    });
  assert.equal(selected.kind, "ready");
  assert.equal(selected.state.id, "conversation-1");
  assert.equal(selected.state.transport_generation, 1);
  assert.equal(backend.changes.at(-1)[0], "confirm");
  const browserPayload = { serverUrl: selected.profile.serverUrl, roomName: selected.state.livekit_room,
    transportGeneration: selected.state.transport_generation };
  assert.ok(!JSON.stringify(browserPayload).includes("primary-secret"));
});

for (const [label, failure] of [
  ["quota", new failures.LiveKitProviderFailure("quota")],
  ["assignment timeout", new failures.LiveKitProviderFailure("assignment_timeout")],
  ["provider 5xx", { status: 503, message: "Service Unavailable" }],
]) {
  test(`${label} rotates exactly once to a new project/room but the same conversation`, async () => {
    const profiles = profilesModule.loadLiveKitProfiles(config());
    const backend = store();
    const first = await router.routeLiveKitTransport(profiles, backend, 35_000,
      async () => { throw failure; });
    assert.equal(first.kind, "retry");
    assert.equal(backend.current().id, "conversation-1");
    assert.equal(backend.current().livekit_profile_id, "backup_1");
    assert.equal(backend.current().transport_generation, 2);
    assert.notEqual(backend.current().livekit_room, session().livekit_room);
    assert.equal(backend.current().next_message_sequence, 0);
    const second = await router.routeLiveKitTransport(profiles, backend, 35_000,
      async (profile, room) => {
        assert.equal(profile.id, "backup_1");
        assert.equal(profile.apiKey, "backup-key");
        assert.equal(profile.apiSecret, "backup-secret");
        assert.equal(room, backend.current().livekit_room);
      });
    assert.equal(second.kind, "ready");
    assert.equal(second.state.id, "conversation-1");
    assert.equal(backend.changes.filter((entry) => entry[0] === "rotate").length, 1);
  });
}

test("authorization, malformed requests, and unknown job errors do not cause failover", async () => {
  const profiles = profilesModule.loadLiveKitProfiles(config());
  for (const error of [{ status: 401 }, { status: 400 }, new Error("Qalvi schema mismatch")]) {
    const backend = store();
    await assert.rejects(router.routeLiveKitTransport(profiles, backend, 35_000,
      async () => { throw error; }));
    assert.equal(backend.changes.some((entry) => entry[0] === "rotate"), false);
  }
});

test("disabled profile is skipped; exhausted profiles are not retried", async () => {
  const profiles = profilesModule.loadLiveKitProfiles(config());
  const backend = store({ ...session(), livekit_profile_id: "disabled",
    transport_ready_at: new Date().toISOString() });
  assert.equal((await router.routeLiveKitTransport(profiles, backend, 35_000,
    async () => { throw Error("should not assign disabled profile"); })).kind, "retry");
  assert.equal(backend.current().livekit_profile_id, "primary");
  const exhausted = store({ ...session(), transport_failed_profiles: ["primary", "backup_1"] });
  await assert.rejects(router.routeLiveKitTransport(profiles, exhausted, 35_000,
    async () => { throw Error("should not retry"); }), /transport_unavailable/);
  assert.equal(exhausted.changes.length, 0);
});

test("an unknown saved profile fails closed instead of rotating into another project", async () => {
  const profiles = profilesModule.loadLiveKitProfiles(config());
  const backend = store({ ...session(), livekit_profile_id: "retired_project",
    transport_ready_at: new Date().toISOString() });
  await assert.rejects(router.routeLiveKitTransport(profiles, backend, 35_000,
    async () => { throw Error("removed profile must not be contacted"); }), /profile is not configured/);
  assert.equal(backend.changes.length, 0);
});

test("a routing cycle attempts each enabled profile at most once", async () => {
  const profiles = profilesModule.loadLiveKitProfiles({ ...config(),
    LIVEKIT_PROFILE_DISABLED_ENABLED: "true", LIVEKIT_PROFILE_DISABLED_PRIORITY: "2" });
  const backend = store();
  const attempted = [];
  for (let n = 0; n < profiles.length; n++) {
    const step = router.routeLiveKitTransport(profiles, backend, 10_000, async (profile) => {
      attempted.push(profile.id);
      throw new failures.LiveKitProviderFailure("assignment_timeout");
    });
    if (n < profiles.length - 1) assert.equal((await step).kind, "retry");
    else await assert.rejects(step, /assignment_timeout/);
  }
  assert.deepEqual(attempted, ["primary", "backup_1", "disabled"]);
  assert.equal(backend.changes.filter((entry) => entry[0] === "rotate").length, 2);
  await assert.rejects(router.routeLiveKitTransport(profiles, backend, 10_000,
    async () => { throw Error("exhausted profile must not be contacted again"); }), /transport_unavailable/);
});

test("one session's provider failure does not disable that profile for another session", async () => {
  const profiles = profilesModule.loadLiveKitProfiles(config());
  const first = store();
  const second = store({ ...session(), id: "conversation-2" });
  assert.equal((await router.routeLiveKitTransport(profiles, first, 10_000,
    async () => { throw new failures.LiveKitProviderFailure("quota"); })).kind, "retry");
  const ready = await router.routeLiveKitTransport(profiles, second, 10_000,
    async (profile) => assert.equal(profile.id, "primary"));
  assert.equal(ready.kind, "ready");
  assert.equal(first.current().livekit_profile_id, "backup_1");
  assert.equal(second.current().livekit_profile_id, "primary");
});

test("browser failure reports cannot rotate through more than the eligible profiles", async () => {
  const profiles = profilesModule.loadLiveKitProfiles({ ...config(),
    LIVEKIT_PROFILE_DISABLED_ENABLED: "true", LIVEKIT_PROFILE_DISABLED_PRIORITY: "2" });
  const backend = store();
  for (let n = 0; n < profiles.length; n++) {
    backend.markFailedConnects();
    const step = router.routeLiveKitTransport(profiles, backend, 10_000,
      async () => { throw Error("browser report must not reassign the failed profile"); });
    if (n < profiles.length - 1) assert.equal((await step).kind, "retry");
    else await assert.rejects(step, /transport_unavailable/);
  }
  assert.equal(backend.changes.filter((entry) => entry[0] === "rotate").length, 2);
  assert.deepEqual(backend.current().transport_failed_profiles,
    ["primary", "backup_1", "disabled"]);
});

test("active or evidence-bearing conversation cannot be rotated", async () => {
  const profiles = profilesModule.loadLiveKitProfiles(config());
  const active = store({ ...session(), status: "in_progress", writer_generation: 1,
    next_message_sequence: 2 });
  const result = await router.routeLiveKitTransport(profiles, active, 35_000,
    async () => { throw Error("must not assign"); });
  assert.equal(result.kind, "ready");
  assert.equal(active.changes.length, 0);
});

test("two acknowledged pre-interview WebRTC failures rotate without touching the conversation", async () => {
  const profiles = profilesModule.loadLiveKitProfiles(config());
  const backend = store({ ...session(), transport_ready_at: new Date().toISOString(),
    transport_connection_failures: 2 });
  const result = await router.routeLiveKitTransport(profiles, backend, 35_000,
    async () => { throw Error("already assigned profile should not be dispatched again"); });
  assert.equal(result.kind, "retry");
  assert.equal(backend.current().id, "conversation-1");
  assert.equal(backend.current().transport_generation, 2);
  assert.equal(backend.current().livekit_profile_id, "backup_1");
  assert.equal(backend.current().transport_connection_failures, 0);
  assert.deepEqual(backend.changes.find((entry) => entry[0] === "rotate").slice(1),
    ["transport_unavailable", "backup_1"]);
});

test("repeated token requests never redispatch a confirmed generation", async () => {
  const profiles = profilesModule.loadLiveKitProfiles(config());
  const backend = store({ ...session(), transport_ready_at: "2020-01-01T00:00:00.000Z",
    transport_connection_failures: 1 });
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await router.routeLiveKitTransport(profiles, backend, 10_000,
      async () => { throw Error("confirmed generation must not be redispatched"); });
    assert.equal(result.kind, "ready");
  }
  assert.equal(backend.changes.length, 0);
});

test("named dispatch uses one project's room API, agent name, deployment and worker ID", async () => {
  const calls = [];
  class Rooms {
    constructor(host, key, secret) { calls.push(["rooms-client", host, key, secret]); }
    async listRooms() { return []; }
    async createRoom(options) { calls.push(["room", options]); }
  }
  class Dispatches {
    constructor(host, key, secret) { calls.push(["dispatch-client", host, key, secret]); }
    async listDispatch() { return []; }
    async createDispatch(room, agent, options) {
      calls.push(["dispatch", room, agent, options.deployment]);
      return { id: "dispatch-1" };
    }
    async getDispatch() { return { state: { jobs: [{ state: { status: 1, workerId: "worker-1" } }] } }; }
  }
  const namedRouter = load("../src/lib/interview/livekitRouter.ts", {
    "server-only": {}, "node:crypto": await import("node:crypto"),
    "livekit-server-sdk": { RoomServiceClient: Rooms, AgentDispatchClient: Dispatches },
    "./livekitProfiles": profilesModule, "./livekitFailures": failures,
  });
  const backup = { ...profilesModule.loadLiveKitProfiles(config())[1], deployment: "staging" };
  await namedRouter.assignNamedWorker(backup, "qalvi-real-test-room", 35_000);
  assert.deepEqual(calls[0], ["rooms-client", "https://backup.livekit.cloud", "backup-key", "backup-secret"]);
  assert.deepEqual(calls[1], ["dispatch-client", "https://backup.livekit.cloud", "backup-key", "backup-secret"]);
  const room = calls.find((call) => call[0] === "room")[1];
  // The provider must not destroy a room while its worker's refresh grace is active.
  assert.ok(room.departureTimeout > 120 && room.departureTimeout <= 180);
  assert.deepEqual(calls.at(-1), ["dispatch", "qalvi-real-test-room", "qalvi-interview", "staging"]);
  assert.equal(calls.filter((call) => call[0] === "dispatch").length, 1);
});

test("a dispatch resource lost after creation is provider-unavailable", async () => {
  class Rooms { async listRooms() { return [{ name: "existing" }]; } }
  class Dispatches {
    async listDispatch() { return [{ id: "dispatch-1", agentName: "qalvi-interview" }]; }
    async getDispatch() { throw { status: 404 }; }
  }
  const namedRouter = load("../src/lib/interview/livekitRouter.ts", {
    "server-only": {}, "node:crypto": await import("node:crypto"),
    "livekit-server-sdk": { RoomServiceClient: Rooms, AgentDispatchClient: Dispatches },
    "./livekitProfiles": profilesModule, "./livekitFailures": failures,
  });
  await assert.rejects(namedRouter.assignNamedWorker(profilesModule.loadLiveKitProfiles(config())[0],
    "qalvi-real-test-room", 35_000), /transport_unavailable/);
});
