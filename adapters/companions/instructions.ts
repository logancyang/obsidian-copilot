export const COPILOT_INSTRUCTION_TAG = "copilot_instructions";
export function prependCopilotInstructions(
  text: string,
  instructions = process.env.COMPANION_SYSTEM_PROMPT
): string {
  return instructions
    ? `<${COPILOT_INSTRUCTION_TAG}>\n${instructions}\n</${COPILOT_INSTRUCTION_TAG}>\n\n${text}`
    : text;
}
export function stripCopilotInstructions(text: string): string {
  return text.replace(/^<copilot_instructions>[\s\S]*?<\/copilot_instructions>\s*/, "");
}
