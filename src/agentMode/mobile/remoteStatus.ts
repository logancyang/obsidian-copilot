import type { ConnectionState, HostVersion } from "@/agentMode/protocol/SessionClient";
import type { LinkFailure, LinkState } from "@/agentMode/mobile/RemoteSessionTransport";

export interface VersionInfo {
  app: string;
  protocol: number;
}

// A full-screen state replaces the chat when there is nothing to show. Once the phone holds a
// replica, a lost connection shows a banner over it instead, so the transcript stays readable.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
export type RemoteScreen =
  | { kind: "connecting" }
  | { kind: "syncing" }
  | { kind: "offline" }
  | { kind: "unreachable" }
  | { kind: "protocol" }
  | { kind: "denied" }
  | { kind: "version_mismatch"; local: VersionInfo; remote: VersionInfo | null };

export type RemoteBanner = "reconnecting" | "offline" | "unreachable" | "protocol";

export interface RemoteStatus {
  screen: RemoteScreen | null;
  banner: RemoteBanner | null;
}

export interface RemoteStatusInput {
  link: LinkState;
  connection: ConnectionState;
  hasReplica: boolean;
  local: VersionInfo;
  remote: HostVersion | null;
}

const screenStatus = (screen: RemoteScreen): RemoteStatus =>
  Object.freeze({ screen, banner: null });
const bannerStatus = (banner: RemoteBanner): RemoteStatus =>
  Object.freeze({ screen: null, banner });

const READY: RemoteStatus = Object.freeze({ screen: null, banner: null });
const CONNECTING = screenStatus({ kind: "connecting" });
const SYNCING = screenStatus({ kind: "syncing" });
const DENIED = screenStatus({ kind: "denied" });
const RECONNECTING = bannerStatus("reconnecting");

const FAILURE_STATUS: Record<LinkFailure, RemoteStatus> = {
  offline: screenStatus({ kind: "offline" }),
  unreachable: screenStatus({ kind: "unreachable" }),
  protocol: screenStatus({ kind: "protocol" }),
};

const FAILURE_BANNER: Record<LinkFailure, RemoteStatus> = {
  offline: bannerStatus("offline"),
  unreachable: bannerStatus("unreachable"),
  protocol: bannerStatus("protocol"),
};

export function deriveRemoteStatus(input: RemoteStatusInput): RemoteStatus {
  const { link, connection, hasReplica, local, remote } = input;
  if (connection === "version_mismatch") {
    return {
      screen: {
        kind: "version_mismatch",
        local,
        remote: remote ? { app: remote.app, protocol: remote.v } : null,
      },
      banner: null,
    };
  }
  if (link.phase === "denied") return DENIED;
  if (connection === "live") return hasReplica ? READY : SYNCING;
  // The last failure stays on screen while the next attempt dials, or the message would flash for the
  // one second between attempts and read as "Connecting" the rest of the time.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/613
  const failure = link.phase === "retrying" || link.phase === "connecting" ? link.failure : null;
  if (hasReplica) return failure ? FAILURE_BANNER[failure] : RECONNECTING;
  return failure ? FAILURE_STATUS[failure] : CONNECTING;
}
