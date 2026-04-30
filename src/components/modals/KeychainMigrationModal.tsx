/**
 * Modal shown after plugin upgrade to inform the user that API keys
 * have been migrated to the OS Keychain, and let them choose when to
 * clear the old data.json secrets.
 *
 * Three UI states:
 * - "main"    — initial choice: Keep for now / Remove now
 * - "keep"    — confirms 7-day auto-clear, user clicks OK or goes Back
 * - "remove"  — confirms removal, user clicks Remove or goes Back
 *
 * X button and ESC are intercepted — the user must use a button.
 */

import { Button } from "@/components/ui/button";
import {
  canClearDiskSecrets,
  clearDiskSecrets,
  refreshDiskHasSecrets,
  refreshLastPersistedSettings,
  runPersistenceTransaction,
  suppressNextPersistOnce,
} from "@/services/settingsPersistence";
import { KeychainService } from "@/services/keychainService";
import { type CopilotSettings, getSettings, setSettings } from "@/settings/model";
import { logError } from "@/logger";
import { App, Modal, Notice } from "obsidian";
import React, { useEffect, useRef, useState } from "react";
import { createRoot, Root } from "react-dom/client";
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  Info,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ModalStep = "main" | "keep" | "remove";

interface KeychainMigrationContentProps {
  onKeepConfirmed: () => void;
  onRemoveConfirmed: () => void;
  /** When true, clearing old disk copies is not currently safe. */
  clearDisabled: boolean;
}

// ---------------------------------------------------------------------------
// Shared header (shown in all states)
// ---------------------------------------------------------------------------

function ModalHeader() {
  return (
    <div className="tw-flex tw-items-center tw-gap-3 tw-text-normal">
      <ShieldCheck className="tw-size-6 tw-text-success" />
      <h2 className="tw-m-0 tw-text-xl tw-font-bold">API Keys Migrated to OS Keychain</h2>
    </div>
  );
}

// ---------------------------------------------------------------------------
// State-specific content
// ---------------------------------------------------------------------------

function MainContent({
  onKeep,
  onRemove,
  clearDisabled,
}: {
  onKeep: () => void;
  onRemove: () => void;
  clearDisabled: boolean;
}) {
  return (
    <>
      <div className="tw-text-small tw-text-muted">
        Your API keys are safely migrated to the OS Keychain. You can remove the old copies from{" "}
        <code className="tw-bg-muted/10">data.json</code> now, or keep them temporarily if you use
        multiple devices.
      </div>

      <div className="tw-flex tw-items-start tw-gap-3 tw-rounded-md tw-border tw-border-border tw-bg-secondary tw-p-4">
        <Smartphone className="tw-mt-0.5 tw-size-5 tw-shrink-0 tw-text-accent" />
        <div className="tw-text-small">
          <div className="tw-mb-1 tw-font-semibold tw-text-normal">
            Using Copilot on multiple devices?
          </div>
          <div className="tw-text-muted">
            Keep the old copies until all devices have been updated and opened at least once. They
            will be auto-removed after 7 days.
          </div>
        </div>
      </div>

      {clearDisabled && (
        <div className="tw-flex tw-items-start tw-gap-2 tw-rounded-md tw-border tw-border-border tw-bg-error tw-p-3 tw-text-smallest tw-text-warning">
          <AlertTriangle className="tw-mt-0.5 tw-size-4 tw-shrink-0" />
          <span>
            Removing old copies is disabled until Copilot confirms the current keys are safely
            stored in the OS Keychain.
          </span>
        </div>
      )}

      <div className="tw-flex tw-items-start tw-gap-2 tw-px-1 tw-text-small tw-text-muted">
        <Info className="tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-accent" />
        <span className="tw-leading-relaxed">
          On a new device, re-enter your API keys in the Copilot settings.
        </span>
      </div>

      <div className="tw-mt-2 tw-flex tw-justify-end tw-gap-3">
        <Button variant="secondary" size="sm" onClick={onKeep} className="tw-gap-1.5">
          <Clock className="tw-size-4" />
          Keep for now
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={onRemove}
          disabled={clearDisabled}
          className="tw-gap-1.5"
          title={clearDisabled ? "Removing old copies is not safe yet" : undefined}
        >
          <Trash2 className="tw-size-4" />
          Remove now
        </Button>
      </div>
    </>
  );
}

