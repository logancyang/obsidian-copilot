import { CopilotSettings } from "@/settings/model";
import { Platform } from "obsidian";

export function getMiyoConnectionMode(settings: CopilotSettings): "local" | "remote" {
  // A legacy explicit URL must keep targeting that server, including loopback.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/466
  return (
    settings.miyoConnectionMode ?? ((settings.miyoServerUrl || "").trim() ? "remote" : "local")
  );
}

export function getMiyoCustomUrl(settings: CopilotSettings): string {
  return getMiyoConnectionMode(settings) === "local" ? "" : (settings.miyoServerUrl || "").trim();
}

export function shouldUseMiyo(settings: CopilotSettings): boolean {
  if (
    !settings.enableMiyo ||
    (getMiyoConnectionMode(settings) === "remote" && !getMiyoCustomUrl(settings))
  ) {
    return false;
  }
  return !Platform.isMobile || !!getMiyoCustomUrl(settings);
}
