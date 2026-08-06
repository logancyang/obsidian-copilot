import type { InstallState } from "@/agentMode/session/types";

/** Recovery guidance for the resolved Claude installation source. */
export function claudeUpdateDetail(state: InstallState): string {
  if (state.kind === "incompatible" && state.source === "custom") {
    return "Update the binary at the saved path, or clear the override to use an auto-detected installation.";
  }
  return "Update it with the install command below, then reopen this dialog.";
}
