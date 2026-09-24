import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { ModeApplySpec } from "@/agentMode/session/types";

/** Apply all backend settings represented by one picker choice, in order. */
export async function applyModeSpec(
  session: Pick<AgentSession, "setMode" | "setConfigOption">,
  spec: ModeApplySpec
): Promise<void> {
  // One choice can change both Codex's approval preset and collaboration workflow.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/551
  const steps = spec.kind === "sequence" ? spec.steps : [spec];
  for (const step of steps) {
    if (step.kind === "setMode") {
      await session.setMode(step.nativeId);
    } else {
      await session.setConfigOption(step.configId, step.value);
    }
  }
}
