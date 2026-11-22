import { FileSystemAdapter, type App, type PluginManifest } from "obsidian";
import type { CopilotHost } from "@/host/platform/copilotHost";

interface FakeCopilotHostOptions {
  vaultBase?: string;
  configDir?: string;
  pluginId?: string;
  version?: string;
}

export function fakeCopilotHost({
  vaultBase = "/vault",
  configDir = "vault-config",
  pluginId = "copilot",
  version = "1.0.0",
}: FakeCopilotHostOptions = {}): CopilotHost {
  const adapter = new FileSystemAdapter();
  adapter.getBasePath = () => vaultBase;
  return {
    app: { vault: { adapter, configDir } } as unknown as App,
    manifest: { id: pluginId, version } as PluginManifest,
  };
}
