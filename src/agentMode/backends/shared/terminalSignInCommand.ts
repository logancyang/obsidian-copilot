interface TerminalSignInCommandOptions {
  binaryPath: string | undefined;
  args: readonly string[];
  profileVariables: readonly string[];
  envOverrides: Record<string, string> | undefined;
  platform: NodeJS.Platform;
  runtime?: string;
}

export function terminalSignInCommand(options: TerminalSignInCommandOptions): string | null {
  const { binaryPath, args, profileVariables, envOverrides, platform, runtime } = options;
  if (!binaryPath?.trim()) return null;
  const powershell = platform === "win32";
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
  return [...profile, powershell && command.startsWith("'") ? `& ${command}` : command].join(
    powershell ? "; " : " "
  );
}
