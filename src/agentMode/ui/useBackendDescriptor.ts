import { getActiveBackendDescriptor } from "@/agentMode/backends/registry";
import type { BackendDescriptor, InstallState } from "@/agentMode/session/types";
import { useSettingsValue } from "@/settings/model";

/** Resolve the active backend descriptor from settings. */
export function useActiveBackendDescriptor(): BackendDescriptor {
  return getActiveBackendDescriptor(useSettingsValue());
}

/** Compute the descriptor's current install state. Recomputes each render. */
export function useBackendInstallState(descriptor: BackendDescriptor): InstallState {
  return descriptor.getInstallState(useSettingsValue());
}
