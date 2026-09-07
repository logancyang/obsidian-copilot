import type { BackendAuth } from "@/agentMode/session/types";
import { buildSimpleSpawnDescriptor } from "@/agentMode/backends/shared/simpleBinaryBackend";
import { sanitizeBuiltinSkillEnvOverrides } from "@/agentMode/backends/shared/builtinSkillEnv";
import { signInWithCli } from "@/agentMode/backends/shared/cliSignIn";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { detectBinary } from "@/utils/detectBinary";
import { buildCodexAcpInvocation, resolveSupportedCodexAcpEntry } from "./codexVersion";
import type { CopilotSettings } from "@/settings/model";

async function invocation(settings: CopilotSettings) {
  const config = settings.agentMode?.backends?.codex;
  const descriptor = buildSimpleSpawnDescriptor(
    config?.binaryPath,
    "Install Codex before signing in.",
    sanitizeBuiltinSkillEnvOverrides(config?.envOverrides)
  );
  const entry = resolveSupportedCodexAcpEntry(descriptor.command);
  // User-owned npm adapters still need Node on Windows; native bundles provide their runtime.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  const node =
    process.platform === "win32" && entry.endsWith(".js") ? await detectBinary("node") : undefined;
  return buildCodexAcpInvocation(entry, [], descriptor.env, process.platform, node ?? undefined);
}

/** Uses the same configured adapter and profile as Codex sessions, without reading credentials. */
export const codexAuth: BackendAuth = {
  async getStatus(settings) {
    try {
      const call = await invocation(settings);
      const { execFile } = requireNodeModule<typeof import("node:child_process")>("child_process");
      const { promisify } = requireNodeModule<typeof import("node:util")>("util");
      // Codex reports status on stderr and exits nonzero when signed out. Never display an API key suffix.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
      const { stdout, stderr } = await promisify(execFile)(
        call.command,
        [...call.args, "cli", "login", "status"],
        { env: call.env, windowsHide: true, timeout: 10_000 }
      );
      return { signedIn: /^Logged in (?:using|with)\b/m.test(`${stdout}\n${stderr}`) };
    } catch {
      return { signedIn: false };
    }
  },
  async signIn(settings, handlers) {
    const call = await invocation(settings);
    const result = await signInWithCli(
      call.command,
      [...call.args, "cli", "login"],
      call.env,
      async () => ({ loggedIn: (await codexAuth.getStatus(settings)).signedIn }),
      {
        ...handlers,
        // Codex prints its localhost callback server before the actual OpenAI authorization URL.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
        acceptUrl: (url) => url.startsWith("https://auth.openai.com/"),
      }
    ).done;
    return { signedIn: result.loggedIn };
  },
};
