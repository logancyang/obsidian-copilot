import type { App } from "obsidian";
import type { AcpBackend } from "@/agentMode/acp/types";
import { getVaultBase, toVaultRelative } from "@/utils/vaultPath";

export function presentAntigravityToolTitle(
  app: App,
  call: Parameters<NonNullable<AcpBackend["presentToolTitle"]>>[0]
): string | undefined {
  const path = call.kind === "edit" ? call.locations?.[0]?.path : undefined;
  return path ? `Edit ${toVaultRelative(path, getVaultBase(app))}` : undefined;
}
