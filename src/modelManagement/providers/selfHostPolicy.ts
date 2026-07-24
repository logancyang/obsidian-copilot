/**
 * Self-Host Mode provider warning policy — the single source of truth for
 * "does this provider's models carry a cloud-egress warning while Self-Host
 * Mode is on?".
 *
 * Self-Host Mode (a Believer/Supporter feature) is a **presentation label** on
 * the priciest plan; it does not technically block egress. Cloud LLMs stay
 * visible and selectable, but are flagged with a warning marker (and sorted
 * below self-hosted options in the UI) so the user decides whether to route
 * through them. Flagging is a **view-layer projection**: this predicate
 * annotates read outputs at the enumeration chokepoints
 * (`backendPickerAtomFamily`, `BackendConfigRegistry.resolveEnabled`) and NEVER
 * writes settings, so turning the mode off clears every flag with the persisted
 * selection untouched.
 *
 * The agent-backend axis (Claude/Codex flagged, opencode clean) is annotated
 * separately at the `BackendDescriptor` level in `agentMode/backends/registry`,
 * keeping this low layer free of any agent-id knowledge.
 */

import type { Provider } from "@/modelManagement/types/persisted";

import { isSelfHostedProvider } from "./isSelfHostedProvider";

/** The only settings slice this policy reads. */
export interface SelfHostPolicyInput {
  enableSelfHostMode: boolean;
}

/**
 * Whether `provider`'s models should show a cloud-egress warning while
 * Self-Host Mode is active. When the mode is off this is always `false` (no
 * warning).
 *
 *   - `copilot-plus` → warns: Copilot-hosted cloud, never self-hostable.
 *   - `byok`         → warns unless the base URL resolves to a
 *                      loopback / private / `.local` host (`isSelfHostedProvider`).
 *   - `agent`        → never warns here: agent-origin models never reach a
 *                      non-agent picker (the chat backend excludes them), and the
 *                      agent axis is flagged at the descriptor level instead.
 *                      Deferring here keeps this module free of agent-id branching.
 */
export function providerNeedsSelfHostWarning(
  provider: Provider,
  settings: SelfHostPolicyInput
): boolean {
  if (!settings.enableSelfHostMode) return false;
  switch (provider.origin.kind) {
    case "copilot-plus":
      return true;
    case "byok":
      return !isSelfHostedProvider(provider);
    case "agent":
      return false;
  }
}
