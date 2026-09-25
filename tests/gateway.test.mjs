import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

function load(file, dependencies, globals = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require(name) {
    assert.ok(name in dependencies, `Unexpected import: ${name}`);
    return dependencies[name];
  }, URL, process, ...globals });
  return exports;
}

const gateway = load("../src/lib/interview/gateway.ts", {
  "server-only": {},
  "node:crypto": await import("node:crypto"),
  "@/lib/supabase/secret": { createSupabaseSecretClient: () => { throw Error("Unexpected admin client"); } },
});

test("privileged Supabase client requires a secret key and never uses researcher cookies", () => {
  const calls = [];
  const dependencies = {
    "server-only": {},
    "@supabase/supabase-js": { createClient: (...args) => { calls.push(args); return {}; } },
    "./config": { supabasePublicConfig: () => ({ url: "https://example.supabase.co" }) },
  };
  const instance = (key) => load("../src/lib/supabase/secret.ts", dependencies, {
    process: { env: { SUPABASE_SECRET_KEY: key } },
  }).createSupabaseSecretClient;
  assert.throws(instance(undefined), /server-side Supabase secret key/);
  assert.throws(instance("legacy-jwt-placeholder"), /server-side Supabase secret key/);
  instance("sb_secret_test_placeholder")();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "https://example.supabase.co");
  assert.equal(calls[0][1], "sb_secret_test_placeholder");
  assert.equal(calls[0][2].auth.persistSession, false);
  assert.equal(calls[0][2].auth.autoRefreshToken, false);
  assert.equal(calls[0][2].auth.detectSessionInUrl, false);
  assert.equal("global" in calls[0][2], false);
});

function researcher(study, member) {
  return { from(table) {
    const query = { select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: table === "studies" ? study : member, error: null }; } };
    return query;
  } };
}

test("invitation issuance derives workspace through researcher RLS and stores only a token hash", async () => {
  const writes = [];
  const admin = { from(table) {
    assert.equal(table, "interview_invitations");
    return { insert(value) { writes.push(value); return {
      select() { return this; }, async single() { return { data: { expires_at: "2026-10-01" }, error: null }; },
    }; } };
  } };
  const study = { id: "00000000-0000-4000-8000-000000000001", workspace_id: "w-1", status: "active" };
  const result = await gateway.issueInvitation(study.id, "researcher-1", researcher(study, { user_id: "researcher-1" }), admin);
  assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0])), {
    workspace_id: "w-1", study_id: study.id, issued_by: "researcher-1",
    token_hash: createHash("sha256").update(result.token).digest("hex"),
  });
  assert.ok(!JSON.stringify(writes[0]).includes(result.token));
  assert.equal(await gateway.issueInvitation(study.id, "outsider", researcher(study, null), admin), null);
  assert.equal(await gateway.issueInvitation(study.id, "researcher-1", researcher(null, null), admin), null);
  assert.equal(await gateway.issueInvitation(study.id, "researcher-1", researcher({ ...study, status: "draft" }, {}), admin), null);
  assert.equal(await gateway.issueInvitation("wrong-study", "researcher-1", researcher(study, {}), admin), null);
  assert.equal(writes.length, 1);
});

test("claim uses a distinct resume hash and a server-generated real room", async () => {
  let call;
  const admin = { async rpc(name, args) { call = { name, args }; return { data: "conversation-1", error: null }; } };
  const invitation = gateway.newCapability();
  const result = await gateway.claimInvitation(invitation, admin);
  assert.equal(call.name, "claim_interview_invitation");
  assert.equal(call.args.p_invitation_hash, gateway.capabilityHash(invitation));
  assert.equal(call.args.p_resume_hash, gateway.capabilityHash(result.resume));
  assert.notEqual(result.resume, invitation);
  assert.match(call.args.p_livekit_room, /^qalvi-real-[0-9a-f-]{36}$/);
  assert.equal(call.args.p_consent_version, gateway.CONSENT_VERSION);
  assert.equal(await gateway.claimInvitation("forged", admin), null);
});

