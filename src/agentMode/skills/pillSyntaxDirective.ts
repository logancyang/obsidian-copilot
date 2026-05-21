/**
 * Build the spawn-time directive that teaches every backend how to interpret
 * the @-mention pill tokens that appear in user messages. Copilot's chat
 * editor lets the user @-mention vault items inline; when the editor
 * extracts text for the LLM, each pill serializes to a literal token
 * (`[[title]]`, `{folder}`, `{activeNote}`). Without this directive the
 * agent has no way to know these are concrete vault references rather than
 * template placeholders to substitute.
 *
 * Composed into whatever existing system-prompt / instructions surface
 * each backend supports at spawn time, alongside `buildSkillCreationDirective`.
 * Pure leaf module — no Obsidian imports, no singletons, no arguments —
 * suitable for unit testing.
 *
 * The token shapes mirror the pill serializers:
 *   - `NotePillNode.getTextContent()` → `[[title]]`
 *   - `FolderPillNode.getTextContent()` → `{folderPath}`
 *   - Reserved `{activeNote}` template (handled in `parseTextForPills`)
 *
 * Folder mentions are framed as a natural-language hint rather than a
 * tool-level filter because today's search tools (`localSearch`,
 * `semanticSearch`, etc.) do not accept a `folder`/`path` parameter — the
 * agent must apply the scope itself via `glob`/`grep`/`read` path prefixes.
 */
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
