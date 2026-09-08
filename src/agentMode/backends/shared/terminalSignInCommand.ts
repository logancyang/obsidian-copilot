interface TerminalSignInCommandOptions {
  binaryPath: string | undefined;
  args: readonly string[];
  profileVariables: readonly string[];
  envOverrides: Record<string, string> | undefined;
  platform: NodeJS.Platform;
  runtime?: string;
}

/**
 * Formats a copyable sign-in command using only the selected executable and safe
 * profile variables. Secret environment overrides must never enter clipboard text.
 * @param options - Executable, login arguments, profile allowlist, and target shell platform.
 */
export function terminalSignInCommand(options: TerminalSignInCommandOptions): string | null {
  const { binaryPath, args, profileVariables, envOverrides, platform, runtime } = options;
  // A generic PATH command could sign into a different installation from the configured agent.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  if (!binaryPath?.trim()) return null;
  const powershell = platform === "win32";
  const quote = (value: string) => `'${value.replace(/'/g, powershell ? "''" : `'"'"'`)}'`;
  const executable = runtime ? [runtime, binaryPath] : [binaryPath];
  const command = [...executable, ...args].map(quote).join(" ");
  // Only backend-owned profile names are emitted; arbitrary overrides may contain API keys.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  const homeVariables = powershell ? ["HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH"] : ["HOME"];
  const profile = [...homeVariables, ...profileVariables].map((name) => ({
    name,
    value: envOverrides?.[name] ?? process.env[name],
  }));
  // PowerShell requires its call operator for quoted executable paths, and single quotes
  // keep path punctuation and profile contents from being interpreted as shell code.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  if (powershell) {
    return [
      ...profile.map(
        ({ name, value }) => `$env:${name} = ${value === undefined ? "$null" : quote(value)}`
      ),
      `& ${command}`,
    ].join("; ");
  }
  // A pasted command must not inherit a terminal-only profile that the backend never used.
  // env -u removes absent variables for this invocation without changing the terminal session.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  return [
    "env",
    ...profile.flatMap(({ name, value }) => (value === undefined ? ["-u", name] : [])),
    ...profile.flatMap(({ name, value }) =>
      value === undefined ? [] : [`${name}=${quote(value)}`]
    ),
    command,
  ].join(" ");
}
