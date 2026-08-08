/**
 * Builds the coarse "project sources may have changed" note injected into an
 * ongoing or resumed project session when the tracker has observed a content
 * change the session hasn't seen yet.
 *
 * This is deliberately a single fixed, source-agnostic nudge — NOT a per-path
 * or per-source delta. The agent re-checks the project's declared scope itself;
 * exact per-path / binary deltas are a separate feature. Keeping it a pure
 * function (no params) makes the exact wording unit-testable and keeps the
 * manager decoupled from prompt phrasing.
 */
const PROJECT_CONTEXT_UPDATES_BLOCK = [
  "<project_context_updates>",
  "Project sources may have changed; re-check the declared project context before answering.",
  "</project_context_updates>",
].join("\n");

export function buildProjectContextUpdatesBlock(): string {
  return PROJECT_CONTEXT_UPDATES_BLOCK;
}
