import "server-only";

export type LiveKitProfile = Readonly<{
  id: string;
  priority: number;
  enabled: boolean;
  serverUrl: string;
  apiKey: string;
  apiSecret: string;
  agentName: string | null;
  deployment: string | null;
}>;

const PROFILE_ID = /^[a-z][a-z0-9_]{0,39}$/;
const AGENT_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

export function loadLiveKitProfiles(env: NodeJS.ProcessEnv = process.env): LiveKitProfile[] {
  const configured = env.LIVEKIT_PROFILE_IDS;
  if (configured === undefined) {
    const serverUrl = env.LIVEKIT_URL;
    const apiKey = env.LIVEKIT_API_KEY;
    const apiSecret = env.LIVEKIT_API_SECRET;
    if (!serverUrl || !apiKey || !apiSecret) return [];
    if (!/^wss:\/\/[^\s/]+(?:\/.*)?$/.test(serverUrl)) throw new Error("Invalid LiveKit profile URL.");
    return [{ id: "primary", priority: 0, enabled: true, serverUrl, apiKey, apiSecret,
      agentName: null, deployment: null }];
  }

  const ids = configured.split(",").map((id) => id.trim());
  if (!ids.length || ids.some((id) => !PROFILE_ID.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("Invalid LiveKit profile identifiers.");
  }
  const profiles = ids.map((id, order) => {
    const prefix = `LIVEKIT_PROFILE_${id.toUpperCase()}_`;
    const serverUrl = env[`${prefix}URL`];
    const apiKey = env[`${prefix}API_KEY`];
    const apiSecret = env[`${prefix}API_SECRET`];
    const agentName = env[`${prefix}AGENT_NAME`] ?? null;
    const deployment = env[`${prefix}DEPLOYMENT`] ?? null;
    const enabledRaw = env[`${prefix}ENABLED`] ?? "true";
    const enabled = enabledRaw === "true";
    const priorityRaw = env[`${prefix}PRIORITY`];
    const priority = priorityRaw === undefined ? order : Number(priorityRaw);
    if (!serverUrl || !apiKey || !apiSecret || !/^wss:\/\/[^\s/]+(?:\/.*)?$/.test(serverUrl) ||
        !Number.isSafeInteger(priority) || priority < 0 || !["true", "false"].includes(enabledRaw) ||
        (agentName !== null && !AGENT_NAME.test(agentName)) ||
        (deployment !== null && (!AGENT_NAME.test(deployment) || !agentName))) {
      throw new Error(`Invalid LiveKit profile configuration: ${id}.`);
    }
    return { id, priority, enabled, serverUrl, apiKey, apiSecret, agentName, deployment };
  });
  if (new Set(profiles.map((profile) => profile.priority)).size !== profiles.length) {
    throw new Error("Duplicate LiveKit profile priorities.");
  }
  if (profiles.some((profile) => profile.enabled && !profile.agentName)) {
    throw new Error("Every enabled configured LiveKit profile requires a named agent.");
  }
  return profiles.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

export function assignmentTimeoutMs(env: NodeJS.ProcessEnv = process.env) {
  const value = Number(env.LIVEKIT_ASSIGNMENT_TIMEOUT_MS ?? "45000");
  if (!Number.isSafeInteger(value) || value < 10000 || value > 90000) {
    throw new Error("Invalid LiveKit assignment timeout.");
  }
  return value;
}

export function liveKitApiUrl(profile: LiveKitProfile) {
  return profile.serverUrl.replace(/^wss:/, "https:");
}
