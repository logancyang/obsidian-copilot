import { REMOTE_IMAGE_BYTES_PER_COMMAND } from "@/agentMode/protocol/limits";
import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import type { BackendId } from "@/agentMode/session/types";
import type { AgentPaneCapabilities } from "@/agentMode/ui/AgentPaneContext";
import ClaudeLogo from "@/lib/agent-logos/claude.svg";
import CodexLogo from "@/lib/agent-logos/codex.svg";
import OpencodeLogo from "@/lib/agent-logos/opencode.svg";

type BackendIcon = NonNullable<ReturnType<NonNullable<AgentPaneCapabilities["backendIcon"]>>>;

const LOGOS: Readonly<Record<string, BackendIcon>> = Object.freeze({
  claude: ClaudeLogo,
  codex: CodexLogo,
  opencode: OpencodeLogo,
});

// The phone runs beside its own synced vault, not the desktop's files or settings, so it leaves out
// every capability that would open a desktop path, edit the desktop's editor or persist a desktop
// default: a pick made on the phone changes only that session. Agent names come from the desktop's
// catalog; logos are the three the plugin ships. Whether `@` may mention several agents is decided
// by the desktop, which serves this phone only while its own Plus check passes.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
export function createPhonePaneCapabilities(client: SessionClient): AgentPaneCapabilities {
  return {
    vaultBase: null,
    backendIcon: (backendId: BackendId) => LOGOS[backendId],
    backendName: (backendId: BackendId) =>
      client.getHost()?.backends.find((backend) => backend.id === backendId)?.displayName,
    multiAgentAllowed: true,
    imageBytesBudget: REMOTE_IMAGE_BYTES_PER_COMMAND,
  };
}
