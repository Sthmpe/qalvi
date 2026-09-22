import { ConnectionState, type Room } from "livekit-client";
import type { ConnectionStatus } from "./types";

/** Read-only adapter for LiveKit 2.22's own reconciliation checks.
 * Room.state can lag a dead engine. Never reconnect/mutate the engine here:
 * recoverable transports remain the SDK's responsibility.
 */
export function sessionHealth(room: Room): ConnectionStatus {
  if (room.state === ConnectionState.Connecting) return "connecting";
  if (room.state === ConnectionState.Reconnecting || room.state === ConnectionState.SignalReconnecting) return "reconnecting";
  if (room.state !== ConnectionState.Connected || !room.engine || room.engine.isClosed) return "failed";
  return room.engine.verifyTransport() ? "connected" : "reconnecting";
}
