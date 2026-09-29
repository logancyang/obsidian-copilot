const PROJECT_CONTEXT_UPDATES_BLOCK = [
  "<project_context_updates>",
  "Project sources may have changed; re-check the declared project context before answering.",
  "</project_context_updates>",
].join("\n");

export function buildProjectContextUpdatesBlock(): string {
  return PROJECT_CONTEXT_UPDATES_BLOCK;
}
