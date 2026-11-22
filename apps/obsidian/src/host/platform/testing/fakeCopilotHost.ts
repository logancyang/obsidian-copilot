import { FileSystemAdapter, type App, type PluginManifest } from "obsidian";
import type { CopilotHost } from "@/host/platform/copilotHost";

interface FakeCopilotHostOptions {
  vaultBase?: string;
  configDir?: string;
  pluginId?: string;
}

export function fakeCopilotHost({
  vaultBase = "/vault",
  configDir = "vault-config",
  pluginId = "copilot",
}: FakeCopilotHostOptions = {}): CopilotHost {
  const adapter = new FileSystemAdapter();
  adapter.getBasePath = () => vaultBase;
  return {
    app: { vault: { adapter, configDir } } as unknown as App,
    manifest: { id: pluginId, version: "1.0.0" } as PluginManifest,
    register: () => undefined,
  };
}
