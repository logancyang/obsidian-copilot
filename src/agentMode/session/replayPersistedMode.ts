import { logWarn } from "@/logger";
import type { AgentSession } from "./AgentSession";
import { MethodUnsupportedError } from "./errors";
import type { CopilotMode } from "./types";

/**
 * Re-apply the user's sticky permission-mode preference to a freshly created
 * session, so a new conversation reopens in the mode they last chose (e.g.
 * `auto`) instead of always resetting to the agent's natural starting mode.
 *
 * Backend-agnostic: it dispatches through the canonical `mode.apply` spec the
 * session already exposes (`setMode` vs `setConfigOption`), so it needs no
 * per-backend branching. A backend that has no modes, hasn't advertised this
 * mode, or is already in it is a no-op. Mode state ships with the session's
 * initial `BackendState`, so a single attempt at `ready` suffices — unlike
 * effort, which can arrive late and needs a subscription.
 *
 * @param session The session to seed (the one being initialized, not "active").
 * @param mode The persisted canonical mode, or `null` when none is stored.
 */
export async function replayPersistedMode(
  session: AgentSession,
  mode: CopilotMode | null
): Promise<void> {
  if (!mode) return;
  const modeState = session.getState()?.mode;
  if (!modeState) return; // backend exposes no modes
  if (modeState.current === mode) return; // already there — nothing to do
  const spec = modeState.apply[mode];
  if (!spec) return; // this backend doesn't offer the persisted mode
  try {
    if (spec.kind === "setMode") {
      await session.setMode(spec.nativeId);
    } else {
      await session.setConfigOption(spec.configId, spec.value);
    }
  } catch (e) {
    if (e instanceof MethodUnsupportedError) return;
    logWarn(`[AgentMode] could not replay persisted mode "${mode}"`, e);
  }
}