test("invitation preview reveals study context without consuming the capability", async () => {
  const invitation = gateway.newCapability();
  const reads = [];
  const admin = { from(table) {
    reads.push(table);
    return { select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: table === "interview_invitations"
        ? { study_id: "study-1", workspace_id: "workspace-1",
          expires_at: new Date(Date.now() + 60_000).toISOString(), claimed_at: null, revoked_at: null }
        : { title: "Research on focused work", description: "How teams protect their time", status: "active" }, error: null }; } };
  } };
  const preview = await gateway.previewInvitation(invitation, admin);
  assert.equal(preview.title, "Research on focused work");
  assert.deepEqual(reads, ["interview_invitations", "studies"]);
  assert.equal(await gateway.previewInvitation("bad", admin), null);
});

test("resume lookup cannot select another conversation and refuses unknown capabilities", async () => {
  const valid = gateway.newCapability();
  const admin = {
    async rpc(name, args) {
      assert.equal(name, "resolve_interview_resume");
      return { data: args.p_resume_hash === gateway.capabilityHash(valid) ? "conversation-1" : null, error: null };
    },
    from(table) {
      assert.equal(table, "conversations");
      return { select() { return this; }, eq(key, value) { assert.equal(value, "conversation-1"); return this; },
        async maybeSingle() { return { data: { id: "conversation-1", participant_id: "p-1",
          livekit_room: "qalvi-real-fixed", status: "pending" }, error: null }; } };
    },
  };
  assert.equal((await gateway.resolveParticipant(valid, admin)).id, "conversation-1");
  assert.equal((await gateway.resolveParticipant(valid, admin)).id, "conversation-1");
  assert.equal(await gateway.resolveParticipant(gateway.newCapability(), admin), null);
  assert.equal(await gateway.resolveParticipant("forged", admin), null);
  const options = gateway.participantCookieOptions();
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, "lax");
  assert.ok(options.maxAge <= 24 * 60 * 60);
  assert.equal(options.path, "/interview");
});

class FakeResponse {
  constructor(body, options = {}) {
    this.body = body;
    this.status = options.status ?? 200;
    this.headers = new Headers();
    this.cookies = { values: new Map(), set: (name, value, options) => this.cookies.values.set(name, { value, options }) };
  }
  static json(body, options) { return new FakeResponse(body, options); }
  static redirect(url, status) { return new FakeResponse(null, { status, url }); }
}

function request(url, { origin = "http://localhost:3000", cookie = {} } = {}) {
  return { url, headers: new Headers(origin ? { origin } : {}),
    cookies: { get: (name) => name in cookie ? { value: cookie[name] } : undefined },
    async formData() { return new Map(); } };
}

test("claim route requires positive consent, does not claim on GET, and sets only an HTTP-only resume cookie", async () => {
  let claims = 0;
  const { POST } = load("../src/app/interview/api/claim/route.ts", {
    "next/server": { NextResponse: FakeResponse },
    "@/lib/interview/gateway": { ...gateway,
      claimInvitation: async () => { claims++; return { resume: "resume-secret" }; } },
  });
  const noConsent = request("http://localhost:3000/interview/api/claim");
  noConsent.formData = async () => new Map([["invitation", gateway.newCapability()]]);
  assert.equal((await POST(noConsent)).status, 400);
  assert.equal(claims, 0);
  const crossSite = request("http://localhost:3000/interview/api/claim", { origin: "https://attacker.test" });
  crossSite.formData = async () => new Map([["invitation", gateway.newCapability()], ["consent", "yes"]]);
  assert.equal((await POST(crossSite)).status, 403);
  assert.equal(claims, 0);
  const yes = request("http://localhost:3000/interview/api/claim");
  yes.formData = async () => new Map([["invitation", gateway.newCapability()], ["consent", "yes"]]);
  const response = await POST(yes);
  assert.equal(response.status, 303);
  assert.equal(claims, 1);
  assert.equal(response.cookies.values.get(gateway.RESUME_COOKIE).value, "resume-secret");
  assert.equal(response.cookies.values.get(gateway.RESUME_COOKIE).options.httpOnly, true);
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  const source = readFileSync(new URL("../src/app/interview/invite/[token]/page.tsx", import.meta.url), "utf8");
  assert.match(source, /method="post"/);
  assert.doesNotMatch(source, /claimInvitation\(/);
});

test("researcher invitation route rejects signed-out requests before privileged work", async () => {
  let issued = false;
  const { POST } = load("../src/app/api/studies/[studyId]/invitations/route.ts", {
    "next/server": { NextResponse: FakeResponse },
    "@/lib/auth/session": { getResearcher: async () => null },
    "@/lib/interview/gateway": { sameOrigin: gateway.sameOrigin,
      issueInvitation: async () => { issued = true; } },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => ({}) },
  });
  const response = await POST(request("http://localhost:3000/api/studies/study/invitations"), {
    params: Promise.resolve({ studyId: "study" }),
  });
  assert.equal(response.status, 401);
  assert.equal(issued, false);
});

