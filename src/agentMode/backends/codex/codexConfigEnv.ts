interface CodexManagedConfig {
  developer_instructions: string;
  approval_policy: "on-request";
  approvals_reviewer: "user";
  sandbox_mode: "workspace-write";
}

// Codex budgets skill descriptions from its resolved context window. These ceilings give
// large-context models enough budget while Codex clamps them to each model's supported limits.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/322
const CODEX_DEFAULT_CONFIG = {
  model_context_window: 1_000_000,
  model_auto_compact_token_limit: 500_000,
};

function parseCodexConfig(value: string | undefined): Record<string, unknown> {
  if (!value?.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Codex CODEX_CONFIG must be a valid JSON object.");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Codex CODEX_CONFIG must be a valid JSON object.");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Current codex-acp versions ignore server-mode argv and consume Codex config
 * from this JSON env var. User config can customize product defaults, while
 * plugin-owned fields win so inherited values cannot silently remove the
 * prompt and safety defaults Agent Mode requires.
 */
export function mergeCodexConfigEnv(
  existing: string | undefined,
  developerInstructions: string
): string {
  const managed: CodexManagedConfig = {
    developer_instructions: developerInstructions,
    approval_policy: "on-request",
    approvals_reviewer: "user",
    sandbox_mode: "workspace-write",
  };
  return JSON.stringify({
    ...CODEX_DEFAULT_CONFIG,
    ...parseCodexConfig(existing),
    ...managed,
  });
}
