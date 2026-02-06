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
   * Compute the service discovery file path.
   *
   * @returns Absolute path to the Miyo service.json file.
   */
  private async getServiceFilePath(): Promise<string> {
    const osModule = await import("os");
    const pathModule = await import("path");
    return pathModule.join(
      osModule.homedir(),
      "Library",
      "Application Support",
      "Miyo",
      "service.json"
    );
  }

  /**
   * Read and parse the Miyo service discovery file.
   *
   * @returns Parsed service config or null if unavailable.
   */
  private async readServiceConfig(): Promise<MiyoServiceConfig | null> {
    const servicePath = await this.getServiceFilePath();
    try {
      const fsModule = await import("fs");
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
      if (getSettings().debug) {
        logWarn(`Miyo service discovery failed: ${err2String(error)}`);
      }
      return null;
    }
  }
}
