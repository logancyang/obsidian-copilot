/** Teaches backends how to interpret the literal @-mention pill tokens (`[[title]]`, `{folder}`, `{activeNote}`) the chat editor emits. */
export function buildPillSyntaxDirective(): string {
  return (
    `The user composes messages in a rich editor that supports @-mentions of vault items.\n` +
    `Mentioned items appear inline in your input as the following literal tokens — treat\n` +
    `them as concrete references the user picked, NOT as template placeholders to substitute.\n` +
    `\n` +
    `- \`[[note_title]]\` — a specific note in the vault. To read or modify it, call \`read\`\n` +
    `  or \`edit\` with the resolved path; never infer a note's contents from its title alone.\n` +
    `  When you cite a note in your written reply, use the same \`[[title]]\` form (no backticks).\n` +
    `- \`{folder_name}\` — a vault folder the user wants you to focus on. To scope work to that\n` +
    `  folder, pass \`folder_name/**\` to \`glob\`, or include \`folder_name/\` as a path prefix\n` +
    `  when calling \`read\`, \`grep\`, or other path-aware tools.\n` +
    `- \`{activeNote}\` — the user's currently active note (reserved special token). Resolve it\n` +
    `  the same way as \`[[note_title]]\`.\n` +
    `\n` +
    `Any other \`{...}\` token in the user's message refers to a folder by that name, not a\n` +
    `placeholder to fill in.`
  );
}
