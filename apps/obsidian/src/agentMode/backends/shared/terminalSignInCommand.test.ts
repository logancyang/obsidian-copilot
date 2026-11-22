import { terminalSignInCommand } from "@/agentMode/backends/shared/terminalSignInCommand";
import { execFileSync } from "node:child_process";

describe("terminalSignInCommand", () => {
  describe("terminalSignInCommand()", () => {
    const options = {
      binaryPath: "codex-acp",
      args: ["cli", "login"],
      profileVariables: ["CODEX_HOME"],
      envOverrides: undefined,
      platform: "darwin" as NodeJS.Platform,
    };
    it.each(["darwin", "win32"] as const)(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 keeps ordinary commands readable on %s without copying the app environment",
      (platform) => {
        jest.replaceProperty(process, "env", { CODEX_HOME: "/app-profile", HOME: "/app-home" });
        try {
          expect(terminalSignInCommand({ ...options, platform })).toBe("codex-acp cli login");
        } finally {
          jest.restoreAllMocks();
        }
      }
    );
    it.each([undefined, "", "  "])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 omits a command without a configured binary (%s)",
      (binaryPath) => expect(terminalSignInCommand({ ...options, binaryPath })).toBeNull()
    );
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 includes only explicit safe profile overrides", () => {
      expect(
        terminalSignInCommand({
          ...options,
          envOverrides: {
            CODEX_HOME: "/my profile",
            HOME: "/custom-home",
            OPENAI_API_KEY: "secret",
          },
        })
      ).toBe("HOME=/custom-home CODEX_HOME='/my profile' codex-acp cli login");
      expect(terminalSignInCommand({ ...options, envOverrides: { CODEX_HOME: "" } })).toBe(
        "CODEX_HOME='' codex-acp cli login"
      );
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 quotes PowerShell paths and profile values without interpreting punctuation", () => {
      expect(
        terminalSignInCommand({
          ...options,
          binaryPath: "C:\\Agent's files\\agent.exe",
          platform: "win32",
          envOverrides: { CODEX_HOME: "C:\\User's profile\\$(unsafe)`value" },
        })
      ).toBe(
        "$env:CODEX_HOME = 'C:\\User''s profile\\$(unsafe)`value'; & 'C:\\Agent''s files\\agent.exe' cli login"
      );
      expect(
        terminalSignInCommand({
          ...options,
          binaryPath: "C:\\adapter\\index.js",
          platform: "win32",
          runtime: "node",
        })
      ).toBe("node 'C:\\adapter\\index.js' cli login");
    });
    it("https://github.com/logancyang/obsidian-copilot/issues/2967 preserves literal arguments and explicit profiles in the native terminal", () => {
      const literal = "space ' apostrophe $(printf injected) `printf injected` ; end";
      const command = terminalSignInCommand({
        ...options,
        binaryPath: process.execPath,
        platform: process.platform,
        args: [
          "-e",
          "process.stdout.write(JSON.stringify([process.env.CODEX_HOME, process.env.HOME, process.argv[1]]))",
          literal,
        ],
        envOverrides: { CODEX_HOME: literal },
      });
      expect(
        JSON.parse(
          execFileSync(
            process.platform === "win32" ? "pwsh.exe" : "/bin/sh",
            process.platform === "win32" ? ["-NoProfile", "-Command", command!] : ["-c", command!],
            {
              encoding: "utf8",
              env: { ...process.env, HOME: "/terminal-home" },
            }
          )
        )
      ).toEqual([literal, "/terminal-home", literal]);
    });
  });
});
