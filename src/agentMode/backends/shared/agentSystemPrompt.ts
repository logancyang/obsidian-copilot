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
import { getDisableBuiltinSystemPrompt } from "@/system-prompts/state";
import { getEffectiveUserPrompt } from "@/system-prompts/systemPromptBuilder";

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
- For markdown lists, always use \`- \` (hyphen followed by exactly one space) for bullet points. Never use \`*\` for bullets.
- For tables, use GitHub-flavored markdown.
- For Obsidian-internal image links, use \`![[link]]\` format. For web image links, use \`![alt](url)\` format.`;

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
  }

  parts.push(buildPillSyntaxDirective());

  const userPrompt = getEffectiveUserPrompt().trim();
  if (userPrompt) {
    parts.push(`<user_custom_instructions>\n${userPrompt}\n</user_custom_instructions>`);
  }

  return parts.join("\n\n");
}
