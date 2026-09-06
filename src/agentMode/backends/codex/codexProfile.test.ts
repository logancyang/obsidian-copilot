import { CodexBackend } from "./CodexBackend";
import { codexAuth } from "./codexAuth";
import { getSettings, setSettings } from "@/settings/model";
import { signInWithCli } from "@/agentMode/backends/shared/cliSignIn";

jest.mock("./codexVersion", () => ({
  ...jest.requireActual("./codexVersion"),
  resolveSupportedCodexAcpEntry: (entry: string) => entry,
}));
jest.mock("@/agentMode/backends/shared/builtinSkillEnv", () => ({
  buildBuiltinSkillEnv: async () => ({}),
  sanitizeBuiltinSkillEnvOverrides: (env: Record<string, string>) => env,
}));
jest.mock("@/agentMode/backends/shared/cliSignIn", () => ({ signInWithCli: jest.fn() }));

describe("codexProfile", () => {
  describe("login and runtime invocation", () => {
    it.each([
      ["default", "file"],
      ["default", "keyring"],
      ["custom", "file"],
      ["custom", "keyring"],
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/380 keeps the %s profile and %s credential-store setting across user-owned npm and managed native invocations",
      async (profile, store) => {
        const original = getSettings().agentMode;
        const originalHome = process.env.CODEX_HOME;
        delete process.env.CODEX_HOME;
        const envOverrides: Record<string, string> = {
          CODEX_CONFIG: JSON.stringify({ cli_auth_credentials_store: store }),
        };
        if (profile === "custom") envOverrides.CODEX_HOME = "/fixture profile";
        try {
          for (const binaryPath of ["/npm/codex-acp/dist/index.js", "/managed/codex-acp"]) {
            setSettings((current) => ({
              agentMode: {
                ...current.agentMode,
                backends: {
                  ...current.agentMode.backends,
                  codex: {
                    binaryPath,
                    binarySource: binaryPath.endsWith(".js") ? "custom" : "managed",
                    envOverrides,
                  },
                },
              },
            }));
            let loginEnv: NodeJS.ProcessEnv | undefined;
            jest.mocked(signInWithCli).mockImplementationOnce((_command, _args, env) => {
              loginEnv = env;
              return { done: Promise.resolve({ loggedIn: true }), cancel: jest.fn() };
            });
            const runtime = await new CodexBackend().buildSpawnDescriptor({
              vaultBasePath: "/fixture vault",
            });
            await codexAuth.signIn(getSettings(), { onUrl: jest.fn() });
            expect(runtime.env.CODEX_HOME).toBe(
              profile === "custom" ? "/fixture profile" : undefined
            );
            expect(loginEnv?.CODEX_HOME).toBe(runtime.env.CODEX_HOME);
            expect(JSON.parse(runtime.env.CODEX_CONFIG!).cli_auth_credentials_store).toBe(store);
            expect(JSON.parse(loginEnv!.CODEX_CONFIG!).cli_auth_credentials_store).toBe(store);
          }
        } finally {
          setSettings({ agentMode: original });
          if (originalHome === undefined) delete process.env.CODEX_HOME;
          else process.env.CODEX_HOME = originalHome;
        }
      }
    );
  });
});
