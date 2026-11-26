import {
  signInWithCli,
  signOutWithCli,
  type CliSignInController,
  type SignInHandlers,
} from "@/agentMode/backends/shared/cliSignIn";
import { logWarn } from "@/logger";
import { err2String } from "@/utils";
import { requireNodeModule } from "@/utils/desktopRuntime";

const STATUS_TIMEOUT_MS = 10_000;

export interface CursorAuthStatus {
  loggedIn: boolean;
  label?: string;
}

interface CursorStatusJson {
  status?: unknown;
  isAuthenticated?: unknown;
  email?: unknown;
  userEmail?: unknown;
  account?: { email?: unknown } | null;
}

function hasCursorCredential(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.CURSOR_API_KEY?.trim() || env.CURSOR_AUTH_TOKEN?.trim());
}

function accountLabel(parsed: CursorStatusJson): string | undefined {
  if (typeof parsed.email === "string" && parsed.email.trim()) return parsed.email.trim();
  if (typeof parsed.userEmail === "string" && parsed.userEmail.trim())
    return parsed.userEmail.trim();
  const accountEmail = parsed.account?.email;
  return typeof accountEmail === "string" && accountEmail.trim() ? accountEmail.trim() : undefined;
}

export function parseCursorAuthStatus(stdout: string): CursorAuthStatus {
  const parsed = JSON.parse(stdout) as CursorStatusJson | null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Unable to verify Cursor authentication status.");
  }
  const signedIn =
    parsed.isAuthenticated === true ||
    (parsed.isAuthenticated !== false && parsed.status === "authenticated");
  if (!signedIn && parsed.isAuthenticated !== false && parsed.status !== "unauthenticated") {
    throw new Error("Unable to verify Cursor authentication status.");
  }
  if (!signedIn) return { loggedIn: false };
  const label = accountLabel(parsed);
  return label ? { loggedIn: true, label } : { loggedIn: true };
}

function isCursorLoginUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "cursor.com" &&
      /login/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

async function execStatus(binaryPath: string, env: NodeJS.ProcessEnv): Promise<string> {
  const { execFile } = requireNodeModule<typeof import("node:child_process")>("child_process");
  const { promisify } = requireNodeModule<typeof import("node:util")>("util");
  const execFileAsync = promisify(execFile);
  try {
    const { stdout } = await execFileAsync(binaryPath, ["status", "--format", "json"], {
      timeout: STATUS_TIMEOUT_MS,
      env,
    });
    return stdout;
  } catch (error) {
    const failed = error as { stdout?: unknown; killed?: boolean };
    if (failed.killed || typeof failed.stdout !== "string") throw error;
    return failed.stdout;
  }
}

export async function readCursorAuthStatus(
  binaryPath: string,
  env: NodeJS.ProcessEnv
): Promise<CursorAuthStatus> {
  if (hasCursorCredential(env)) return { loggedIn: true };
  return parseCursorAuthStatus(await execStatus(binaryPath, env));
}

export async function getCursorAuthStatus(
  binaryPath: string,
  env: NodeJS.ProcessEnv
): Promise<CursorAuthStatus> {
  try {
    return await readCursorAuthStatus(binaryPath, env);
  } catch (error) {
    logWarn("[AgentMode] Cursor account status unavailable", err2String(error));
    return { loggedIn: false };
  }
}

export function signInToCursor(
  binaryPath: string,
  env: NodeJS.ProcessEnv,
  handlers: SignInHandlers = {}
): CliSignInController {
  return signInWithCli(binaryPath, ["login"], env, () => getCursorAuthStatus(binaryPath, env), {
    ...handlers,
    acceptUrl: isCursorLoginUrl,
  });
}

export function signOutFromCursor(
  binaryPath: string,
  env: NodeJS.ProcessEnv,
  options?: { signal?: AbortSignal }
): Promise<CursorAuthStatus> {
  return signOutWithCli(
    binaryPath,
    ["logout"],
    env,
    () => readCursorAuthStatus(binaryPath, env),
    options
  );
}
