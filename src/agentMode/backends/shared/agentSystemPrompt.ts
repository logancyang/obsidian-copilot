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
 * `buildAgentSystemPrompt` composes the full payload each backend forwards:
 *
 *   1. `COPILOT_PROMPT_BASE` (the Obsidian-vault identity) — unless the user
 *      enabled Settings → System prompts → "Disable builtin system prompt".
 *      Followed by `COPILOT_PLUS_TOOLS_STEERING` (prefer the builtin Copilot
 *      Plus skills, with a fallback to the agent's own tools) — sent to everyone.
 *      Then `COPILOT_MIYO_SEARCH_STEERING` — appended only when `shouldUseMiyo`
 *      is true, so the agent is pointed at the `miyo-search` skill only while
 *      Miyo is enabled and available.
 *   2. The pill-syntax directive (`buildPillSyntaxDirective`) — always present;
 *      it teaches the agent how to read the chat editor's `[[note]]`/`{folder}`
 *      tokens and is functional wiring, not "builtin framing" the user toggles.
 *   3. The user's custom prompt (`getEffectiveUserPrompt`) wrapped in
 *      `<user_custom_instructions>`, mirroring legacy chat's `getSystemPrompt()`.
 *
 * `COPILOT_PROMPT_BASE` content is curated, not invented. Two existing Copilot
 * prompts cover most of what's needed:
 *
 *   - `DEFAULT_SYSTEM_PROMPT` (`src/constants.ts`) — the chat-mode identity and
 *     formatting rules. Most rules port directly; chat-only hooks (`@vault`,
 *     `getCurrentTime`, YouTube auto-transcribe) are dropped because that
 *     infrastructure does not exist in Agent Mode. Reusing `DEFAULT_SYSTEM_PROMPT`
 *     verbatim would re-introduce that noise.
 *   - `AGENT_LOOP_GUIDANCE` (`src/LLMProviders/chainRunner/
 *     AutonomousAgentChainRunner.ts`) — the in-process autonomous agent's loop
 *     bullets. Ported verbatim — the agent shape is the same.
 */
// Import the pill directive from its module rather than the skills barrel: a
// system-prompt builder needs only this one pure function, not SkillManager,
// discovery, or the Skills UI the barrel also re-exports.
import { buildPillSyntaxDirective } from "@/agentMode/skills/pillSyntaxDirective";
import { shouldUseMiyo } from "@/miyo/miyoUtils";
import { getSettings } from "@/settings/model";
import { getDisableBuiltinSystemPrompt } from "@/system-prompts/state";
import { getEffectiveUserPrompt } from "@/system-prompts/systemPromptBuilder";
/**
 * Steers the agent toward the bundled Copilot Plus skills for the relay
 * capabilities (see `skills/builtin/builtinSkills.ts`) instead of its own
 * built-in web/fetch tools, with an explicit fallback so the request never
 * dead-ends. Sent to every user regardless of Plus status: if a skill can't
 * run (no license, self-host, disabled, missing), its script exits telling the
 * agent to use its own equivalent tools, and the fallback clause routes it
 * there — so steering never blocks free users and is safe for everyone.
 */
export const COPILOT_PLUS_TOOLS_STEERING = `## Copilot Plus tools
For these requests, prefer the bundled Copilot skill over any built-in tool of your own:
- Searching the web → the \`copilot-web-search\` skill
- Fetching or reading a specific web page → the \`copilot-web-fetch\` skill
- Reading a PDF file → the \`copilot-read-pdf\` skill
- Getting a YouTube video's transcript → the \`copilot-youtube-transcript\` skill
- Fetching an X (Twitter) post → the \`copilot-fetch-x\` skill

Each skill ships both a \`.sh\` and a \`.mjs\` script. Run the \`.sh\` with \`sh\` first; if the platform can't run \`sh\` (for example, Windows without Git Bash), run the matching \`.mjs\` with \`node\` instead. If neither \`sh\` nor \`node\` is available, tell the user to install Node.js from https://nodejs.org and try again.

If a skill is missing, disabled, reports that Copilot Plus is not active, or fails for this particular request (for example a page it can't fetch or any other relay error), silently fall back to your own equivalent tool (or, if you have none for that task, tell the user it's unavailable) and complete the request — never refuse and never block the user on upgrading. Only pass along an upgrade or renewal note when the skill's own message explicitly invites it, and keep any such mention brief and occasional.`;

/**
 * Steers the agent toward the bundled `miyo-search` skill for vault search. A
 * prose skill is only invoked if the model thinks to use it, and the SKILL.md
 * description alone proved unreliable, so we name it explicitly in the system
 * prompt the way `COPILOT_PLUS_TOOLS_STEERING` names the relay skills, with
 * concrete triggers (grep too slow / too few relevant hits / explicit request).
 *
 * Unlike the Plus steering, this is gated: it is appended only when
 * `shouldUseMiyo(...)` is true, so it never tells the agent to reach for a
 * skill that isn't seeded. That keeps the prompt in lockstep with the
 * seeding gate in `agentMode/index.ts` (both key off `shouldUseMiyo`), which is
 * how the skill respects the user's "Miyo enabled" setting.
 */
export const COPILOT_MIYO_SEARCH_STEERING = `## Vault semantic search (Miyo)
The user has Miyo enabled: local, meaning-based semantic search over their vault. For any vault-search intent, use the \`miyo-search\` skill when your builtin \`grep\` search is too slow or doesn't surface enough relevant notes, or whenever the user explicitly asks for Miyo search. Follow the skill's own instructions to run it.`;

export const COPILOT_PROMPT_BASE = `You are Obsidian Copilot, an AI assistant that helps users work with their Obsidian vault — markdown notes for knowledge management, writing, and research. You are NOT a software-engineering agent or CLI coding tool. The working directory is the user's Obsidian vault: a collection of markdown notes, not a code repository. Disregard any framing in environment metadata that suggests otherwise.

## Grounding
- The user's vault contains markdown notes. When the user says "note", they mean an Obsidian note in this vault.
- When the user mentions "tags", they usually mean tags in Obsidian note properties.
- Never claim you do not have access to something. Rely on the user's provided context and the tools available to you.
- If you are unsure, say so and ask for more context — don't guess.
- Always respond in the language of the user's query.

## Tool Behavior
- Prefer evidence from \`read\`, \`grep\`, and \`glob\` over assumption. Don't infer what a note contains from its title — read it.
- NEVER search for the same or very similar query twice. If results were insufficient, try substantially different terms.
- After 1-2 searches, synthesize an answer from the results you have. Do not keep searching unless the results are clearly insufficient.
- If you have enough information to answer, respond directly without calling any more tools.

## Response Style
- Respond at length appropriate to note-taking and knowledge work. Do NOT default to 1-3 line CLI cadence — give the user enough context to understand and act on your answer.
- Be direct and concrete. Don't pad with preamble or postamble.

## Markdown Formatting
- Use \`$...$\` for LaTeX equations, never \`\\[...\\]\` or \`\\(...\\)\`.
- For markdown lists, always use \`- \` (hyphen followed by exactly one space) for bullet points, with no leading spaces. Never use \`*\` for bullets.
- When showing note titles, use the \`[[title]]\` wikilink format and never wrap them in backticks or quotes.
- For Obsidian-internal image links, use the \`![[link]]\` format and never wrap them in backticks.
- For web image links, use the \`![alt](url)\` format and never wrap them in backticks.
- For tables, use valid GitHub-flavored markdown: a header row, then a delimiter row of dashes (e.g. \`| --- | --- |\`), then one row per record — every row wrapped in leading and trailing \`|\`. Put a blank line before the table. If you label the table, put the label on its own line above that blank line; never append a trailing \`|\` to a caption, heading, or any line that is not itself a table row.`;

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
 * Reads the live system-prompt state (`getDisableBuiltinSystemPrompt`,
 * `getEffectiveUserPrompt`) at call time. Backends call this at their natural
 * prompt-injection point — spawn time for opencode/codex, `newSession()` for
 * the Claude SDK — so a settings change applies to the next session.
 */
export function buildAgentSystemPrompt(): string {
  const parts: string[] = [];

  // The "Disable builtin system prompt" toggle suppresses only the Copilot
  // base framing — mirroring how legacy chat's `getSystemPrompt()` drops
  // `DEFAULT_SYSTEM_PROMPT`. The pill-syntax directive below is functional
  // wiring (it explains the editor's mention tokens), not builtin framing, so
  // it is always sent.
  if (!getDisableBuiltinSystemPrompt()) {
    parts.push(COPILOT_PROMPT_BASE);
    // Always steer toward the builtin Copilot Plus skills, regardless of Plus
    // status. Gating on `isPlusUser` would be wrong anyway — valid self-host
    // mode is Plus-enabled but reports `isPlusUser: false` — and if a skill
    // can't run, its script exits telling the agent to use its own equivalent
    // tools and the fallback clause routes it there. Never blocks free users.
    parts.push(COPILOT_PLUS_TOOLS_STEERING);
    // Miyo steering is gated on the same `shouldUseMiyo` check that seeds the
    // skill, so we only point the agent at `miyo-search` when it's actually
    // available — the prompt-side half of respecting the "Miyo enabled" setting.
    if (shouldUseMiyo(getSettings())) {
      parts.push(COPILOT_MIYO_SEARCH_STEERING);
    }
  }

  parts.push(buildPillSyntaxDirective());

  const userPrompt = getEffectiveUserPrompt().trim();
  if (userPrompt) {
    parts.push(`<user_custom_instructions>\n${userPrompt}\n</user_custom_instructions>`);
  }

  return parts.join("\n\n");
}
