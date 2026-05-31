/**
 * v6 migration: validate legacy global agent binary paths against the current
 * device before they get adopted into this device's profile (GitHub #2539).
 *
 * Before v6, agent binary paths were a single global value in `data.json`.
 * After a sync, that value may be another device's path. On the first run after
 * upgrade we clear any flat path that does not resolve on this device, so it is
 * not adopted into this device's profile (and the UI does not falsely report it
 * as configured). Paths that do resolve are left in place — the next save's
 * `dehydrateDeviceProfile` moves them into `deviceProfiles[deviceId]`.
 *
 * Desktop-only: agent binaries and `node:fs` only exist on desktop. On mobile
 * (or if fs is unavailable) we skip validation; there is nothing to spawn there.
 */

import { Platform } from "obsidian";

import { logInfo } from "@/logger";
import { getSettings, setSettings } from "@/settings/model";

export async function migrateLegacyAgentPathsToDeviceProfile(): Promise<void> {
  if (!Platform.isDesktopApp) return;

  const agentMode = getSettings().agentMode;
  if (!agentMode) return;

  const claudeCliPath = agentMode.claudeCli?.path;
  const codexPath = agentMode.backends?.codex?.binaryPath;
  const opencodePath = agentMode.backends?.opencode?.binaryPath;
  if (!claudeCliPath && !codexPath && !opencodePath) return;

  let pathExists: (p: string) => boolean;
  try {
    ({ pathExists } = await import("./deviceProfilesPathCheck"));
  } catch {
    // fs unavailable — leave flat fields as-is; dehydrate adopts them verbatim.
    return;
  }

  const dropClaude = !!claudeCliPath && !pathExists(claudeCliPath);
  const dropCodex = !!codexPath && !pathExists(codexPath);
  const dropOpencode = !!opencodePath && !pathExists(opencodePath);
  if (!dropClaude && !dropCodex && !dropOpencode) return;

  setSettings((cur) => {
    const cam = cur.agentMode;
    const backends = { ...cam.backends };
    if (dropCodex && backends.codex) {
      backends.codex = { ...backends.codex, binaryPath: undefined };
    }
    if (dropOpencode && backends.opencode) {
      backends.opencode = {
        ...backends.opencode,
        binaryPath: undefined,
        binaryVersion: undefined,
        binarySource: undefined,
      };
    }
    return {
      agentMode: {
        ...cam,
        backends,
        ...(dropClaude ? { claudeCli: undefined } : {}),
      },
    };
  });

  logInfo(
    "[settings-migration] cleared agent binary path(s) that do not resolve on this device " +
      "(pre-v6 global paths from a synced device)"
  );
}
