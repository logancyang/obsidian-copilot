import { logWarn } from "@/logger";
import type { AgentSession } from "./AgentSession";
import { MethodUnsupportedError } from "./errors";
import { applyModeSpec } from "./modeApply";
import type { CopilotMode } from "./types";

export async function replayPersistedMode(
  session: AgentSession,
  mode: CopilotMode | null
): Promise<void> {
  if (!mode) return;
  const modeState = session.getState()?.mode;
  if (!modeState) return;
  if (modeState.current === mode) return;
  const spec = modeState.apply[mode];
  if (!spec) return;
  try {
    await applyModeSpec(session, spec);
  } catch (e) {
    if (e instanceof MethodUnsupportedError) return;
    logWarn(`[AgentMode] could not replay persisted mode "${mode}"`, e);
  }
}
