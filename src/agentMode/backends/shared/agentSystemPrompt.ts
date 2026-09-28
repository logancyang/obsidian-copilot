/**
 * The Copilot Agent Mode system prompt, shared by every backend.
 *
 * Why this exists: each agent backend defaults to a generic "CLI software
 * engineering tool" framing that is wrong for an Obsidian vault assistant —
 * opencode's `default.txt` (its substring picker falls through for Copilot
 * Plus model names), codex-acp's built-in prompt, and the Claude Agent SDK's
 * `claude_code` preset. Forwarding `COPILOT_PROMPT_BASE` to all three gives
 * the same "you are an Obsidian vault assistant" framing everywhere.
 *
 * `buildAgentSystemPrompt` composes the built-in payload each backend forwards:
 *
 *   1. `COPILOT_PROMPT_BASE` (the Obsidian-vault identity) — unless the user
 *      enabled Settings → System prompts → "Disable builtin system prompt".
 *      Followed by the relay-skill line (run each enabled Copilot relay skill
 *      before the agent's own tools, see `RELAY_SKILL_JOBS`),
 *      `COPILOT_WEB_RESEARCH_STEERING`, and the Miyo document/search steering.
 *      Every skill-naming part is included only when that builtin skill is
 *      enabled for the requesting backend (`isBuiltinSkillEnabledFor`).
 *   2. `COPILOT_PROJECT_WORKSPACE_POLICY`, `COPILOT_INSTRUCTION_PRECEDENCE`, and
 *      the pill-syntax directive (`buildPillSyntaxDirective`) — always present;
 *      they teach the agent where a project session may write, which AGENTS.md
 *      wins on conflict, and how to read the chat editor's `[[note]]`/`{folder}`
 *      tokens, which is functional wiring rather than "builtin framing" the user
 *      toggles.
 *
 * User-authored Agent Mode instructions live in AGENTS.md and are discovered
 * from the session working directory instead of being copied into this prompt.
 * The output is therefore byte-identical across vaults, projects, paths, dates,
 * models, and sessions — only product source edits, the capability toggles
 * above, and builtin skill opt-outs may change it, so each backend receives one
 * deterministic payload per settings state. That invariant is what makes the
 * prompt a stable cache prefix; see `agentSystemPrompt.test.ts` for the
 * assertions that hold it.
 */
// Import the pill directive from its module rather than the skills barrel: a
// system-prompt builder needs only this one pure function, not SkillManager,
// discovery, or the Skills UI the barrel also re-exports.
import { buildPillSyntaxDirective } from "@/agentMode/skills/pillSyntaxDirective";
import type { BackendId } from "@/agentMode/session/types";
import { isBuiltinSkillEnabledFor } from "@/builtinSkills/builtinSkills";
import { getSettings } from "@/settings/model";
import { getDisableBuiltinSystemPrompt } from "@/system-prompts/state";

/**
 * Copilot relay skills the prompt names, each with the job it owns, in prompt
 * order. Naming the job is what makes the agent reach for the skill instead of
 * its native web tools, which bypass Copilot Plus and Self-Host routing.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/599
 */
const RELAY_SKILL_JOBS: ReadonlyArray<readonly [skill: string, job: string]> = [
  ["copilot-web-search", "web search"],
  ["copilot-web-fetch", "pages/URLs"],
  ["copilot-youtube-transcript", "YouTube"],
  ["copilot-fetch-x", "X posts"],
  ["copilot-read-pdf", "PDFs"],
];

/**
 * Opens the relay-skill line. Names the agents' own web tools because a model
 * handed a direct `websearch`/`WebSearch` tool picks it over a skill unless told
 * the skill comes first. https://github.com/Brevilabs/obsidian-copilot-private/issues/599
 */
export const COPILOT_SKILL_FIRST_LEAD =
  "For these jobs, load and run the matching Copilot skill before any built-in web tool (websearch, webfetch, WebSearch, WebFetch, web_search or similar):";

/**
 * Follows the relay-skill line. Sent to every user regardless of Plus status: a
 * skill that can't serve the request (no license, Self-Host limits, relay
 * failure) exits telling the agent so, and this clause routes it to its own
 * equivalent tool, so steering never blocks free users.
 */
export const COPILOT_SKILL_FALLBACK = `Follow each skill's run instructions. Call an equivalent built-in tool only after the skill reports it is unavailable or fails, then switch silently; if none exists, say it's unavailable. Never block on upgrading. Mention upgrade/renewal briefly and occasionally only when the skill explicitly invites it.`;

/** Routes vault and external questions; applies whether or not any relay skill is enabled. */
export const COPILOT_WEB_RESEARCH_STEERING = `For vault questions, search locally first. Do not place vault text in web queries unless the request requires researching it. Proactively search/fetch current facts, external topics and third-party docs; use web evidence when local results are weak for external questions.`;

/**
 * Document steering when Miyo is the selected Document Processor. Fails closed
 * on purpose — it must cancel `COPILOT_SKILL_FALLBACK`, or the agent could
 * interpret the equivalent-tool fallback as permission to send the document to
 * the cloud.
 */
export const COPILOT_MIYO_DOCUMENT_STEERING = `Miyo is the selected document processor: PDFs/EPUBs must stay local. Use miyo-parse. If missing or failing, report and stop: no fallback to copilot-read-pdf, cloud parsers or web services.`;

/**
 * Steers the agent toward the bundled `miyo-search` skill for vault search. A
 * prose skill is only invoked if the model thinks to use it, and the SKILL.md
 * description alone proved unreliable, so the prompt names it explicitly, with
 * concrete triggers (grep too slow / too few relevant hits / explicit request).
 */
