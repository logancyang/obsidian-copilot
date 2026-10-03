import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { requestUrl } from "obsidian";
import type CopilotPlugin from "@/main";
import type { CompanionBackendSettings } from "@/settings/model";
import {
  companionEnvironment,
  configureCompanion,
  detectCompanion,
  installCompanion,
  resolveCompanionAdapter,
  resolveCompanionNode,
  runCompanionCommand,
  signInCompanion,
  verifyCompanion,
} from "./companionRuntime";
import type { CompanionDefinition } from "./companionPolicy";
import { detectBinary, validateExecutableFile } from "@/utils/detectBinary";

const mockExec = jest.fn();
const mockUpdate = jest.fn();
const mockLogin = jest.fn();
let mockConfig: CompanionBackendSettings = {};
jest.mock("@/utils/desktopRuntime", () => ({
  requireNodeModule: (id: string) =>
    id === "child_process" ? { execFile: mockExec } : jest.requireActual(`node:${id}`),
}));
jest.mock("@/utils/detectBinary", () => ({
  detectBinary: jest.fn(),
  validateExecutableFile: jest.fn(),
}));
jest.mock("@/settings/model", () => ({
  getSettings: () => ({
    agentMode: { backends: { grok: mockConfig, muse: mockConfig, antigravity: mockConfig } },
  }),
  updateAgentModeBackendFields: (...args: unknown[]) => mockUpdate(...args),
}));
jest.mock("@/agentMode/backends/shared/cliSignIn", () => ({
  signInWithCli: (...args: unknown[]) => mockLogin(...args),
}));
jest.mock("obsidian", () => ({ requestUrl: jest.fn() }));
const definition: CompanionDefinition = {
  id: "grok",
  displayName: "Grok",
  binaryName: "grok",
  installerBaseUrl: "https://x.ai/cli/install",
  loginArgs: ["login"],
  skillsProjectDir: ".grok/skills",
};
const mockDownload = requestUrl as jest.Mock;
const mockDetect = detectBinary as jest.Mock;
const mockValidate = validateExecutableFile as jest.Mock;

