import { DEFAULT_COMPACTION_SETTINGS, shouldCompact } from "@earendil-works/pi-agent-core";
import type { PiUsage } from "@/pi/types";

/**
 * Whether the conversation has grown close enough to the model's limit that
 * the older part should be summarized before the next turn. Uses pi's own
 * thresholds so the trigger and the cut point agree — `AgentHarness.compact()`
 * always cuts with `DEFAULT_COMPACTION_SETTINGS`, and a stricter trigger here
 * would just compact more often than it needs to.
 *
 * @param usage the accounting from the turn that just finished
 */
export function shouldCompactNow(usage: PiUsage): boolean {
  if (usage.contextWindow <= 0 || usage.contextTokens <= 0) return false;
  return shouldCompact(usage.contextTokens, usage.contextWindow, DEFAULT_COMPACTION_SETTINGS);
}
