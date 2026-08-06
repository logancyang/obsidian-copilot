import type { InstallState } from "@/agentMode/session/types";
import {
  CompatibilityStore,
  type CompatibilityRefreshOptions,
  type CompatibilityStoreInput,
} from "@/agentMode/backends/shared/compatibilityStore";
import {
  probeClaudeVersion,
  type ClaudeVersionRunner,
} from "@/agentMode/backends/claude/claudeVersion";

export interface ClaudeCompatibilityInput extends CompatibilityStoreInput {
  path: string;
  env: NodeJS.ProcessEnv;
}

interface RefreshOptions extends CompatibilityRefreshOptions {
  run?: ClaudeVersionRunner;
}

export const claudeCompatibilityStore = new CompatibilityStore<
  ClaudeCompatibilityInput,
  RefreshOptions
>(async (input, options): Promise<InstallState> => {
  const compatibility = await probeClaudeVersion(input.path, input.env, options.run);
  if (compatibility.kind === "supported") {
    return { kind: "ready", source: input.source };
  }
  return { ...compatibility, source: input.source };
});
