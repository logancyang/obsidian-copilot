import { requestUrl } from "obsidian";
import type { ApprovedRuleStore } from "@/agentMode/session/types";
import { assertBinaryCompatible } from "@/agentMode/backends/shared/binaryCompatibility";
import type CopilotPlugin from "@/main";
import { getSettings } from "@/settings/model";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { agentShellPath } from "@/utils/loginShellPath";
import { getVaultBase } from "@/utils/vaultPath";
import { computeInstallState } from "./OpencodeBinaryManager";
import { OPENCODE_MIN_VERSION } from "./ui/opencodeVersion";

const SERVER_DEADLINE_MS = 30_000;
const STOP_GRACE_MS = 3_000;

type ChildProcess = import("node:child_process").ChildProcess;
type CallApi = (method: "GET" | "DELETE", path: string) => Promise<{ json: unknown }>;

interface SavedPermission {
  id: string;
  action: string;
  resource: string;
}

interface OpencodeLocation {
  project: { id: string; directory: string };
}

let previousCall: Promise<unknown> = Promise.resolve();

// A remove and a re-list each start their own server; running them in order keeps a list from
// reading the rules before a pending removal lands.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/867
function oneAtATime<T>(call: () => Promise<T>): Promise<T> {
  const result = previousCall.then(call);
  previousCall = result.catch(() => undefined);
  return result;
}

function firstStdoutLine(server: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    server.stdout?.on("data", (chunk: Uint8Array) => {
      stdout += Buffer.from(chunk).toString();
      const lineEnd = stdout.indexOf("\n");
      if (lineEnd >= 0) resolve(stdout.slice(0, lineEnd));
    });
    server.once("error", reject);
    server.once("exit", (code: number | null) =>
      reject(new Error(`OpenCode's server stopped before it was ready (exit code ${code}).`))
    );
  });
}

// A server that ignores SIGTERM must not outlive the call that started it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/867
async function stop(server: ChildProcess, exited: Promise<void>): Promise<void> {
  const forceStop = window.setTimeout(() => server.kill("SIGKILL"), STOP_GRACE_MS);
  server.kill("SIGTERM");
  await exited;
  window.clearTimeout(forceStop);
}

// `opencode acp` serves no HTTP API, so each call starts the same `serve --stdio` server
// `opencode acp` starts for itself, in the vault folder with the agent's environment, so it reads
// the same data and project. The server also exits when Obsidian goes away and closes its stdin.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/867
function withOpencodeServer<T>(
  plugin: CopilotPlugin,
  work: (callApi: CallApi) => Promise<T>
): Promise<T> {
  return oneAtATime(async () => {
    const opencode = getSettings().agentMode?.backends?.opencode;
    const install = computeInstallState(opencode);
    // Missing or pre-API OpenCode must read as "can't read", never as an empty list.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/867
    if (install.kind === "absent") throw new Error("OpenCode isn't installed.");
    assertBinaryCompatible(install, OPENCODE_MIN_VERSION, "OpenCode");

    const { spawn } = requireNodeModule<typeof import("node:child_process")>("child_process");
    const { randomBytes } = requireNodeModule<typeof import("node:crypto")>("crypto");
    const password = randomBytes(32).toString("base64url");
    const server = spawn(install.path, ["serve", "--stdio", "--port", "0"], {
      cwd: getVaultBase(plugin.app) ?? undefined,
      env: {
        ...process.env,
        PATH: await agentShellPath(),
        ...opencode?.envOverrides,
        OPENCODE_PASSWORD: password,
      },
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    const exited = new Promise<void>((resolve) => {
      server.once("exit", () => resolve());
      server.once("error", () => resolve());
    });
    // A hung server must not leave the page loading forever.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/867
    let deadline: number | undefined;
    try {
      return await Promise.race([
        firstStdoutLine(server).then((line) => {
          const { url } = JSON.parse(line) as { url: string };
          return work(async (method, path) => {
            const response = await requestUrl({
              url: `${url}${path}`,
              method,
              headers: {
                Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
              },
              throw: false,
            });
            if (response.status >= 300) {
              throw new Error(
                `OpenCode answered ${response.status} to ${method} ${path}. ${response.text}`.trim()
              );
            }
            return response;
          });
        }),
        new Promise<never>((_, reject) => {
          deadline = window.setTimeout(
            () =>
              reject(
                new Error(`OpenCode didn't answer within ${SERVER_DEADLINE_MS / 1000} seconds.`)
              ),
            SERVER_DEADLINE_MS
          );
        }),
      ]);
    } finally {
      window.clearTimeout(deadline);
      await stop(server, exited);
    }
  });
}

export const opencodeApprovedRules: ApprovedRuleStore = {
  list(plugin) {
    return withOpencodeServer(plugin, async (callApi) => {
      const { project } = (await callApi("GET", "/api/location")).json as OpencodeLocation;
      const saved = (
        await callApi("GET", `/api/permission/saved?projectID=${encodeURIComponent(project.id)}`)
      ).json as { data: SavedPermission[] };
      return saved.data.map((rule) => ({
        id: rule.id,
        allows: `${rule.action}: ${rule.resource}`,
        appliesTo: { kind: "folder", path: project.directory },
      }));
    });
  },

  remove(plugin, rule) {
    return withOpencodeServer(plugin, async (callApi) => {
      await callApi("DELETE", `/api/permission/saved/${encodeURIComponent(rule.id)}`);
    });
  },
};
