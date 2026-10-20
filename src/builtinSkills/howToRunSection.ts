/**
 * OpenCode exposes a code-execution tool (`execute`) beside its shell tool, and a model handed
 * the bare command passes it there as code, which fails to parse.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/599
 */
export const SHELL_TOOL_SENTENCE = `Run it as a shell command with your shell command tool (for example
\`Bash\` in Claude Code, \`shell\` in OpenCode, \`exec_command\` in Codex). The command
is shell syntax, not JavaScript or TypeScript: never pass it as the code of a
code-execution tool.`;

export function howToRunSection(opts: {
  shFile: string;
  cmdFile: string;
  argPlaceholder: string;
  extraNote?: string;
}): string {
  const dir = "/absolute/path/to/this/skill/directory";
  return `## How to run

Find the absolute path to this SKILL.md file on disk, then run the script next
to it that matches the operating system. ${SHELL_TOOL_SENTENCE}
No extra runtime is needed — \`sh\` (macOS/Linux) and \`cmd\`/PowerShell (Windows)
are always present.

On macOS or Linux:

\`\`\`bash
sh "${dir}/${opts.shFile}" "${opts.argPlaceholder}"
\`\`\`

On Windows, run the \`.cmd\` wrapper. In PowerShell you must prefix it with the
call operator \`&\` (PowerShell treats a quoted path on its own as a string and
won't run it); from cmd, run the quoted path without the \`&\`:

\`\`\`powershell
& "${dir}/${opts.cmdFile}" "${opts.argPlaceholder}"
\`\`\`
${opts.extraNote ? `\n${opts.extraNote}\n` : ""}
Both print the result to stdout.`;
}
