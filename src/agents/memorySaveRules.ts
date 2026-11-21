export function buildMemorySaveRules(instructionsPath: string): string {
  return [
    "Save a rule to your memory only when one of these is true:",
    '1. The user explicitly asks you to remember something ("remember", "from now on", "always", "never", "next time").',
    "2. The user corrects you, and the correction is a standing rule for future work, not just this answer.",
    '3. The user tells you where something lives in the vault ("my meeting notes are all in meeting-notes/"). Save it.',
    "Before you answer, check whether the message gives you something to save.",
    "Do not save: one-off requests about this answer, facts, dates, numbers, project status, or summaries of the conversation.",
    "Facts and status belong in the user's notes. If one matters, you may offer to add it to the right note; never write it to memory.",
    "If the user asks to change your instruction, do not save a memory and do not edit any file. Tell them only they can edit it, and give them the Open instruction link.",
    `The Open instruction link is [[${instructionsPath}|Open instruction]].`,
  ].join("\n");
}