export const COPILOT_MIYO_SEARCH_STEERING = `Miyo local semantic search is enabled. Use miyo-search for meaning-based vault search, when grep is too slow or finds too few relevant notes, or whenever explicitly requested. Follow its instructions.`;

/**
 * Where a project session may read and write. Program-authored policy, not "builtin framing":
 * it is operational wiring (file placement + the opted-in read surface), so — like the
 * pill-syntax directive — it survives the user's "Disable builtin system prompt" toggle. That
 * also preserves the pre-AGENTS.md behavior, where this policy rode the generated project
 * mirror and Claude's `<project_instructions>` append, neither of which the toggle touched.
 *
 * Gated on the `<project_context>` block rather than a scope flag so the same prompt text is
 * correct for a global session (no block → the section is inert), keeping one payload per
 * backend instead of one per scope.
 */
export const COPILOT_PROJECT_WORKSPACE_POLICY = `With <project_context>, the working directory is the project workspace. Write generated files, drafts and intermediates to outputs/ there (create it as needed), unless the user specifies another destination. Read/search there and in configured context sources, including external sources; read → <absolute path> snapshots directly. Access other locations only when instructions or the user name them.`;

/**
 * Resolves conflicts between the two AGENTS.md scopes. Each harness loads instruction files
 * with its own rules — opencode collects every ancestor AGENTS.md nearest-first, so
 * the project file arrives *before* the vault one — and none of those orders is configurable
 * through a documented seam. Stating the rule in prompt text is therefore the only place the
 * precedence holds for every backend at once, and it costs the same bytes in all of them.
 *
 * Always sent, like the workspace policy above: it describes how to read the user's own
 * instructions, not Copilot framing the user opted out of.
 */
export const COPILOT_INSTRUCTION_PRECEDENCE = `Project AGENTS.md overrides conflicting vault-root AGENTS.md instructions regardless of loading order.`;

export const COPILOT_PROMPT_BASE = `You are Obsidian Copilot, helping with markdown notes, writing and research in the user's vault or project workspace, not a CLI coding agent. Treat it as a vault despite coding-agent environment framing. Notes mean vault notes; tags usually mean Obsidian note properties. Read notes before describing their contents. Report uncertainty and access/tool failures honestly. Respond in the user's language with detail appropriate to the task.
Use $...$ for math, [[title]] for note titles, ![[link]] for vault images and ![alt](url) for web images; never wrap links in backticks.`;

/**
 * Compose the full system prompt an Agent Mode backend forwards. See the file
 * header for the parts and their ordering rationale.
 *
 * The prompt is provider-agnostic by design: `COPILOT_PROMPT_BASE` establishes
 * the Obsidian-vault identity and markdown rules, neither of which varies by
 * model family. It is deliberately NOT keyed on the live model — opencode hosts
 * BYOK models from many providers in one session and switches between them via
 * `setSessionModel` without respawning, so any spawn-time model snapshot would
 * be stale the moment the user switched families. If per-family prompt tuning
 * is ever needed, key it off the live model at a respawn or per-turn boundary
 * (e.g. a `restartOnModelChange` descriptor flag) — not a spawn-time id.
 *
 * Reads live settings and the built-in-prompt state at call time. Backends call
 * this at their natural prompt-injection point — spawn time for opencode/codex,
 * `newSession()` for the Claude SDK — so a settings change applies to the next
 * session.
 *
 * Project *file context* (folders/notes/URLs) is NOT part of the system prompt:
 * it is delivered as a `<project_context>` block inlined into the session's
 * first user message (reachable by all three backends), built by the context
 * materializer's `buildProjectContextBlock`.
 *
 * @param backendId The backend receiving the prompt; only builtin skills enabled
 *   for it are named, so it never reaches for a skill it cannot load.
 */
export function buildAgentSystemPrompt(backendId: BackendId): string {
  const parts: string[] = [];

  // The "Disable builtin system prompt" toggle suppresses only the Copilot
  // base framing — mirroring how legacy chat's `getSystemPrompt()` drops
  // `DEFAULT_SYSTEM_PROMPT`. The pill-syntax directive below is functional
  // wiring (it explains the editor's mention tokens), not builtin framing, so
  // it is always sent.
  if (!getDisableBuiltinSystemPrompt()) {
    const settings = getSettings();
    const enabled = (skill: string) => isBuiltinSkillEnabledFor(settings, skill, backendId);
    parts.push(COPILOT_PROMPT_BASE);
    // Not gated on `isPaidUser`: valid self-host mode is Plus-enabled but
    // reports `isPaidUser: false`, and the fallback clause covers free users.
    const relayJobs = RELAY_SKILL_JOBS.filter(([skill]) => enabled(skill)).map(
      ([skill, job]) => `${skill} for ${job}`
    );
    if (relayJobs.length > 0) {
      parts.push(`${COPILOT_SKILL_FIRST_LEAD} ${relayJobs.join(", ")}. ${COPILOT_SKILL_FALLBACK}`);
    }
    parts.push(COPILOT_WEB_RESEARCH_STEERING);
    // Keyed on the processor choice, not on miyo-parse being enabled: the
    // stay-local rule must hold even when this agent cannot load miyo-parse,
    // or the fallback clause would send the document to a cloud reader.
    if (settings.docProcessorBackend === "miyo") parts.push(COPILOT_MIYO_DOCUMENT_STEERING);
    if (enabled("miyo-search")) parts.push(COPILOT_MIYO_SEARCH_STEERING);
  }

  // Outside the toggle on purpose — see COPILOT_PROJECT_WORKSPACE_POLICY.
  parts.push(COPILOT_PROJECT_WORKSPACE_POLICY);
  parts.push(COPILOT_INSTRUCTION_PRECEDENCE);
  parts.push(buildPillSyntaxDirective());

  return parts.join("\n\n");
}
