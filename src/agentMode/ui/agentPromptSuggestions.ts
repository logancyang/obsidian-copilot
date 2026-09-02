/**
 * Sample prompts the Agent Mode composer types out on an empty landing, one at
 * a time, to show what the agent can actually do with a vault (see
 * `PromptSuggestionPlaceholder`). A frozen pool, like `LANDING_GREETINGS` — no
 * live LLM call.
 *
 * Keep entries short enough to read at sidebar width (~65 characters),
 * self-contained (no `<topic>` fill-in-the-blank), plain text (they're inserted
 * verbatim when accepted), and free of any assumption about how a vault is
 * organized — every one has to make sense in a stranger's notes.
 */
export const AGENT_PROMPT_SUGGESTIONS: readonly string[] = Object.freeze([
  "Summarize what I worked on this week",
  "Turn my meeting notes into a task list with links",
  "Find notes that say contradictory things and show me",
  "Draft a note that connects my recent reading",
  "Rename my untitled notes based on what's in them",
  "Pull every open question out of my notes",
  "Find near-duplicate notes and suggest which to merge",
  "Rewrite the current note as a step-by-step guide",
  "Build an index note linking everything on one theme",
  "Clean up the headings and formatting across my notes",
  "Tell me what my notes are missing on a topic I care about",
  "Read this note and give me three sharper questions",
]);
