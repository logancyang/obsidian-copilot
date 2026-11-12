import type { CopilotSettings } from "@/settings/model";
import { ClaudeBackendDescriptor } from "./claude/descriptor";
import { CodexBackendDescriptor } from "./codex/descriptor";
import { OpencodeBackendDescriptor } from "./opencode/descriptor";
import type { BackendDescriptor, BackendId } from "@/agentMode/session/types";

export const backendRegistry: Record<BackendId, BackendDescriptor> = {
  opencode: OpencodeBackendDescriptor,
  claude: ClaudeBackendDescriptor,
  codex: CodexBackendDescriptor,
};

export const RECOMMENDED_BACKEND_ID: BackendId = "opencode";

let displayOrderCache: BackendDescriptor[] | null = null;

export function backendDisplayOrder(): BackendDescriptor[] {
  if (!displayOrderCache) {
    displayOrderCache = [
      OpencodeBackendDescriptor,
      ClaudeBackendDescriptor,
      CodexBackendDescriptor,
    ];
  }
  return displayOrderCache;
}

export function backendNeedsSelfHostWarning(
  descriptor: BackendDescriptor,
  settings: CopilotSettings
): boolean {
  return settings.enableSelfHostMode && !descriptor.selfHostable;
}

export function getActiveBackendDescriptor(settings: CopilotSettings): BackendDescriptor {
  const id = settings.agentMode?.activeBackend ?? "opencode";
  return backendRegistry[id] ?? OpencodeBackendDescriptor;
}

export function listBackendDescriptors(): BackendDescriptor[] {
  return Object.values(backendRegistry);
}
