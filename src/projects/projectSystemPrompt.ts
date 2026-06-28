import { PROJECT_OUTPUTS_DIRNAME } from "@/projects/constants";
import { ProjectFileRecord } from "@/projects/type";
import { AGENT_TODO_PLANNING_STEERING } from "@/system-prompts/agentTodoPlanningSteering";

/**
 * The program-authored project policy layer — the project-scope analogue of the global
 * built-in prompt (`COPILOT_PROMPT_BASE` / `DEFAULT_SYSTEM_PROMPT`). It is composed ahead of
 * a project's own instruction body (the user's `project.md`) and delivered, per scope, to
 * every backend: inlined into Claude's `<project_instructions>` and mirrored into the
 * `AGENTS.md` codex/opencode read from the session cwd.
 *
 * Why these rules are phrased relative to the working directory: a project session's cwd IS
 * the project folder (`resolveScopeCwd`), so "this project's folder" and "outputs/" stay
 * portable — no vault-absolute paths, no hardcoded folder branches.
 *
 * The default-only-cwd rule deliberately carves out the paths the user already opted into,
 * which reach the backend two ways: out-of-cwd context FOLDERS as `additionalDirectories`,
 * and materialized snapshots (PDFs/spreadsheets/images, web/YouTube captures) as inline
 * absolute paths in the `<project_context>` block. Both are expected reads, not violations —
 * so the rule names the block itself, not just the vague "configured context sources", to keep
 * an off-vault cache path (`~/.obsidian-copilot/.../context-cache/...`) from reading as
 * forbidden. Carrying its own
 * `## ` heading keeps this layer visually distinct from the user's custom prompt once the two
 * are concatenated. "Built-in" (vs the user's "Custom") matches the plugin's existing
 * vocabulary — the global "Disable builtin system prompt" toggle.
 */
export const BUILTIN_PROJECT_SYSTEM_PROMPT = `## Built-in system prompt
- This project's folder is your working directory and workspace. Write generated files, drafts, and intermediate artifacts under an \`${PROJECT_OUTPUTS_DIRNAME}/\` folder inside it, creating it if needed — unless the user names a different destination.
- Read and search inside the working directory by default. On top of that, the project's configured context sources listed in the \`<project_context>\` block are opted-in even when they live outside it — notably the off-vault materialized snapshots (converted PDFs/spreadsheets/images, web/YouTube captures) under the device-local context cache — so reading and searching those paths is expected, not a violation. When a source shows a \`→ <absolute path>\` snapshot pointer, read that path directly, without hesitation or asking.
- Don't reach for unrelated files outside the working directory or those context sources unless these instructions or the user point you to a specific file or location.`;

/**
 * Heading that opens the user's own system-prompt section. Markdown has no section terminator —
 * without this, the user body would structurally belong to the `## Built-in system prompt`
 * section above it (AGENTS.md-consuming agents treat `## ` headings as section boundaries). A
 * parallel heading keeps the built-in and custom prompts cleanly partitioned.
 */
export const PROJECT_CUSTOM_SYSTEM_PROMPT_HEADING = "## Custom system prompt";

/**
 * Layer the program-authored policy ahead of a project's own (custom) system prompt. The result
 * is never empty (the built-in sections are always present), so a project with a blank
 * `systemPrompt` still carries the policy. Each part is its own `## ` section, in order:
 *   1. {@link BUILTIN_PROJECT_SYSTEM_PROMPT} — the project workspace policy (cwd/outputs/search).
 *   2. {@link AGENT_TODO_PLANNING_STEERING} — when to create a todo/plan list. Project-scoped on
 *      purpose: injecting it here (not in the global `buildAgentSystemPrompt`) keeps the global
 *      no-project prompt byte-identical. The same constant can be promoted to global later — see
 *      the seam comment in `agentMode/backends/shared/agentSystemPrompt.ts`.
 *   3. The user's body under {@link PROJECT_CUSTOM_SYSTEM_PROMPT_HEADING}, last so it can override
 *      the built-ins on conflict (the AGENTS.md convention that more-specific, later guidance wins).
 *
 * Blankness is detected with `trim()`, but a non-blank body is concatenated UNTOUCHED:
 * `project.md` parsing deliberately preserves the body's leading whitespace
 * (`stripFrontmatter(..., { trimStart: false })`), and trimming here would e.g. break an
 * indented code block sitting at the very start of the user's instructions.
 */
export function composeProjectInstructions(userBody: string): string {
  const parts = [BUILTIN_PROJECT_SYSTEM_PROMPT, AGENT_TODO_PLANNING_STEERING];
  if (userBody.trim()) {
    parts.push(`${PROJECT_CUSTOM_SYSTEM_PROMPT_HEADING}\n\n${userBody}`);
  }
  return parts.join("\n\n");
}

/**
 * Single entry point both delivery paths (`getProjectProfile` for Claude, `ensureAgentsMirror`
 * for codex/opencode) call, so the nullish-handling rule for an absent body lives in one place.
 */
export function getComposedProjectInstructions(record: ProjectFileRecord): string {
  return composeProjectInstructions(record.project.systemPrompt ?? "");
}
