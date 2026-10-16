/**
 * Runtime stand-in for the `obsidian` npm package.
 *
 * The published package is types-only: importing it in Node yields nothing at
 * runtime. Production Agent Mode code imports it for real behaviour
 * (`FileSystemAdapter`, `Platform`, `normalizePath`, `requestUrl`), so the
 * suite's esbuild bundle aliases `obsidian` to this file. Every export here is
 * listed in `runtime-tests/README.md` with what it substitutes.
 */

import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

/** Obsidian collapses `\` to `/` and strips leading/trailing slashes. */
export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

/**
 * Desktop-runtime flags. `requireNodeModule` refuses to load Node built-ins
 * unless both are set this way, and Agent Mode is desktop-only.
 */
export const Platform = {
  isDesktopApp: true,
  isMobile: false,
  isMobileApp: false,
  isDesktop: true,
  isMacOS: process.platform === "darwin",
  isWin: process.platform === "win32",
  isLinux: process.platform === "linux",
};

/**
 * The vault adapter, rooted at a real directory. Agent Mode checks
 * `adapter instanceof FileSystemAdapter` before it resolves the vault path, so
 * this must be a class; the members are the ones the session layer calls.
 */
export class FileSystemAdapter {
  constructor(private readonly basePath: string) {}

  getBasePath(): string {
    return this.basePath;
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await nodeFs.promises.access(nodePath.join(this.basePath, relativePath));
      return true;
    } catch {
      return false;
    }
  }
}

interface RequestUrlParam {
  url: string;
  method?: string;
  headers?: Record<string, string>;
}

interface RequestUrlResponse {
  status: number;
  json: unknown;
}

type RequestUrlHandler = (request: RequestUrlParam) => Promise<RequestUrlResponse>;

let requestUrlHandler: RequestUrlHandler | null = null;

/**
 * Let one process opt in to real HTTP through `requestUrl`. Only the binary
 * fetcher does, so the production installer can read GitHub release metadata;
 * the scenario process never calls this.
 */
export function allowRequestUrl(handler: RequestUrlHandler): void {
  requestUrlHandler = handler;
}

/**
 * Obsidian's HTTP helper. Scenarios allow no remote calls from Copilot code,
 * so unless {@link allowRequestUrl} was called this fails loudly instead of
 * reaching the network — an unexpected request becomes a scenario failure
 * naming the URL rather than a silent egress.
 */
export async function requestUrl(options: RequestUrlParam | string): Promise<RequestUrlResponse> {
  const request = typeof options === "string" ? { url: options } : options;
  if (!requestUrlHandler) {
    throw new Error(`[runtime-tests] blocked network request to ${request.url}`);
  }
  return requestUrlHandler(request);
}
