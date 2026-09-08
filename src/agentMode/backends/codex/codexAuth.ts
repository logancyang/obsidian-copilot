import type { BackendAuth, BackendAuthStatus } from "@/agentMode/session/types";
import { buildSimpleSpawnDescriptor } from "@/agentMode/backends/shared/simpleBinaryBackend";
import { sanitizeBuiltinSkillEnvOverrides } from "@/agentMode/backends/shared/builtinSkillEnv";
import { signInWithCli, signOutWithCli } from "@/agentMode/backends/shared/cliSignIn";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { detectBinary } from "@/utils/detectBinary";
import { buildCodexAcpInvocation, resolveSupportedCodexAcpEntry } from "./codexVersion";
import type { CopilotSettings } from "@/settings/model";

interface AccountReply {
  id?: unknown;
  result?: { account?: { type?: unknown; email?: unknown; planType?: unknown } | null };
  error?: unknown;
}

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

async function readCodexAuthStatus(settings: CopilotSettings) {
  const call = await invocation(settings);
  // Environment-authenticated sessions need no browser login or persisted credentials.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  if (call.env.CODEX_API_KEY?.trim() || call.env.OPENAI_API_KEY?.trim()) return { signedIn: true };
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  let status: BackendAuthStatus | undefined;
  let input: import("node:stream").Writable;
  try {
    // account/read exposes identity without opening credential files or returning tokens.
    // The shared CLI owner closes the whole adapter tree if the probe times out.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
    await signInWithCli(
      call.command,
      [...call.args, "cli", "app-server"],
      call.env,
      async () => ({ loggedIn: status?.signedIn === true }),
      {
        signal: controller.signal,
        onStdin: (stdin) => {
          input = stdin;
          input.write(
            JSON.stringify({
              id: 0,
              method: "initialize",
              params: { clientInfo: { name: "obsidian_copilot", version: "1.0.0" } },
            }) + "\n"
          );
        },
        onLine: (line) => {
          // App-server also emits diagnostics and notifications; only our replies select an account.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
          let reply: AccountReply | null;
          try {
            reply = JSON.parse(line);
          } catch {
            return;
          }
          if (!reply || typeof reply !== "object") return;
          if (reply.id === 0 && reply.result) {
            input.write(JSON.stringify({ method: "initialized" }) + "\n");
            input.write(
              JSON.stringify({ id: 1, method: "account/read", params: { refreshToken: false } }) +
                "\n"
            );
          } else if (reply.id === 1 && reply.result) {
            const account = reply.result.account;
            if (account === null) status = { signedIn: false };
            else if (account && typeof account.type === "string") {
              // Only ChatGPT accounts have an email. API-key accounts remain signed in without a label.
              // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
              const email =
                account.type === "chatgpt" && typeof account.email === "string"
                  ? account.email.trim()
                  : "";
              const plan = typeof account.planType === "string" ? account.planType.trim() : "";
              status = {
                signedIn: true,
                ...(email ? { label: plan ? `${email} (${plan})` : email } : {}),
              };
            }
            input.end();
          } else if ((reply.id === 0 || reply.id === 1) && reply.error) input.end();
        },
      }
    ).done;
    // Probe failures must not masquerade as successful logout.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
    if (!status || controller.signal.aborted)
      throw new Error("Unable to verify Codex authentication status.");
    return status;
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
    try {
      return await readCodexAuthStatus(settings);
    } catch {
      return { signedIn: false };
    }
  },
  async signOut(settings, options) {
    const call = await invocation(settings);
    const status = await signOutWithCli(
      call.command,
      [...call.args, "cli", "logout"],
      call.env,
      async () => {
        const status = await readCodexAuthStatus(settings);
        return { loggedIn: status.signedIn, label: status.label };
      },
      options
    );
    return { signedIn: status.loggedIn, ...(status.label ? { label: status.label } : {}) };
  },
  async signIn(settings, handlers) {
    const call = await invocation(settings);
    const result = await signInWithCli(
      call.command,
      [...call.args, "cli", "login"],
      call.env,
      async () => {
        const status = await codexAuth.getStatus(settings);
        return { loggedIn: status.signedIn, label: status.label };
      },
      {
        ...handlers,
        // Codex prints its localhost callback server before the actual OpenAI authorization URL.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
        acceptUrl: (url) => url.startsWith("https://auth.openai.com/"),
      }
    ).done;
    return { signedIn: result.loggedIn, ...(result.label ? { label: result.label } : {}) };
  },
};
