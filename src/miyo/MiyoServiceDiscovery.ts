import { logInfo, logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { err2String } from "@/utils";
import { Platform } from "obsidian";

/**
 * Service discovery payload for Miyo local service.
 */
export interface MiyoServiceConfig {
  host: string;
  port: number;
  pid: number;
}

type NodeRequire = (id: string) => any;
type ServiceConfigReadResult = MiyoServiceConfig | "missing" | null;

/**
 * Resolves the Miyo base URL using self-host settings or local service discovery.
 */
export class MiyoServiceDiscovery {
  private static instance: MiyoServiceDiscovery;
  private cachedBaseUrl: string | null = null;

  /**
   * Get the singleton instance.
   */
  public static getInstance(): MiyoServiceDiscovery {
    if (!MiyoServiceDiscovery.instance) {
      MiyoServiceDiscovery.instance = new MiyoServiceDiscovery();
    }
    return MiyoServiceDiscovery.instance;
  }

  /**
   * Resolve the Miyo base URL.
   *
   * @param options - Optional overrides and refresh behavior.
   * @param options.overrideUrl - Explicit base URL to use (highest priority).
   * @param options.forceRefresh - Whether to bypass cached results.
   * @returns The base URL (without trailing slash) or null if unavailable.
   */
  public async resolveBaseUrl(
    options: {
      overrideUrl?: string;
      forceRefresh?: boolean;
    } = {}
  ): Promise<string | null> {
    const overrideUrl = (options.overrideUrl || "").trim();
    if (overrideUrl.length > 0) {
      return this.normalizeBaseUrl(overrideUrl);
    }

    if (this.cachedBaseUrl && !options.forceRefresh) {
      return this.cachedBaseUrl;
    }

    if (!Platform.isDesktopApp) {
      return null;
    }

    const serviceConfig = await this.readServiceConfig();
    if (serviceConfig === "missing") {
      const fallbackBaseUrl = this.getDefaultBaseUrl();
      this.cachedBaseUrl = fallbackBaseUrl;
      if (getSettings().debug) {
        logInfo(`Miyo service discovery file missing; using fallback ${fallbackBaseUrl}`);
      }
      return fallbackBaseUrl;
    }
    if (!serviceConfig) {
      this.cachedBaseUrl = null;
      return null;
    }

    const baseUrl = this.normalizeBaseUrl(`http://${serviceConfig.host}:${serviceConfig.port}`);
    this.cachedBaseUrl = baseUrl;
    return baseUrl;
  }

  /**
   * Normalize a base URL by trimming whitespace and trailing slashes.
   *
   * @param url - Raw base URL.
   * @returns Normalized base URL.
   */
  private normalizeBaseUrl(url: string): string {
    return url.trim().replace(/\/+$/, "");
  }

  /**
   * Get the default local Miyo endpoint used when discovery file is missing.
   *
   * @returns Normalized localhost fallback URL.
   */
  private getDefaultBaseUrl(): string {
    return this.normalizeBaseUrl("http://127.0.0.1:8742");
  }

  /**
   * Compute service discovery file path candidates for the current platform.
   *
   * @returns Ordered absolute paths to candidate Miyo service.json files.
   */
  private getServiceFilePaths(): string[] {
    const nodeRequire = this.getNodeRequire();
    if (!nodeRequire) {
      return [];
    }
    const osModule = nodeRequire("os") as {
      homedir: () => string;
      platform: () => string;
    };
    const processModule = nodeRequire("process") as {
      env?: Record<string, string | undefined>;
    };
    const pathModule = nodeRequire("path") as { join: (...parts: string[]) => string };
    const homeDir = osModule.homedir();
    const platform = osModule.platform();
    const env = processModule.env || {};

    if (platform === "win32") {
      const localAppData = (env.LOCALAPPDATA || "").trim();
      const roamingAppData = (env.APPDATA || "").trim();
      const candidateDirs = [
        localAppData,
        pathModule.join(homeDir, "AppData", "Local"),
        roamingAppData,
        pathModule.join(homeDir, "AppData", "Roaming"),
      ].filter((dir, index, dirs) => dir.length > 0 && dirs.indexOf(dir) === index);
      return candidateDirs.map((dir) => pathModule.join(dir, "Miyo", "service.json"));
    }

    if (platform === "linux") {
      return [pathModule.join(homeDir, ".config", "Miyo", "service.json")];
    }

    if (platform === "darwin") {
      return [pathModule.join(homeDir, "Library", "Application Support", "Miyo", "service.json")];
    }

    logWarn(`Miyo service discovery unsupported platform: ${platform}`);
    return [];
  }

  /**
   * Read and parse the Miyo service discovery file.
   *
   * @returns Parsed service config, "missing" when file is absent, or null if unavailable.
   */
  private async readServiceConfig(): Promise<ServiceConfigReadResult> {
    const servicePaths = this.getServiceFilePaths();
    if (servicePaths.length === 0) {
      return null;
    }
    const nodeRequire = this.getNodeRequire();
    if (!nodeRequire) {
      return null;
    }
    const fsModule = nodeRequire("fs") as {
      promises: { readFile: (path: string, encoding: string) => Promise<string> };
    };
    let sawMissingFile = false;

    for (const servicePath of servicePaths) {
      try {
        const raw = await fsModule.promises.readFile(servicePath, "utf8");
        const parsed = JSON.parse(raw) as Partial<MiyoServiceConfig>;

        if (!parsed.host || typeof parsed.host !== "string") {
          logWarn("Miyo service discovery missing host");
          return null;
        }
        if (typeof parsed.port !== "number" || Number.isNaN(parsed.port)) {
          logWarn("Miyo service discovery missing port");
          return null;
        }

        if (getSettings().debug) {
          logInfo(`Miyo service discovery resolved host=${parsed.host} port=${parsed.port}`);
        }

        return parsed as MiyoServiceConfig;
      } catch (error) {
        if (this.isMissingFileError(error)) {
          sawMissingFile = true;
          continue;
        }
        if (getSettings().debug) {
          logWarn(`Miyo service discovery failed: ${err2String(error)}`);
        }
        return null;
      }
    }
    return sawMissingFile ? "missing" : null;
  }

  /**
   * Check if a read error indicates that service.json is missing.
   *
   * @param error - Unknown error thrown while reading the discovery file.
   * @returns True when the file does not exist.
   */
  private isMissingFileError(error: unknown): boolean {
    const maybeCode = (error as { code?: unknown } | undefined)?.code;
    return maybeCode === "ENOENT";
  }

  /**
   * Get Node-style require from the runtime (desktop-only).
   *
   * @returns Node require function or null when unavailable.
   */
  private getNodeRequire(): NodeRequire | null {
    const maybeRequire = (globalThis as { require?: NodeRequire } | undefined)?.require;
    if (typeof maybeRequire === "function") {
      return maybeRequire;
    }
    return null;
  }
}
