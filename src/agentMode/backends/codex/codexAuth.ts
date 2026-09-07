import { codexBinaryManager } from "./CodexBinaryManager";
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

async function readStatus(call: Awaited<ReturnType<typeof invocation>>): Promise<boolean> {
  // Environment-authenticated sessions need no browser login or persisted credentials.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  if (call.env.CODEX_API_KEY?.trim() || call.env.OPENAI_API_KEY?.trim()) return true;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  let loggedIn = false;
  try {
    // The ACP proxy does not forward signals; status probes need the same tree cleanup as login.
    // Never expose the API key suffix printed by login status.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
    const result = await signInWithCli(
      call.command,
      [...call.args, "cli", "login", "status"],
      call.env,
      async () => ({ loggedIn }),
      {
        signal: controller.signal,
        onLine: (line) => {
          loggedIn ||= /^Logged in (?:using|with)\b/.test(line);
        },
      }
    ).done;
    return result.loggedIn;
  } finally {
    window.clearTimeout(timeout);
  }
}

/** Uses the same configured adapter and profile as Codex sessions, without reading credentials. */
export const codexAuth: BackendAuth = {
  getProbeKey(settings) {
    const config = settings.agentMode?.backends?.codex;
    const overrides = sanitizeBuiltinSkillEnvOverrides(config?.envOverrides);
    const os = requireNodeModule<typeof import("node:os")>("os");
    const path = requireNodeModule<typeof import("node:path")>("path");
    const env = {
      ...overrides,
      CODEX_HOME:
        overrides.CODEX_HOME ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
      CODEX_API_KEY: overrides.CODEX_API_KEY ?? process.env.CODEX_API_KEY,
      OPENAI_API_KEY: overrides.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY,
    };
    // Reinstalling a managed version changes its UUID path, not its account or login process.
    // Hash the environment so probe identities never expose credential values.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
    const selection = !config?.binaryPath
      ? null
      : config.binarySource === "managed"
        ? ["managed", config.binaryVersion]
        : config.binaryPath;
    return requireNodeModule<typeof import("node:crypto")>("crypto")
      .createHash("sha256")
      .update(
        JSON.stringify([selection, Object.entries(env).sort(([a], [b]) => a.localeCompare(b))])
      )
      .digest("hex");
  },
  async getStatus(settings) {
    let release: (() => void) | undefined;
    try {
      // Status checks also launch the bundled runtime and must hold its files until exit.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/380
      const binaryPath = settings.agentMode?.backends?.codex?.binaryPath;
      if (binaryPath) release = codexBinaryManager.reserveBinary(binaryPath);
      return { signedIn: await readStatus(await invocation(settings)) };
    } catch {
      return { signedIn: false };
    } finally {
      release?.();
    }
  },
  async signIn(settings, handlers) {
    // A pending browser login must keep its executable until cancellation or completion settles.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/380
    const binaryPath = settings.agentMode?.backends?.codex?.binaryPath;
    const release = binaryPath ? codexBinaryManager.reserveBinary(binaryPath) : undefined;
    let statusProbe: Promise<boolean> | undefined;
    try {
      const call = await invocation(settings);
      const result = await signInWithCli(
        call.command,
        [...call.args, "cli", "login"],
        call.env,
        // The login already holds its reservation; a concurrent reinstall must not block this final probe.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/380
        async () => ({ loggedIn: await (statusProbe = readStatus(call)) }),
        {
          ...handlers,
          // Codex prints its localhost callback server before the actual OpenAI authorization URL.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
          acceptUrl: (url) => url.startsWith("https://auth.openai.com/"),
        }
      ).done;
      return { signedIn: result.loggedIn };
    } finally {
      // Cancellation can finish login after its child exits while its status child still runs.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/380
      await statusProbe?.catch(() => undefined);
      release?.();
    }
  },
};
