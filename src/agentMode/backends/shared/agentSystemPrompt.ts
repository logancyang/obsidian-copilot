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
 *      Followed by `COPILOT_PLUS_TOOLS_STEERING` (prefer the builtin Copilot
 *      Plus web/media skills and proactively route external questions to them)
 *      and document steering selected by `docProcessorBackend`.
 *      Then `COPILOT_MIYO_SEARCH_STEERING` — appended only when the dedicated
 *      Miyo search-skill setting is enabled.
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
 * models, and sessions — only product source edits and the capability toggles
 * above may change it. That invariant is what makes the prompt a stable cache
 * prefix; see `agentSystemPrompt.test.ts` for the assertions that hold it.
 */
// Import the pill directive from its module rather than the skills barrel: a
// system-prompt builder needs only this one pure function, not SkillManager,
// discovery, or the Skills UI the barrel also re-exports.
import { buildPillSyntaxDirective } from "@/agentMode/skills/pillSyntaxDirective";
import { getSettings } from "@/settings/model";
import { getDisableBuiltinSystemPrompt } from "@/system-prompts/state";
/**
 * Steers the agent toward the bundled Copilot Plus skills for the relay
 * capabilities (see `skills/builtin/builtinSkills.ts`) instead of its own
 * built-in web/fetch tools, with an explicit fallback so the request never
 * dead-ends. Sent to every user regardless of Plus status: if a skill can't
 * run (no license, self-host, disabled, missing), its script exits telling the
 * agent to use its own equivalent tools, and the fallback clause routes it
 * there — so steering never blocks free users and is safe for everyone.
 */
export const COPILOT_PLUS_TOOLS_STEERING = `Prefer bundled skills: copilot-web-search for web search, copilot-web-fetch for pages/URLs, copilot-youtube-transcript for YouTube, copilot-fetch-x for X posts. Follow each skill's run instructions.
For vault questions, search locally first. Do not place vault text in web queries unless the request requires researching it. Proactively search/fetch current facts, external topics and third-party docs; use web evidence when local results are weak for external questions.
If a skill is missing, disabled, unlicensed or fails, silently use an equivalent tool; if none exists, say it's unavailable. Never block on upgrading. Mention upgrade/renewal briefly and occasionally only when the skill explicitly invites it.`;

/**
 * Document steering when Copilot Plus is the selected Document Processor. Split
 * out of `COPILOT_PLUS_TOOLS_STEERING` so the Miyo alternative can replace it
 * wholesale — naming `copilot-read-pdf` in an always-sent block would point a
 * Miyo user at a skill that is not seeded.
 */
export const COPILOT_PLUS_DOCUMENT_STEERING = `For PDFs, prefer copilot-read-pdf; the same fallback applies.`;

/**
 * Document steering when Miyo is the selected Document Processor. Fails closed
 * on purpose — it must cancel the blanket fallback clause in
 * `COPILOT_PLUS_TOOLS_STEERING`, or the agent could interpret the equivalent-tool fallback
 * as permission to send the document to the cloud.
 */
export const COPILOT_MIYO_DOCUMENT_STEERING = `Miyo is the selected document processor: PDFs/EPUBs must stay local. Use miyo-parse. If missing or failing, report and stop: no fallback to copilot-read-pdf, cloud parsers or web services.`;

/**
 * Steers the agent toward the bundled `miyo-search` skill for vault search. A
 * prose skill is only invoked if the model thinks to use it, and the SKILL.md
 * description alone proved unreliable, so we name it explicitly in the system
 * prompt the way `COPILOT_PLUS_TOOLS_STEERING` names the relay skills, with
 * concrete triggers (grep too slow / too few relevant hits / explicit request).
 *
 * Unlike the Plus steering, this is gated by `enableMiyoSearchSkill`, so it
 * never tells the agent to reach for a skill that isn't seeded. That keeps the
 * prompt in lockstep with the seeding gate in `agentMode/index.ts`.
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
 * Compose the full system prompt every Agent Mode backend forwards. See the
 * file header for the three parts and their ordering rationale.
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
 * Reads the live built-in-prompt state (`getDisableBuiltinSystemPrompt`) at call time.
 * Backends call this at their natural
 * prompt-injection point — spawn time for opencode/codex, `newSession()` for
 * the Claude SDK — so a settings change applies to the next session.
 *
 * Project *file context* (folders/notes/URLs) is NOT part of the system prompt:
 * it is delivered as a `<project_context>` block inlined into the session's
 * first user message (reachable by all three backends), built by the context
 * materializer's `buildProjectContextBlock`.
 */
export function buildAgentSystemPrompt(): string {
  const parts: string[] = [];

  // The "Disable builtin system prompt" toggle suppresses only the Copilot
  // base framing — mirroring how legacy chat's `getSystemPrompt()` drops
  // `DEFAULT_SYSTEM_PROMPT`. The pill-syntax directive below is functional
  // wiring (it explains the editor's mention tokens), not builtin framing, so
  // it is always sent.
  if (!getDisableBuiltinSystemPrompt()) {
    const settings = getSettings();
    parts.push(COPILOT_PROMPT_BASE);
    // Always steer toward the builtin Copilot Plus skills, regardless of Plus
    // status. Gating on `isPaidUser` would be wrong anyway — valid self-host
    // mode is Plus-enabled but reports `isPaidUser: false` — and if a skill
    // can't run, its script exits telling the agent to use its own equivalent
    // tools and the fallback clause routes it there. Never blocks free users.
    parts.push(COPILOT_PLUS_TOOLS_STEERING);
    parts.push(
      settings.docProcessorBackend === "miyo"
        ? COPILOT_MIYO_DOCUMENT_STEERING
        : COPILOT_PLUS_DOCUMENT_STEERING
    );
    // Miyo steering is gated on the same flag that seeds the skill, so we only
    // point the agent at `miyo-search` when the user has installed it — the
    // prompt-side half of respecting the "Miyo search skill" toggle.
    if (settings.enableMiyoSearchSkill === true) {
      parts.push(COPILOT_MIYO_SEARCH_STEERING);
    }
  }

  // Outside the toggle on purpose — see COPILOT_PROJECT_WORKSPACE_POLICY.
  parts.push(COPILOT_PROJECT_WORKSPACE_POLICY);
  parts.push(COPILOT_INSTRUCTION_PRECEDENCE);
  parts.push(buildPillSyntaxDirective());

  return parts.join("\n\n");
}
