import { SemanticSearchToggleModal } from "@/components/modals/SemanticSearchToggleModal";
import { SettingItem } from "@/components/ui/setting-item";
import { updateSetting } from "@/settings/model";
import { App } from "obsidian";
import React from "react";

const DESCRIPTION =
  "The built-in embedding index that powers semantic search when you are not using Miyo. " +
  "Turning it off stops all indexing and falls back to keyword search; the index already on " +
  "disk is kept, but no longer read or updated.";

const MIYO_MANAGED_DESCRIPTION =
  "Miyo is handling semantic search, so the built-in index is not in use and has nothing to " +
  "index. Disconnect from the Miyo tab to return to keyword search.";

export interface LegacyVaultIndexSettingProps {
  /** Whether the built-in index is on, which is what makes vault indexing run. */
  enabled: boolean;
  /** Whether Miyo has taken over semantic search, leaving this index idle and not the user's to set. */
  miyoManaged: boolean;
  onToggle: (next: boolean) => void;
}

/**
 * Exposes the on/off control for the built-in vault index, the single gate every legacy
 * indexing path checks. Presentational only — confirming and applying the change belongs
 * to its host.
 */
export const LegacyVaultIndexSetting: React.FC<LegacyVaultIndexSettingProps> = ({
  enabled,
  miyoManaged,
  onToggle,
}) => (
  <SettingItem
    type="switch"
    title="Legacy vault index"
    description={miyoManaged ? MIYO_MANAGED_DESCRIPTION : DESCRIPTION}
    checked={enabled}
    disabled={miyoManaged}
    onCheckedChange={onToggle}
  />
);

/**
 * Confirm a change to the built-in vault index with the user, then apply it.
 *
 * @param app - Obsidian app the confirmation modal is opened against.
 * @param next - The state the user asked for: true to enable, false to disable.
 */
export function confirmLegacyVaultIndexToggle(app: App, next: boolean): void {
  // Writing the setting is the whole action: a run already in flight re-reads it between batches
  // and stops itself, reporting cancelled on the progress card.
  new SemanticSearchToggleModal(
    app,
    () => updateSetting("enableSemanticSearchV3", next),
    next
  ).open();
}