function KeepConfirmContent({ onBack, onOk }: { onBack: () => void; onOk: () => void }) {
  return (
    <>
      <div className="tw-flex tw-items-start tw-gap-3 tw-rounded-md tw-border tw-border-border tw-bg-secondary tw-p-4">
        <Clock className="tw-mt-0.5 tw-size-5 tw-shrink-0 tw-text-accent" />
        <div className="tw-flex tw-flex-col tw-gap-2 tw-text-small tw-text-muted">
          <div>
            Old copies in data.json will be auto-removed after{" "}
            <strong className="tw-font-semibold tw-text-normal">7 days</strong>.
          </div>
          <div className="tw-leading-relaxed">
            You can also clear them anytime from{" "}
            <strong className="tw-font-medium tw-text-normal">
              Settings &rarr; Advanced &rarr; API Key Storage
            </strong>
            .
          </div>
        </div>
      </div>

      <div className="tw-mt-auto tw-flex tw-justify-end tw-gap-3">
        <Button variant="secondary" size="sm" onClick={onBack} className="tw-gap-1.5">
          <ArrowLeft className="tw-size-4" />
          Back
        </Button>
        <Button variant="default" size="sm" onClick={onOk}>
          OK
        </Button>
      </div>
    </>
  );
}

function RemoveConfirmContent({ onBack, onRemove }: { onBack: () => void; onRemove: () => void }) {
  return (
    <>
      <div className="tw-flex tw-items-start tw-gap-3 tw-rounded-md tw-border tw-border-border tw-bg-secondary tw-p-4">
        <AlertTriangle className="tw-mt-0.5 tw-size-5 tw-shrink-0 tw-text-warning" />
        <div className="tw-text-small tw-text-muted">
          Old API key copies will be{" "}
          <strong className="tw-font-semibold tw-text-normal">removed from data.json</strong>. Your
          keys{" "}
          <strong className="tw-font-semibold tw-text-success">
            remain safe in the OS Keychain
          </strong>
          .
        </div>
      </div>

      <div className="tw-mt-auto tw-flex tw-justify-end tw-gap-3">
        <Button variant="secondary" size="sm" onClick={onBack} className="tw-gap-1.5">
          <ArrowLeft className="tw-size-4" />
          Back
        </Button>
        <Button variant="default" size="sm" onClick={onRemove} className="tw-gap-1.5">
          <Trash2 className="tw-size-4" />
          Remove
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Root React component with step state
// ---------------------------------------------------------------------------

function KeychainMigrationContent({
  onKeepConfirmed,
  onRemoveConfirmed,
  clearDisabled,
}: KeychainMigrationContentProps) {
  const [step, setStep] = useState<ModalStep>("main");
  const containerRef = useRef<HTMLDivElement>(null);
  const [minHeight, setMinHeight] = useState<number | undefined>();

  // Reason: capture the main-state height so the modal doesn't shrink
  // when switching to the shorter confirmation states.
  useEffect(() => {
    if (containerRef.current && !minHeight) {
      setMinHeight(containerRef.current.offsetHeight);
    }
  }, [minHeight]);

  return (
    <div ref={containerRef} className="tw-flex tw-flex-col tw-gap-5 tw-p-2" style={{ minHeight }}>
      <ModalHeader />

      {step === "main" && (
        <MainContent
          onKeep={() => setStep("keep")}
          onRemove={() => setStep("remove")}
          clearDisabled={clearDisabled}
        />
      )}

      {step === "keep" && (
        <KeepConfirmContent onBack={() => setStep("main")} onOk={onKeepConfirmed} />
      )}

      {step === "remove" && (
        <RemoveConfirmContent onBack={() => setStep("main")} onRemove={onRemoveConfirmed} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal shell
// ---------------------------------------------------------------------------

export class KeychainMigrationModal extends Modal {
  private root?: Root;
  private readonly saveDataFn: (data: CopilotSettings) => Promise<void>;
  private readonly loadDataFn: () => Promise<unknown>;
  /** When true, the modal is allowed to close (user clicked a button). */
  private canClose = false;

  constructor(
    app: App,
    saveData: (data: CopilotSettings) => Promise<void>,
    loadData: () => Promise<unknown>
  ) {
    super(app);
    this.saveDataFn = saveData;
    this.loadDataFn = loadData;
  }

  /**
   * Intercept X button and ESC key.
   * Reason: the user must explicitly choose "Keep for now" or "Remove now".
   * Dismissing via X/ESC would leave them in an ambiguous state.
   */
  close(): void {
    if (!this.canClose) {
      new Notice("Please choose to keep or remove the old API key copies.");
      return;
    }
    super.close();
  }

  /** Allow closing and invoke super.close(). Called by button handlers only. */
  private dismissModal(): void {
    this.canClose = true;
    this.close();
  }

  onOpen(): void {
    this.root = createRoot(this.contentEl);
    this.root.render(
      <KeychainMigrationContent
        onKeepConfirmed={() => this.handleKeepKeys()}
        onRemoveConfirmed={() => this.handleClearKeys()}
        clearDisabled={!canClearDiskSecrets(getSettings())}
      />
    );
  }

  onClose(): void {
    this.root?.unmount();
    this.root = undefined;
  }

  /**
   * User chose "Keep for now" → "OK". Record dismissal flag so the modal
   * is not shown again, and let the 7-day auto-clear handle cleanup.
   *
   * Reason: uses a dedicated persistence transaction that reads the latest
   * raw disk data on demand and patches only the dismissal flag, instead of
   * going through the normal setSettings→persist path. This avoids
   * round-tripping all hydrated secrets through doPersist.
   */
  private async handleKeepKeys(): Promise<void> {
    try {
      await runPersistenceTransaction(async () => {
        // Reason: read raw disk data inside the serialized transaction so
        // encrypted disk values are preserved as-is (no secret round-trip).
        const rawDiskData = ((await this.loadDataFn()) ?? {}) as Record<string, unknown>;
        // Reason: only start the 7-day auto-clear timer when the keychain is
        // in a safe state (all secrets backed up, no failures). Starting the
        // timer during an unsafe state would cause premature auto-clear once
        // the issue is resolved and the old timestamp is still in effect.
        //
        // Design decision: if keychain save failed, we intentionally do NOT
        // set _keychainMigratedAt. Starting a countdown when secrets may
        // only exist on disk risks permanent data loss if auto-clear fires
        // before the keychain issue is resolved. The timer will be set later
        // by loadSettingsWithKeychain() on the next successful backfill.
        const safeToStartTimer = canClearDiskSecrets(getSettings());
        const diskData = {
          ...rawDiskData,
          _migrationModalDismissed: true,
          _keychainVaultId:
            rawDiskData._keychainVaultId ?? KeychainService.getInstance().getVaultId(),
        } as Record<string, unknown>;
        // Preserve existing timestamp; only set a new one if safe to do so.
        if (typeof rawDiskData._keychainMigratedAt === "string") {
          diskData._keychainMigratedAt = rawDiskData._keychainMigratedAt;
        } else if (safeToStartTimer) {
          diskData._keychainMigratedAt = new Date().toISOString();
        }
        await this.saveDataFn(diskData as unknown as CopilotSettings);
        refreshDiskHasSecrets(diskData as unknown as CopilotSettings);
        const nextSettings = {
          ...getSettings(),
          _migrationModalDismissed: true,
          _keychainMigratedAt: diskData._keychainMigratedAt,
        } as CopilotSettings;
        refreshLastPersistedSettings(nextSettings);
        // Sync in-memory so shouldShowMigrationModal returns false.
        suppressNextPersistOnce();
        setSettings(nextSettings);
      });
      this.dismissModal();
    } catch (error) {
      logError("Failed to record migration modal dismissal.", error);
      new Notice("Failed to save your choice. Please try again.");
    }
  }

  /**
   * User confirmed removal — strip secrets from data.json.
   *
   * Runs inside `runPersistenceTransaction` to prevent interleaving with
   * queued normal saves that could restore old secrets.
   */
  private async handleClearKeys(): Promise<void> {
    try {
      await clearDiskSecrets((data) => this.saveDataFn(data));
      new Notice("Old copies removed from data.json.");
      this.dismissModal();
    } catch (error) {
      logError("Failed to clear disk secrets.", error);
      new Notice("Failed to remove old copies. Please try again.");
    }
  }
}