describe("companionRuntime", () => {
  beforeEach(() => {
    mockConfig = {};
    mockUpdate.mockReset();
    mockExec.mockReset();
    mockDownload.mockReset();
    mockDetect.mockReset().mockResolvedValue("/fixture/grok");
    mockValidate.mockReset().mockResolvedValue(null);
    mockExec.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, out: string, err: string) => void
      ) => {
        callback(null, args[0] === "--version" ? "1.3.0" : "Installer output", "");
        return { stdout: new PassThrough(), stderr: new PassThrough() };
      }
    );
  });
  describe("resolveCompanionNode()", () => {
    it("selects a real Node executable rather than the Obsidian executable", async () => {
      mockDetect.mockResolvedValue("C:/Program Files/nodejs/node.exe");
      mockExec.mockImplementation((_command, _args, _options, callback) => {
        callback(null, "24.19.0", "");
        return {};
      });
      expect(await resolveCompanionNode({})).toBe("C:/Program Files/nodejs/node.exe");
      expect(mockDetect).toHaveBeenCalledWith("node");
    });
    it("rejects Obsidian and missing Node with installation guidance", async () => {
      mockDetect.mockResolvedValue("C:/Obsidian.exe");
      await expect(resolveCompanionNode({})).rejects.toThrow("Install Node.js");
      mockDetect.mockResolvedValue(null);
      await expect(resolveCompanionNode({})).rejects.toThrow("Install Node.js");
      expect(mockExec).not.toHaveBeenCalled();
    });
    it("validates an explicit runtime path and rejects an unsupported Node version", async () => {
      mockExec.mockImplementation((_command, _args, _options, callback) => {
        callback(null, "18.20.0", "");
        return {};
      });
      await expect(resolveCompanionNode({ COMPANION_NODE_PATH: "/runtime/node" })).rejects.toThrow(
        "Update Node.js"
      );
      expect(mockDetect).not.toHaveBeenCalled();
    });
  });
  describe("runCompanionCommand()", () => {
    it("returns CLI output without interpreting paths or arguments as a shell program", async () => {
      expect(await runCompanionCommand("/Agent With Spaces/grok", ["--version"], {})).toBe("1.3.0");
      expect(mockExec.mock.calls[0][0]).toBe("/Agent With Spaces/grok");
    });
    it("reports a nonzero exit with the CLI diagnostic", async () => {
      mockExec.mockImplementation(
        (
          _c: unknown,
          _a: unknown,
          _o: unknown,
          cb: (e: Error, out: string, err: string) => void
        ) => {
          cb(new Error("Exit 1"), "", "Network unavailable");
          return {};
        }
      );
      await expect(runCompanionCommand("/fixture/grok", [], {})).rejects.toThrow(
        "Network unavailable"
      );
    });
    it("streams installer output while the command is still running", async () => {
      const stdout = new PassThrough();
      let finish!: (e: Error | null, out: string, err: string) => void;
      mockExec.mockImplementation((_c: unknown, _a: unknown, _o: unknown, cb: typeof finish) => {
        finish = cb;
        return { stdout };
      });
      const output = jest.fn();
      const command = runCompanionCommand("/fixture/installer", [], {}, 1000, output);
      stdout.write("Downloading\n");
      expect(output).toHaveBeenCalledWith("Downloading\n");
      finish(null, "Installed", "");
      await expect(command).resolves.toBe("Installed");
    });
  });
  describe("companionEnvironment()", () => {
    it("keeps environment overrides local and applies the Muse credential backend default", () => {
      const previous = process.env.COPILOT_FIXTURE;
      expect(
        companionEnvironment("muse", { envOverrides: { COPILOT_FIXTURE: "local" } }).COPILOT_FIXTURE
      ).toBe("local");
      expect(process.env.COPILOT_FIXTURE).toBe(previous);
    });
    it("respects an explicitly selected credential backend", () => {
      expect(
        companionEnvironment("muse", { envOverrides: { TBH_CREDENTIAL_BACKEND: "fixture" } })
          .TBH_CREDENTIAL_BACKEND
      ).toBe("fixture");
    });
  });
  describe("detectCompanion()", () => {
    it("uses the detected executable", async () => {
      await expect(detectCompanion(definition)).resolves.toBe("/fixture/grok");
    });
  });
  describe("verifyCompanion()", () => {
    it("reads the actual CLI version", async () => {
      await expect(verifyCompanion(definition, "/fixture/grok")).resolves.toBe("1.3.0");
    });
    it("rejects a missing executable before running it", async () => {
      mockValidate.mockResolvedValue("Missing executable");
      await expect(verifyCompanion(definition, "/missing")).rejects.toThrow("Missing executable");
      expect(mockExec).not.toHaveBeenCalled();
    });
    it("rejects a recognizable but incompatible Grok build", async () => {
      mockExec.mockImplementation(
        (
          _c: unknown,
          _a: unknown,
          _o: unknown,
          cb: (e: null, out: string, err: string) => void
        ) => {
          cb(null, "0.2.60", "");
          return {};
        }
      );
      await expect(verifyCompanion(definition, "/fixture/grok")).rejects.toThrow("required");
    });
  });
  describe("configureCompanion()", () => {
    it("saves a verified manual path and version in the backend slice", async () => {
      await configureCompanion(definition, "C:\\Agents With Spaces\\grok.exe");
      expect(mockUpdate).toHaveBeenCalledWith("grok", {
        binaryPath: "C:\\Agents With Spaces\\grok.exe",
        binaryVersion: "1.3.0",
        binarySource: "custom",
      });
    });
  });
  describe("installCompanion()", () => {
    const plugin = () =>
      ({
        agentSessionManager: {
          restartBackend: jest.fn(
            async (
              _id: unknown,
              _reason: unknown,
              options: { maintenance: () => Promise<void> }
            ) => {
              await options.maintenance();
              return true;
            }
          ),
        },
      }) as unknown as CopilotPlugin;
    it("runs only the fixed official installer and verifies the resulting CLI", async () => {
      mockDownload.mockResolvedValue({ text: "installer fixture" });
      const p = plugin();
      await expect(installCompanion(p, definition)).resolves.toContain("Verified /fixture/grok");
      expect(mockDownload).toHaveBeenCalledWith({
        url: `https://x.ai/cli/install${process.platform === "win32" ? ".ps1" : ".sh"}`,
      });
    });
    it("reports download failure without running an installer", async () => {
      mockDownload.mockRejectedValue(new Error("Download failed"));
      await expect(installCompanion(plugin(), definition)).rejects.toThrow("Download failed");
      expect(mockExec).not.toHaveBeenCalled();
    });
    it("rejects a simultaneous install and allows retry after completion", async () => {
      let complete!: (value: { text: string }) => void;
      mockDownload.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          })
      );
      const first = installCompanion(plugin(), definition);
      await expect(installCompanion(plugin(), definition)).rejects.toThrow("already running");
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 5));
      complete({ text: "fixture" });
      await first;
      mockDownload.mockResolvedValue({ text: "fixture" });
      await expect(installCompanion(plugin(), definition)).resolves.toContain("Verified");
    });
  });
  describe("resolveCompanionAdapter()", () => {
    it("finds a packaged adapter in a plugin directory containing spaces", async () => {
      const dir = await mkdtemp(join(tmpdir(), "copilot packaged fixture "));
      try {
        await writeFile(join(dir, "companion-grok.cjs"), "fixture");
        await expect(resolveCompanionAdapter(dir, ".", "grok")).resolves.toBe(
          join(dir, "companion-grok.cjs")
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
    it("explains that the standard plugin package does not include a missing adapter", async () => {
      await expect(
        resolveCompanionAdapter(tmpdir(), "missing-copilot-plugin-fixture", "muse")
      ).rejects.toThrow("does not include it");
    });
  });
  describe("signInCompanion()", () => {
    it("runs the native login command without treating credential-file presence as verified authentication", async () => {
      mockConfig = { binaryPath: "/fixture/grok" };
      mockLogin.mockReturnValue({ done: Promise.resolve({ loggedIn: false }) });
      const onLine = jest.fn();
      await signInCompanion(definition, { onLine });
      expect(mockLogin.mock.calls[0][1]).toEqual(["login"]);
      expect(onLine).toHaveBeenCalledWith(
        expect.stringContaining("Authentication has not been verified")
      );
    });
  });
});
