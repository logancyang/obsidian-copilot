import React, { useState, useEffect, useRef } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Download,
  Key,
  Shield,
} from "lucide-react";
import { Notice } from "obsidian";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { logError } from "@/logger";
import { SetupUriDecryptionError } from "@/setupUri/crypto";
import { applySetupUri, extractPayloadFromUri } from "@/setupUri/setupUri";
import type { SetupUriMeta } from "@/setupUri/setupUri";
import { StepIndicator } from "@/components/setup-uri/StepIndicator";
import type { CopilotSettings } from "@/settings/model";

const IMPORT_STEPS = [{ label: "Paste Config" }, { label: "Password" }, { label: "Confirm" }];

interface ImportStepperContentProps {
  /** Pre-filled payload from protocol handler. When set, textarea is readonly. */
  prefillPayload?: string;
  /** Persist imported settings to disk. Called with the settings returned by applySetupUri. */
  onPersistSettings: (settings: CopilotSettings) => Promise<void>;
  /** Reload the Copilot plugin to apply imported settings. */
  onReloadPlugin: () => Promise<void>;
  /** Show a reminder about vault files not included in Setup URI. */
  onNotifyManualCopy: (folders: {
    customPromptsFolder?: string;
    userSystemPromptsFolder?: string;
    memoryFolderName?: string;
  }) => void;
  /** Close the parent modal. */
  onClose: () => void;
}

/**
 * 3-step import flow rendered inside an Obsidian Modal.
 * Step 0: Paste URI or payload.
 * Step 1: Enter decryption password.
 * Step 2: Confirm destructive overwrite, then import.
 */
