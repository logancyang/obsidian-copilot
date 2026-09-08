interface TerminalSignInCommandOptions {
  binaryPath: string | undefined;
  args: readonly string[];
  profileVariables: readonly string[];
  envOverrides: Record<string, string> | undefined;
  platform: NodeJS.Platform;
  runtime?: string;
}

/**
 * Formats terminal sign-in with explicit profile overrides, leaving ordinary
 * shell environment inheritance intact and excluding credential overrides.
 * @param options - Executable, login arguments, safe profile names, and target platform.
 */
export function terminalSignInCommand(options: TerminalSignInCommandOptions): string | null {
  const { binaryPath, args, profileVariables, envOverrides, platform, runtime } = options;
  // No executable is offered until an installation is configured.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  if (!binaryPath?.trim()) return null;
  const powershell = platform === "win32";
  // Ordinary CLI words stay readable; quote paths and values containing shell punctuation.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  const quote = (value: string) =>
    /^[A-Za-z0-9_./-]+$/.test(value)
      ? value
      : `'${value.replace(/'/g, powershell ? "''" : `'"'"'`)}'`;
  const command = [...(runtime ? [runtime, binaryPath] : [binaryPath]), ...args]
    .map(quote)
    .join(" ");
  // Only explicit profile overrides belong in clipboard text; API keys never do.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  const profile = ["HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", ...profileVariables].flatMap(
    (name) => {
      const value = envOverrides?.[name];
      return value === undefined
        ? []
        : [
            powershell
              ? `$env:${name} = '${value.replace(/'/g, "''")}'`
              : `${name}=${quote(value)}`,
          ];
    }
  );
  // PowerShell needs its call operator only when the executable itself is quoted.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  return [...profile, powershell && command.startsWith("'") ? `& ${command}` : command].join(
    powershell ? "; " : " "
  );
}
