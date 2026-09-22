/**
 * Runtime stand-in for the `obsidian` npm package.
 *
 * The published package is types-only: importing it in Node yields nothing at
 * runtime. Production Agent Mode code imports it for real behaviour
 * (`FileSystemAdapter`, `Platform`, `normalizePath`), so the suite's esbuild
 * bundle aliases `obsidian` to this file. Every export here is listed in
 * `runtime-tests/README.md` with what it substitutes.
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

/** UI toast. Nothing renders in the suite, so construction is the whole behaviour. */
export class Notice {
  constructor(public readonly message: string | DocumentFragment) {}
  setMessage(): this {
    return this;
  }
  hide(): void {}
}

/**
 * Real filesystem access rooted at a directory, backing `app.vault.adapter`.
 *
 * `AcpBackendProcess.start` and `VaultClient.resolveVaultRelative` both do
 * `adapter instanceof FileSystemAdapter`, so this must be a class whose
 * instances the production code accepts — and the agent's file tools read and
 * write through it, so it must touch the real disk.
 */
export class FileSystemAdapter {
  constructor(private readonly basePath: string) {}

  getBasePath(): string {
    return this.basePath;
  }

  private full(relativePath: string): string {
    return nodePath.join(this.basePath, relativePath);
  }

  async read(relativePath: string): Promise<string> {
    return nodeFs.promises.readFile(this.full(relativePath), "utf-8");
  }

  async write(relativePath: string, data: string): Promise<void> {
    await nodeFs.promises.writeFile(this.full(relativePath), data, "utf-8");
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await nodeFs.promises.access(this.full(relativePath));
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(relativePath: string): Promise<void> {
    await nodeFs.promises.mkdir(this.full(relativePath), { recursive: true });
  }
}

/**
 * Obsidian's HTTP helper. The suite allows no remote calls, so this fails
 * loudly instead of reaching the network — an unexpected request shows up as a
 * scenario failure naming the URL rather than as a silent egress.
 */
export function requestUrl(options: { url: string } | string): never {
  const url = typeof options === "string" ? options : options.url;
  throw new Error(`[runtime-tests] blocked network request to ${url}`);
}

/** Base classes the imported production modules only ever subclass. */
export class Component {
  onload(): void {}
  onunload(): void {}
  load(): void {}
  unload(): void {}
  register(): void {}
  registerEvent(): void {}
  registerDomEvent(): void {}
  addChild<T>(child: T): T {
    return child;
  }
}
export class Modal extends Component {
  constructor(public readonly app: unknown) {
    super();
  }
  open(): void {}
  close(): void {}
}
export class PluginSettingTab extends Component {}
export class ItemView extends Component {}
export class Plugin extends Component {}
export class TFile {}
export class TFolder {}
export class TAbstractFile {}
export class Vault {}
export class Setting {}
export class MarkdownRenderer {}
