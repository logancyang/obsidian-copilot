/**
 * Rotating opening lines for the Agent Home landing title. A frozen pool the UI
 * picks from at random each time the landing opens (see AgentHome) — no live LLM
 * call, matching how Claude/ChatGPT rotate their greetings from a curated set.
 * Keep entries short, friendly, and assistant-neutral (no name interpolation —
 * Obsidian doesn't expose one).
 */
export const LANDING_GREETINGS: readonly string[] = Object.freeze([
  "What can I help with?",
  "Where should we start?",
  "What's on your mind?",
  "What are you working on?",
  "How can I help today?",
  "Ready when you are.",
  "What would you like to explore?",
  "Let's pick up where you left off.",
  "What can I do for you?",
  "Got something to capture?",
  "What's next on your list?",
  "Where to begin?",
  "What shall we dig into?",
  "Ask me anything.",
]);

/** Pick a random greeting from the pool. The pool is guaranteed non-empty. */
export function pickRandomGreeting(): string {
  const index = Math.floor(Math.random() * LANDING_GREETINGS.length);
  return LANDING_GREETINGS[index];
}