test("joined marker is set only for an authorized same-origin participant session", async () => {
  const { POST } = load("../src/app/interview/api/joined/route.ts", {
    "next/server": { NextResponse: FakeResponse },
    "@/lib/interview/gateway": { ...gateway,
      resolveParticipant: async (token) => token === "valid" ? { id: "conversation-1" } : null },
  });
  const none = await POST(request("http://localhost:3000/interview/api/joined"));
  assert.equal(none.status, 401);
  const joined = await POST(request("http://localhost:3000/interview/api/joined", {
    cookie: { [gateway.RESUME_COOKIE]: "valid" },
  }));
  assert.equal(joined.status, 204);
  assert.equal(joined.cookies.values.get(gateway.JOINED_COOKIE).value, "1");
  assert.equal(joined.cookies.values.get(gateway.JOINED_COOKIE).options.httpOnly, true);
});

test("real LiveKit token ignores browser-chosen scope and refuses a missing resume", async () => {
  const calls = [];
  class FakeAccessToken {
    constructor(key, secret, options) { this.options = options; calls.push({ key, secret, options }); }
    addGrant(grant) { calls.at(-1).grant = grant; }
    async toJwt() { return "jwt-test"; }
  }
  const { POST } = load("../src/app/interview/api/token/route.ts", {
    "next/server": { NextResponse: FakeResponse },
    "livekit-server-sdk": { AccessToken: FakeAccessToken, TrackSource: { MICROPHONE: 2 } },
    "@/lib/interview/gateway": { ...gateway,
      resolveParticipant: async (token) => token === "valid" ? {
        participant_id: "p-1", livekit_room: "qalvi-real-from-db", status: "pending",
      } : null },
  });
  const previous = [process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, process.env.LIVEKIT_URL];
  process.env.LIVEKIT_API_KEY = "test-key";
  process.env.LIVEKIT_API_SECRET = "test-secret";
  process.env.LIVEKIT_URL = "wss://example.test";
  try {
    const denied = await POST(request("http://localhost:3000/interview/api/token"));
    assert.equal(denied.status, 401);
    const allowed = await POST(request("http://localhost:3000/interview/api/token", { cookie: {
      [gateway.RESUME_COOKIE]: "valid", [gateway.JOINED_COOKIE]: "1",
    }, body: { roomName: "attacker-room", identity: "attacker" } }));
    assert.equal(allowed.status, 200);
    assert.equal(calls[0].grant.room, "qalvi-real-from-db");
    assert.equal(calls[0].options.identity, "participant-p-1");
    assert.equal(calls[0].options.ttl, "5m");
    assert.equal(calls[0].options.attributes["qalvi.resume"], "true");
    assert.equal(calls[0].grant.canPublishSources.length, 1);
    assert.ok(!JSON.stringify(allowed.body).includes("test-secret"));
  } finally {
    [process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, process.env.LIVEKIT_URL] = previous;
  }
});
