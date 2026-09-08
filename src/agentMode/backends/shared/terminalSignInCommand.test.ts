import { terminalSignInCommand } from "@/agentMode/backends/shared/terminalSignInCommand";
import { execFileSync } from "node:child_process";

describe("terminalSignInCommand", () => {
  describe("terminalSignInCommand()", () => {
    const profileVariable = "COPILOT_TEST_PROFILE";
    const windowsHome =
      "$env:HOME = '/app-home'; $env:USERPROFILE = $null; $env:HOMEDRIVE = $null; $env:HOMEPATH = $null; ";
    beforeEach(() => jest.replaceProperty(process, "env", { HOME: "/app-home" }));
    afterEach(() => jest.restoreAllMocks());

    it.each([undefined, "", "  "])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 omits a terminal command without a selected binary (%s)",
      (binaryPath) => {
        expect(
          terminalSignInCommand({
            binaryPath,
            args: ["login"],
            profileVariables: [],
            envOverrides: undefined,
            platform: "darwin",
          })
        ).toBeNull();
      }
    );
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 uses configured profiles before inherited values and never emits unlisted secrets", () => {
      process.env[profileVariable] = "/inherited";
      const options = {
        binaryPath: "/bin/agent",
        args: ["login"],
        profileVariables: [profileVariable],
        envOverrides: undefined,
        platform: "darwin" as const,
      };
      expect(terminalSignInCommand(options)).toBe(
        "env HOME='/app-home' COPILOT_TEST_PROFILE='/inherited' '/bin/agent' 'login'"
      );
      expect(
        terminalSignInCommand({
          ...options,
          envOverrides: { [profileVariable]: "/selected", API_KEY: "secret" },
        })
      ).toBe("env HOME='/app-home' COPILOT_TEST_PROFILE='/selected' '/bin/agent' 'login'");
      expect(terminalSignInCommand({ ...options, envOverrides: { [profileVariable]: "" } })).toBe(
        "env HOME='/app-home' COPILOT_TEST_PROFILE='' '/bin/agent' 'login'"
      );
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 quotes PowerShell paths and profile values literally", () => {
      expect(
        terminalSignInCommand({
          binaryPath: "C:\\Agent's files\\agent.exe",
          args: ["login"],
          profileVariables: [profileVariable],
          envOverrides: { [profileVariable]: "C:\\User's profile\\$(unsafe)`value" },
          platform: "win32",
        })
      ).toBe(
        windowsHome +
          "$env:COPILOT_TEST_PROFILE = 'C:\\User''s profile\\$(unsafe)`value'; & 'C:\\Agent''s files\\agent.exe' 'login'"
      );
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 runs an optional interpreter before the selected entry point", () => {
      expect(
        terminalSignInCommand({
          binaryPath: "C:\\path with spaces\\index.js",
          args: ["cli", "login"],
          profileVariables: [],
          envOverrides: undefined,
          platform: "win32",
          runtime: "node",
        })
      ).toBe(windowsHome + "& 'node' 'C:\\path with spaces\\index.js' 'cli' 'login'");
    });
    it.each([undefined, "/configured-home"])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 ignores conflicting terminal profiles and uses the app home override %s",
      (homeOverride) => {
        const command = terminalSignInCommand({
          binaryPath: process.execPath,
          args: [
            "-e",
            "process.stdout.write(JSON.stringify([process.env.HOME, process.env.COPILOT_TEST_PROFILE]))",
          ],
          profileVariables: [profileVariable],
          envOverrides: homeOverride === undefined ? undefined : { HOME: homeOverride },
          platform: "darwin",
        });
        const output = execFileSync("/bin/sh", ["-c", command!], {
          encoding: "utf8",
          env: { HOME: "/terminal-home", [profileVariable]: "/terminal-profile" },
        });
        expect(JSON.parse(output)).toEqual([homeOverride ?? "/app-home", null]);
      }
    );
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 clears absent PowerShell profiles and forwards Windows home overrides", () => {
      expect(
        terminalSignInCommand({
          binaryPath: "C:\\agent.exe",
          args: ["login"],
          profileVariables: [profileVariable],
          envOverrides: {
            HOME: "C:\\home",
            USERPROFILE: "C:\\profile",
            HOMEDRIVE: "D:",
            HOMEPATH: "\\account",
          },
          platform: "win32",
        })
      ).toBe(
        "$env:HOME = 'C:\\home'; $env:USERPROFILE = 'C:\\profile'; $env:HOMEDRIVE = 'D:'; $env:HOMEPATH = '\\account'; $env:COPILOT_TEST_PROFILE = $null; & 'C:\\agent.exe' 'login'"
      );
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 passes POSIX profile values and arguments without executing shell punctuation", () => {
      const literal = "space ' apostrophe $(printf injected) `printf injected` ; end";
      const command = terminalSignInCommand({
        binaryPath: process.execPath,
        args: [
          "-e",
          "process.stdout.write(JSON.stringify([process.env.COPILOT_TEST_PROFILE, process.argv[1]]))",
          literal,
        ],
        profileVariables: [profileVariable],
        envOverrides: { [profileVariable]: literal },
        platform: "darwin",
      });
      expect(JSON.parse(execFileSync("/bin/sh", ["-c", command!], { encoding: "utf8" }))).toEqual([
        literal,
        literal,
      ]);
    });
  });
});
