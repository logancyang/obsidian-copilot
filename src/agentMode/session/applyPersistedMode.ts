import { logWarn } from "@/logger";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import type { CopilotMode } from "@/agentMode/session/types";

/**
 * Coerce a freshly created session into the given canonical mode. Skipped
 * when the agent doesn't advertise modes or when the target mode isn't
 * currently mappable (filtered out by the descriptor's `getModeMapping`).
 * Dispatches on the apply-spec kind so backends with `setMode` channels and
 * backends with `configOption`-driven modes share one implementation.
 *
 * Used to force canonical `default` (ask mode) on every new session — modes
 * are never persisted across sessions.
 */
export async function applyPersistedMode(
  session: AgentSession,
  persistedMode: CopilotMode
): Promise<void> {
  const state = session.getState();
  if (!state?.mode) return;
  if (state.mode.current === persistedMode) return;
  const spec = state.mode.apply[persistedMode];
  if (!spec) return;
  try {
    if (spec.kind === "setMode") {
      await session.setMode(spec.nativeId);
    } else {
      await session.setConfigOption(spec.configId, spec.value);
    }
  } catch (e) {
    if (e instanceof MethodUnsupportedError) return;
    logWarn(`[AgentMode] could not apply default mode ${persistedMode}`, e);
  }
}