export const ImportStepperContent: React.FC<ImportStepperContentProps> = ({
  prefillPayload,
  onPersistSettings,
  onReloadPlugin,
  onNotifyManualCopy,
  onClose,
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [setupURI, setSetupURI] = useState("");
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Reason: cache the decrypted result from Step 1 so Step 2 can persist
  // settings without a second PBKDF2(600k) decryption pass.
  const cachedSettingsRef = useRef<CopilotSettings | null>(null);
  const cachedMetaRef = useRef<SetupUriMeta | null>(null);

  // Reason: track mount state to prevent setState after unmount during async import.
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      // Reason: do NOT clear the reload timer here — once import succeeds and
      // settings are persisted, the reload must still happen even if the user
      // closes the modal during the success delay.
    };
  }, []);

  // Reason: when opened via protocol handler, prefill the textarea with the payload.
  useEffect(() => {
    if (!prefillPayload) return;
    setSetupURI(prefillPayload.trim());
  }, [prefillPayload]);

  const handleNextFromPaste = () => {
    if (!setupURI.trim()) return;
    setCurrentStep(1);
  };

  /**
   * Validate the password by decrypting the payload before advancing to Step 2.
   *
   * Reason: catching wrong passwords here avoids the frustration of going
   * through the confirmation step only to fail at import time.
   */
  const handleNextFromPassword = async () => {
    if (!password) return;
    setErrorMessage("");
    setIsDecrypting(true);

    try {
      const payload = extractPayloadFromUri(setupURI);
      // Reason: decrypt once here and cache the result so handleImport can
      // skip a second PBKDF2(600k) pass. applySetupUri performs the same
      // validation as validateSetupUri but also returns usable settings.
      const { settings, meta } = await applySetupUri(payload, password);
      cachedSettingsRef.current = settings;
      cachedMetaRef.current = meta;
      if (isMountedRef.current) setCurrentStep(2);
    } catch (error) {
      if (!isMountedRef.current) return;
      if (error instanceof SetupUriDecryptionError) {
        setErrorMessage(error.message);
      } else if (error instanceof Error) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Failed to validate configuration. Check password and URI format.");
      }
    } finally {
      if (isMountedRef.current) setIsDecrypting(false);
    }
  };

  const handleBack = () => {
    setCurrentStep((prev) => {
      if (prev === 2) {
        setConfirmed(false);
        // Reason: invalidate cached data when navigating back from
        // confirmation — the user may change the password in Step 1.
        cachedSettingsRef.current = null;
        cachedMetaRef.current = null;
      }
      return Math.max(prev - 1, 0);
    });
  };

  /**
   * Execute the full import pipeline:
   * applySetupUri → persist to disk → notify → close → reload plugin.
   *
   * Reason: the ordering must be strictly maintained. Persist must complete
   * before plugin reload, otherwise imported settings may be lost.
   */
  const handleImport = async () => {
    if (!confirmed) return;
    setIsImporting(true);
    setErrorMessage("");

    try {
      // Reason: use the settings already decrypted in Step 1 to avoid a
      // second PBKDF2(600k) pass. Fall back to full decrypt only if the
      // cache was somehow cleared (defensive, should not happen in practice).
      const importedSettings =
        cachedSettingsRef.current ??
        (await applySetupUri(extractPayloadFromUri(setupURI), password)).settings;
      await onPersistSettings(importedSettings);

      // Reason: only update React state if still mounted; but always proceed
      // with Notice + reload regardless of mount state — the import is done.
      if (isMountedRef.current) {
        setIsImporting(false);
        setIsSuccess(true);
      }
      new Notice("Configuration imported successfully! Reloading plugin...");
      onNotifyManualCopy({
        customPromptsFolder: importedSettings.customPromptsFolder,
        userSystemPromptsFolder: importedSettings.userSystemPromptsFolder,
        memoryFolderName: importedSettings.memoryFolderName,
      });

      // Reason: small delay before close+reload to let the user see success state.
      // Wrapped in void IIFE to avoid unhandled promise rejection from setTimeout.
      setTimeout(() => {
        void (async () => {
          try {
            onClose();
            await onReloadPlugin();
          } catch {
            new Notice("Please restart Obsidian to apply the imported settings.");
          }
        })();
      }, 1500);
    } catch (error) {
      if (isMountedRef.current) setIsImporting(false);
      if (error instanceof SetupUriDecryptionError) {
        if (isMountedRef.current) setErrorMessage(error.message);
        else new Notice(error.message);
      } else if (error instanceof Error) {
        logError("Failed to import Setup URI:", error);
        if (isMountedRef.current) setErrorMessage(error.message);
        else new Notice(error.message);
      } else {
        logError("Failed to import Setup URI:", error);
        const message = "Failed to import configuration. Check password and URI format.";
        if (isMountedRef.current) setErrorMessage(message);
        else new Notice(message);
      }
    }
  };

  // Success state
  if (isSuccess) {
    return (
      <div className="tw-flex tw-flex-col tw-items-center tw-gap-4 tw-py-8">
        <div className="tw-flex tw-size-12 tw-items-center tw-justify-center tw-rounded-full tw-bg-success">
          <CheckCircle2 className="tw-size-6 tw-text-[var(--color-green)]" />
        </div>
        <div className="tw-text-center">
          <h3 className="tw-text-sm tw-font-semibold tw-text-normal">Import Complete</h3>
          <div className="tw-mt-1 tw-text-xs tw-text-muted">
            Your configuration has been successfully imported. Reloading plugin...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tw-flex tw-flex-col tw-gap-6">
      <div className="tw-flex tw-items-center tw-gap-3 tw-text-normal">
        <ArrowDownToLine className="tw-size-5 tw-text-accent" />
        <h2 className="tw-m-0 tw-text-xl tw-font-bold">Import Setup URI</h2>
      </div>

      <div className="tw-text-sm tw-leading-relaxed tw-text-muted">
        Paste a Setup URI and enter the password to import configuration.
      </div>

      <StepIndicator steps={IMPORT_STEPS} currentStep={currentStep} />

      {/* Step 0: Paste URI */}
      {currentStep === 0 && (
        <div className="tw-flex tw-flex-col tw-gap-5">
          <div className="tw-flex tw-items-start tw-gap-2 tw-rounded-md tw-bg-callout-warning/10 tw-p-3 tw-text-xs tw-text-callout-warning">
            <AlertTriangle className="tw-mt-0.5 tw-size-4 tw-shrink-0" />
            <span className="tw-leading-relaxed">
              Only import Setup URIs from sources you trust. A malicious URI could overwrite your
              API keys and redirect requests to unauthorized servers.
            </span>
          </div>

          <div className="tw-flex tw-flex-col tw-gap-1.5">
            <Label htmlFor="import-uri">Setup URI or Payload</Label>
            <Textarea
              id="import-uri"
              placeholder={
                "Paste the obsidian://copilot-setup... URI here\nor paste the encrypted payload directly"
              }
              value={setupURI}
              onChange={(e) => setSetupURI(e.target.value)}
              readOnly={!!prefillPayload}
              className="tw-min-h-28 tw-resize-none tw-font-mono tw-text-xs"
            />
          </div>

          <Button
            onClick={handleNextFromPaste}
            disabled={!setupURI.trim()}
            className="tw-gap-2 tw-self-end"
          >
            Next
            <ArrowRight className="tw-size-4" />
          </Button>
        </div>
      )}

      {/* Step 1: Enter Password */}
      {currentStep === 1 && (
        <div className="tw-flex tw-flex-col tw-gap-5">
          <div className="tw-flex tw-items-center tw-gap-2 tw-rounded-lg tw-bg-secondary tw-p-3">
            <Key className="tw-size-4 tw-shrink-0 tw-text-muted" />
            <span className="tw-text-xs tw-text-muted">
              Enter the password that was used to encrypt this configuration.
            </span>
          </div>

          <div className="tw-flex tw-flex-col tw-gap-1.5">
            <Label>Password</Label>
            <PasswordInput
              value={password}
              onChange={(value) => {
                setPassword(value);
                if (errorMessage) setErrorMessage("");
              }}
              placeholder="Enter decryption password"
              autoDecrypt={false}
            />
          </div>

          {errorMessage && (
            <div className="tw-rounded tw-bg-error tw-p-2 tw-text-xs tw-text-error">
              {errorMessage}
            </div>
          )}

          <div className="tw-flex tw-items-center tw-justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              disabled={isDecrypting}
              className="tw-gap-2 tw-text-muted"
            >
              <ArrowLeft className="tw-size-4" />
              Back
            </Button>
            <Button
              onClick={handleNextFromPassword}
              disabled={!password || isDecrypting}
              className="tw-gap-2"
            >
              {isDecrypting ? (
                <>
                  <span className="tw-size-4 tw-animate-spin tw-rounded-full tw-border tw-border-solid tw-border-current tw-border-t-transparent" />
                  Decrypting...
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="tw-size-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Confirm & Import */}
      {currentStep === 2 && (
        <div className="tw-flex tw-flex-col tw-gap-5">
          <div className="tw-flex tw-items-start tw-gap-3 tw-rounded-md tw-border tw-border-[var(--background-modifier-error-hover)] tw-p-4 tw-bg-modifier-error/10">
            <AlertTriangle className="tw-mt-0.5 tw-size-5 tw-shrink-0 tw-text-error" />
            <div className="tw-flex tw-flex-col">
              <span className="tw-text-sm tw-font-semibold tw-text-error">Destructive Action</span>
              <span className="tw-mt-1 tw-text-xs tw-text-normal">
                Importing will completely <strong>OVERWRITE</strong> your current settings. This
                action cannot be undone.
              </span>
            </div>
          </div>

          {cachedMetaRef.current && (
            <div className="tw-flex tw-flex-col tw-gap-1 tw-rounded-md tw-bg-secondary tw-p-3 tw-text-xs tw-text-muted">
              <span>
                <span className="tw-font-medium tw-text-normal">Source:</span> Copilot v
                {cachedMetaRef.current.pluginVersion}
              </span>
              <span>
                <span className="tw-font-medium tw-text-normal">Created:</span>{" "}
                {Number.isNaN(Date.parse(cachedMetaRef.current.createdAt))
                  ? "Unknown"
                  : new Date(cachedMetaRef.current.createdAt).toLocaleString()}
              </span>
            </div>
          )}

          <div className="tw-rounded-lg tw-border tw-border-border tw-bg-secondary tw-p-4">
            <div className="tw-mb-3 tw-flex tw-items-center tw-gap-2">
              <Shield className="tw-size-4 tw-text-muted" />
              <span className="tw-text-xs tw-font-medium tw-text-normal">
                This will permanently overwrite:
              </span>
            </div>
            <ul className="tw-flex tw-list-disc tw-flex-col tw-gap-1.5 tw-pl-6 tw-text-xs tw-text-muted">
              <li>All API keys</li>
              <li>Model configurations</li>
              <li>Plugin preferences</li>
            </ul>
          </div>

          <label className="tw-group tw-flex tw-cursor-pointer tw-items-start tw-gap-3">
            <Checkbox
              checked={confirmed}
              onCheckedChange={(checked) => setConfirmed(checked === true)}
              className="tw-mt-0.5"
            />
            <span className="tw-text-sm tw-leading-relaxed tw-text-muted tw-transition-colors group-hover:tw-text-normal">
              I understand that all my current settings will be replaced
            </span>
          </label>

          {errorMessage && (
            <div className="tw-rounded tw-bg-error tw-p-2 tw-text-xs tw-text-error">
              {errorMessage}
            </div>
          )}

          <div className="tw-flex tw-items-center tw-justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              disabled={isImporting}
              className="tw-gap-2 tw-text-muted"
            >
              <ArrowLeft className="tw-size-4" />
              Back
            </Button>
            <Button
              variant="destructive"
              onClick={handleImport}
              disabled={!confirmed || isImporting}
              className="tw-gap-2"
            >
              {isImporting ? (
                <>
                  <span className="tw-size-4 tw-animate-spin tw-rounded-full tw-border tw-border-solid tw-border-current tw-border-t-transparent" />
                  Importing...
                </>
              ) : (
                <>
                  <Download className="tw-size-4" />
                  Import Configuration
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
