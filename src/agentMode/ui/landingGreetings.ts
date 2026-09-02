/**
 * Rotating opening lines for the Agent Home landing title. A frozen pool the UI
 * picks from at random each time the landing opens (see AgentHome) — no live LLM
 * call, matching how Claude/ChatGPT rotate their greetings from a curated set.
 * Keep entries short, friendly, and assistant-neutral (no name interpolation —
 * Obsidian doesn't expose one).
 */
import { t } from "@/i18n";

let greetingSource: string | undefined;
let landingGreetings: readonly string[] = Object.freeze([]);

/** Return the locale-specific greeting pool after the i18n runtime is initialized. */
export function getLandingGreetings(): readonly string[] {
  const source = t("agentChat.home.greetings");
  // A locale catalog can replace an English fallback after initialization, while unchanged
  // copy must keep one stable array reference for React callers.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/326
  if (source !== greetingSource) {
    greetingSource = source;
    landingGreetings = Object.freeze(source.split("|"));
  }
  return landingGreetings;
}

/** Pick a random greeting from the pool. The pool is guaranteed non-empty. */
export function pickRandomGreeting(): string {
  const greetings = getLandingGreetings();
  const index = Math.floor(Math.random() * greetings.length);
  return greetings[index];
}
