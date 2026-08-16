// Codex emits these internal budget notices as answer chunks even though they are not user responses.
// Immediate chat fix: https://github.com/logancyang/obsidian-copilot-preview/issues/315
// Proper skill-selection fix: https://github.com/logancyang/obsidian-copilot-preview/issues/318
const SKILLS_BUDGET_WARNING_PATTERNS = [
  /^Warning: Skill descriptions were shortened to fit the \d+% skills context budget\. Codex can still see every skill, but some descriptions are shorter\. Disable unused skills or plugins to leave more room for the rest\.$/,
  /^Warning: Skill descriptions were shortened to fit the skills context budget\. Codex can still see every skill, but some descriptions are shorter\.$/,
];

export function shouldRouteCodexAgentMessageText(text: string): boolean {
  return !SKILLS_BUDGET_WARNING_PATTERNS.some((pattern) => pattern.test(text.trim()));
}
