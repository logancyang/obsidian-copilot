import { setAgentHomeReleaseUpdatePrototype } from "@/components/release-update/agentHomeReleaseUpdatePrototypeStore";
import type { Plugin } from "obsidian";

/** Registers the selected release UI for deterministic development screenshots. */
export function registerReleaseUpdatePrototypeCommandsForDevelopment(plugin: Plugin): void {
  // Keep the unfinished notification lifecycle out of production builds.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/317
  if (!plugin.manifest.version.includes("+dev.")) {
    return;
  }

  plugin.addCommand({
    id: "prototype-agent-home-release-update-bottom-banner",
    name: "Prototype Agent Home release update: Bottom banner",
    callback: () => setAgentHomeReleaseUpdatePrototype(true),
  });
  plugin.register(() => setAgentHomeReleaseUpdatePrototype(false));
}
