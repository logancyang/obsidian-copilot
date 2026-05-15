/**
 * Modal shown when the user clicks "Migrate to Keychain" in Advanced settings.
 *
 * Frames migration as a positive security upgrade (ShieldCheck header) while
 * still surfacing the multi-device trade-off in a structured card. The
 * confirm button is gated behind a checkbox so the implication is read, not
 * dismissed by muscle memory.
 *
 * Visual structure mirrors the original KeychainMigrationModal:
 * header icon + heading, plain description, structured card for the
 * multi-device note, and a muted tip line.
 *
 * This is intentionally a dedicated modal (not an extension of ConfirmModal)
 * because ConfirmModal exposes a positional constructor that does not handle
 * gated confirmation cleanly — see project pattern in NewChatConfirmModal /
 * ResetSettingsConfirmModal.
 *
 * TERMINOLOGY NOTE — "Obsidian Keychain" / "Obsidian's Keychain" is the
 * canonical user-facing term. Reasons:
 *   - Obsidian SecretStorage is vault-scoped and Obsidian-managed; calling it
 *     "OS Keychain" overpromises an OS-level guarantee the feature does not
 *     make.
 *   - It matches what users see in Obsidian's own UI.
 *   - "Secure Storage" was tried but is too generic and loses the Keychain
 *     mental model.
 * Do NOT change to "OS Keychain", "Secure Storage", or similar without
 * discussing the user-facing trade-offs first.
 */

import { Button } from "@/components/ui/button";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { Info, ShieldCheck, Smartphone } from "lucide-react";
import { App, Modal } from "obsidian";
import React, { useState } from "react";
import { Root } from "react-dom/client";

interface MigrateConfirmContentProps {
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Body of the migration confirmation modal. Renders the structured content
 * and gates the Migrate button behind a single acknowledgement checkbox.
 */
function MigrateConfirmContent({ onConfirm, onCancel }: MigrateConfirmContentProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <div className="tw-flex tw-items-center tw-gap-3 tw-text-normal">
        <ShieldCheck className="tw-size-6 tw-shrink-0 tw-text-success" />
        <h2 className="tw-m-0 tw-text-xl tw-font-bold">Migrate API Keys to Obsidian Keychain</h2>
      </div>

      <p className="tw-m-0 tw-text-muted">
        Move your API keys from <code className={"tw-text-muted tw-bg-muted/10"}>data.json</code> to
        this device&apos;s{" "}
        <code className={"tw-text-accent tw-bg-muted/10"}>Obsidian Keychain</code>.{" "}
        <code>data.json</code> will be stripped of API keys after migration.
      </p>

      {/* Reason: the multi-device implication is the most common source of
          confusion after migration — anchor it visually as a card with a
          phone icon so users can't miss it. */}
      <div className="tw-flex tw-items-start tw-gap-3 tw-rounded-md tw-border tw-border-border tw-bg-secondary tw-p-4">
        <Smartphone className="tw-mt-0.5 tw-size-5 tw-shrink-0 tw-text-accent" />
        <div className="tw-flex tw-flex-col tw-gap-1 tw-text-small">
          <div className="tw-font-semibold tw-text-normal">Using Copilot on multiple devices?</div>
          <div className="tw-text-muted">
            Each device has its own Obsidian Keychain. Other devices syncing this vault will need to
            re-enter their API keys after migration.
          </div>
        </div>
      </div>

      <div className="tw-flex tw-items-start tw-gap-2 tw-px-1 tw-text-small tw-text-muted">
        <Info className="tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-accent" />
        <span>Tip: keep an offline backup of your API keys.</span>
      </div>

      {/* Reason: gating the confirm button forces the user to read the warning
         rather than dismissing it by muscle memory. */}
      <label className="tw-flex tw-cursor-pointer tw-items-center tw-gap-2">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          aria-label="I understand keys may need to be re-entered on other devices"
        />
        <span>I understand keys may need to be re-entered on other devices</span>
      </label>

      <div className="tw-flex tw-justify-end tw-gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="default"
          onClick={onConfirm}
          disabled={!acknowledged}
          className="tw-gap-1.5"
        >
          <ShieldCheck className="tw-size-4" />
          Migrate
        </Button>
      </div>
    </div>
  );
}

/**
 * Obsidian Modal wrapping the migration confirmation UI. Resolves with
 * `true` when the user confirms after acknowledging the warning, or
 * `false` on cancel / close.
 *
 * Reason: setTitle is intentionally omitted — the body's ShieldCheck heading
 * serves as the title, matching the original KeychainMigrationModal layout
 * and avoiding visual duplication.
 */
export class MigrateConfirmModal extends Modal {
  private root: Root | null = null;
  private confirmed = false;

  constructor(
    app: App,
    private onConfirm: () => void,
    private onCancel?: () => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createPluginRoot(contentEl, this.app);

    const handleConfirm = () => {
      this.confirmed = true;
      this.onConfirm();
      this.close();
    };

    const handleCancel = () => {
      this.close();
    };

    this.root.render(<MigrateConfirmContent onConfirm={handleConfirm} onCancel={handleCancel} />);
  }

  onClose() {
    if (!this.confirmed) {
      this.onCancel?.();
    }
    this.root?.unmount();
    this.root = null;
  }
}
