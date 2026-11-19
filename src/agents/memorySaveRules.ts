const MEMORY_HEADINGS = Object.freeze(["How to work", "Where to find things"] as const);

export const CONTRADICTS_INSTRUCTION_MARKER = "Contradicts instruction:";

export const REPLACES_MARKER = "Replaces";

export function buildMemorySaveRules(memoryFile: string, instructionsPath: string): string {
  return [
    "Save a rule to your memory only when one of these is true:",
    '1. The user explicitly asks you to remember something ("remember", "from now on", "always", "never", "next time").',
    "2. The user corrects you, and the correction is a standing rule for future work, not just this answer.",
    `3. The user tells you where something lives in the vault ("my meeting notes are all in meeting-notes/"). Save it under "${MEMORY_HEADINGS[1]}".`,
    "Do not save: one-off requests about this answer, facts, dates, numbers, project status, or summaries of the conversation.",
    "Facts and status belong in the user's notes. If one matters, you may offer to add it to the right note; never write it to memory.",
    'Write each rule as one plain sentence the user would agree with. Add one line of context: the date and why it came up. If it only holds until a date, start with "Until YYYY-MM-DD:".',
    "If the new rule replaces an existing one, replace that line. Never rewrite other lines.",
    "If the user asks to change your instruction, do not save a memory and do not edit any file. Tell them only they can edit it, and give them the Open instruction link.",
    "",
    `To save, edit ${memoryFile} yourself, without asking. It is your only memory: never save to CLAUDE.md, AGENTS.md or any other memory. The chat shows the user each save, so don't announce it in your reply.`,
    `If the file doesn't exist yet, create it with its two headings, "## ${MEMORY_HEADINGS[0]}" and "## ${MEMORY_HEADINGS[1]}". Rules about how to work go under "${MEMORY_HEADINGS[0]}".`,
    "Each rule is two lines, the rule and then its context line, with a blank line before the next rule:",
    "<the rule>",
    "<YYYY-MM-DD> · <why it came up>",
    `When the rule replaces one, its context line says so: <YYYY-MM-DD> · ${REPLACES_MARKER} "<the old rule>" (<the old rule's date>).`,
    `A rule that goes against your instruction is still saved when the user doesn't ask to change the instruction itself; end its context line with: · ${CONTRADICTS_INSTRUCTION_MARKER} "<that sentence of your instruction, word for word>".`,
    "In a read-only mode, such as Plan mode, save nothing and tell the user you can't save a rule in this mode. A read-only sandbox where edits wait for the user's approval is not such a mode: Copilot approves the save for you, so save as usual.",
    `The Open instruction link is [[${instructionsPath}|Open instruction]].`,
  ].join("\n");
}
