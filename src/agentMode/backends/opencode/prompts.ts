/**
 * Copilot Agent Mode system prompts for opencode.
 *
 * Why this exists: opencode picks a provider-default system prompt by
 * substring-matching `model.api.id` (see `opencode/packages/opencode/src/
 * session/system.ts:19-33`). For Copilot Plus models — registered under
 * names like `copilot-plus-flash` — that match falls through every branch
 * to `default.txt`, opencode's terse CLI-coding-agent prompt. The
 * resulting "you are a CLI software engineering tool" framing is wrong
 * for an Obsidian vault assistant and degrades behavior badly on smaller
 * fast models like Gemini 2.5 Flash.
 *
 * The fix: inject our own prompt via `cfg.agent.<id>.prompt` at spawn
 * time so opencode's substring picker is bypassed regardless of model.
 *
 * Content is curated, not invented. Two existing Copilot prompts cover
 * most of what's needed:
 *
 *   - `DEFAULT_SYSTEM_PROMPT` (`src/constants.ts`) — the chat-mode
 *     identity and formatting rules. Most rules port directly; chat-only
 *     hooks (`@vault`, `getCurrentTime`, YouTube auto-transcribe) are
 *     dropped because that infrastructure does not exist in opencode.
 *   - `AGENT_LOOP_GUIDANCE` (`src/LLMProviders/chainRunner/
 *     AutonomousAgentChainRunner.ts`) — the in-process autonomous
 *     agent's loop bullets. Ported verbatim — the agent shape is the
 *     same.
 */

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
- When referring to an Obsidian note in your written reply, use \`[[title]]\` format (no backticks around it). To actually read or modify a note, call the \`read\` or \`edit\` tool — don't infer note contents from a wikilink title alone.
- For Obsidian-internal image links, use \`![[link]]\` format. For web image links, use \`![alt](url)\` format.`;

/**
 * Pick the Copilot system prompt for a given model.
 *
 * Today returns `COPILOT_PROMPT_BASE` for every model. The function exists
 * so per-provider variants — for prompt-style differences across model
 * families (Anthropic vs Gemini vs GPT, larger vs smaller) — can be added
 * by branching on `modelApiId`, mirroring opencode's own substring picker
 * at `session/system.ts:19-33` but with our own content.
 *
 * Limitation worth knowing for future per-provider work: opencode reads
 * `cfg.agent.<id>.prompt` at spawn time, so the chosen prompt is fixed
 * for the session lifetime. Per-model prompts that follow mid-session
 * model switches would require either spawn-time recycling or an
 * opencode `experimental.chat.system.transform` plugin. For v1 the
 * `modelApiId` argument carries the user's sticky default at spawn.
 */
export function selectCopilotPrompt(modelApiId: string | undefined): string {
  // Future per-provider branching goes here, e.g.:
  //   if (modelApiId?.includes("gemini")) return COPILOT_PROMPT_GEMINI;
  //   if (modelApiId?.includes("claude")) return COPILOT_PROMPT_ANTHROPIC;
  void modelApiId;
  return COPILOT_PROMPT_BASE;
}
