interface CodexManagedConfig {
  developer_instructions: string;
  approval_policy: "on-request";
  approvals_reviewer: "user";
  sandbox_mode: "workspace-write";
}

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
 * from this JSON env var. Plugin-owned fields win so inherited/user config
 * cannot silently remove the prompt and safety defaults Agent Mode requires.
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
  return JSON.stringify({ ...parseCodexConfig(existing), ...managed });
}
