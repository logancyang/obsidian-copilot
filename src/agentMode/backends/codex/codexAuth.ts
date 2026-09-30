import type { BackendAuth, BackendAuthStatus } from "@/agentMode/session/types";
import { buildSimpleSpawnDescriptor } from "@/agentMode/backends/shared/simpleBinaryBackend";
import { sanitizeBuiltinSkillEnvOverrides } from "@/agentMode/backends/shared/builtinSkillEnv";
import { signInWithCli, signOutWithCli } from "@/agentMode/backends/shared/cliSignIn";
import { logWarn } from "@/logger";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { detectBinary } from "@/utils/detectBinary";
import { buildCodexAcpInvocation, resolveSupportedCodexAcpEntry } from "./codexVersion";
import type { CopilotSettings } from "@/settings/model";

interface AuthOperation {
  binaryPath: string | undefined;
  controller: AbortController;
  done: Promise<BackendAuthStatus>;
}

const activeOperations = new Set<AuthOperation>();

// Track pending auth so removal can cancel it. https://github.com/Brevilabs/obsidian-copilot-private/issues/620
function runOwnedAuth(
  settings: CopilotSettings,
  run: (signal: AbortSignal) => Promise<BackendAuthStatus>,
  parentSignal?: AbortSignal
): Promise<BackendAuthStatus> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener("abort", abort, { once: true });
  const operation: AuthOperation = {
    binaryPath: settings.agentMode?.backends?.codex?.binaryPath,
    controller,
    done: run(controller.signal),
  };
  activeOperations.add(operation);
  return operation.done.finally(() => {
    activeOperations.delete(operation);
    parentSignal?.removeEventListener("abort", abort);
  });
}

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
  const node =
    process.platform === "win32" && entry.endsWith(".js") ? await detectBinary("node") : undefined;
  return buildCodexAcpInvocation(entry, [], descriptor.env, process.platform, node ?? undefined);
}

async function readCodexAuthStatus(settings: CopilotSettings, signal?: AbortSignal) {
  const call = await invocation(settings);
  if (call.env.CODEX_API_KEY?.trim() || call.env.OPENAI_API_KEY?.trim()) return { signedIn: true };
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = window.setTimeout(abort, 10_000);
  let status: BackendAuthStatus | undefined;
  let lastReply = "none";
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
          let reply: AccountReply | null;
          try {
            reply = JSON.parse(line);
          } catch {
            return;
          }
          if (!reply || typeof reply !== "object") return;
          if (reply.id === 0 && reply.result) {
            lastReply = "initialize";
            input.write(JSON.stringify({ method: "initialized" }) + "\n");
            input.write(
              JSON.stringify({ id: 1, method: "account/read", params: { refreshToken: false } }) +
                "\n"
            );
          } else if (reply.id === 1 && reply.result) {
            lastReply = "account/read";
            const account = reply.result.account;
            if (account === null) status = { signedIn: false };
            else if (account && typeof account.type === "string") {
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
          } else if ((reply.id === 0 || reply.id === 1) && reply.error) {
            lastReply = reply.id === 0 ? "initialize error" : "account/read error";
            input.end();
          }
        },
      }
    ).done;
    if (!status || controller.signal.aborted) {
      logWarn("[AgentMode] Codex account probe incomplete", {
        lastReply,
        timedOut: controller.signal.aborted,
      });
      throw new Error("Unable to verify Codex authentication status.");
    }
    return status;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export const codexAuth: BackendAuth = {
  // Removal also awaits auth owners. https://github.com/Brevilabs/obsidian-copilot-private/issues/620
  async stop(binaryPath) {
    const matching = [...activeOperations].filter(({ binaryPath: path }) => path === binaryPath);
    for (const operation of matching) operation.controller.abort();
    let timer: number | undefined;
    try {
      await Promise.race([
        Promise.allSettled(matching.map((operation) => operation.done)),
        new Promise<never>((_, reject) => {
          timer = window.setTimeout(() => reject(new Error("Codex probe did not stop.")), 10_000);
        }),
      ]);
    } finally {
      window.clearTimeout(timer);
    }
  },
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
  getStatus(settings) {
    return runOwnedAuth(settings, async (signal) => {
      try {
        return await readCodexAuthStatus(settings, signal);
      } catch {
        logWarn("[AgentMode] Codex account status unavailable");
        return { signedIn: false };
      }
    });
  },
  signOut(settings, options) {
    return runOwnedAuth(
      settings,
      async (signal) => {
        const call = await invocation(settings);
        const status = await signOutWithCli(
          call.command,
          [...call.args, "cli", "logout"],
          call.env,
          async () => {
            const status = await readCodexAuthStatus(settings, signal);
            return { loggedIn: status.signedIn, label: status.label };
          },
          { signal }
        );
        return { signedIn: status.loggedIn, ...(status.label ? { label: status.label } : {}) };
      },
      options?.signal
    );
  },
  signIn(settings, handlers) {
    return runOwnedAuth(
      settings,
      async (signal) => {
        const call = await invocation(settings);
        const result = await signInWithCli(
          call.command,
          [...call.args, "cli", "login"],
          call.env,
          async () => {
            const status = await readCodexAuthStatus(settings, signal);
            return { loggedIn: status.signedIn, label: status.label };
          },
          {
            ...handlers,
            signal,
            // Codex prints its localhost callback server before the actual OpenAI authorization URL.
            // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
            acceptUrl: (url) => url.startsWith("https://auth.openai.com/"),
          }
        ).done;
        if (!result.loggedIn && !signal.aborted)
          logWarn("[AgentMode] Codex browser sign-in ended without a verified account");
        return { signedIn: result.loggedIn, ...(result.label ? { label: result.label } : {}) };
      },
      handlers?.signal
    );
  },
};
