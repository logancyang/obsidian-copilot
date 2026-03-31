import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Download,
  Key,
  FileUp,
  Terminal,
  MessageSquare,
  Brain,
  Settings,
} from "lucide-react";
import { type App, Notice, TFile } from "obsidian";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Checkbox } from "@/components/ui/checkbox";
import { logError } from "@/logger";
import { SetupUriDecryptionError } from "@/setupUri/crypto";
import {
  parseConfigFileWrapper,
  decryptConfigFile,
  type ConfigFileWrapper,
  type ConfigFileMeta,
} from "@/setupUri/configFile";
import type { CollectedVaultFiles } from "@/setupUri/vaultFiles";
import { StepIndicator } from "@/components/setup-uri/StepIndicator";
import type { CopilotSettings } from "@/settings/model";

const IMPORT_STEPS = [{ label: "Select File" }, { label: "Password" }, { label: "Confirm" }];

/** A .copilot file detected in the vault. */
interface VaultConfigFile {
  name: string;
  path: string;
  size: number;
  mtime: number;
}

interface ImportStepperContentProps {
  app: App;
  /** Persist imported settings to disk. */
  onPersistSettings: (settings: CopilotSettings) => Promise<void>;
  /** Restore vault files before persisting settings. */
  onRestoreVaultFiles: (
    files: CollectedVaultFiles,
    importedSettings: CopilotSettings
  ) => Promise<void>;
  /** Reload the Copilot plugin to apply imported settings. */
  onReloadPlugin: () => Promise<void>;
  /** Close the parent modal. */
  onClose: () => void;
}

/**
 * 3-step import flow rendered inside an Obsidian Modal.
 * Step 0: Select .copilot file (auto-detect from vault or upload from disk).
 * Step 1: Enter decryption password.
 * Step 2: Confirm destructive overwrite, then import.
 */

/** Maximum file size for .copilot files (15 MB). Prevents OOM before crypto checks. */
const MAX_CONFIG_FILE_SIZE = 15 * 1024 * 1024;
export const ImportStepperContent: React.FC<ImportStepperContentProps> = ({
  app: appInstance,
  onPersistSettings,
  onRestoreVaultFiles,
  onReloadPlugin,
  onClose,
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // File selection state
  const [vaultFiles, setVaultFiles] = useState<VaultConfigFile[]>([]);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [parsedWrapper, setParsedWrapper] = useState<ConfigFileWrapper | null>(null);

  // Cached decryption results
  const cachedSettingsRef = useRef<CopilotSettings | null>(null);
  const cachedMetaRef = useRef<ConfigFileMeta | null>(null);
  const cachedVaultFilesRef = useRef<CollectedVaultFiles | null>(null);

  const isMountedRef = useRef(true);
  const reloadTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reason: do NOT clear the reload timer on unmount — the timer fires
  // onClose + onReloadPlugin, which must run even if the modal is closed
  // before the 1.5 s success delay expires.
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Scan vault root for .copilot files on mount
  useEffect(() => {
    const files = appInstance.vault
      .getFiles()
      .filter((f) => f.extension === "copilot" && !f.path.includes("/"))
      .map((f) => ({
        name: f.name,
        path: f.path,
        size: f.stat.size,
        mtime: f.stat.mtime,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    setVaultFiles(files);
  }, [appInstance]);

  /** Reset file selection state (used before each new file attempt). */
  const clearFileSelection = useCallback(() => {
    setParsedWrapper(null);
    setSelectedFileName("");
    setErrorMessage("");
  }, []);

  /** Handle selecting a .copilot file from the vault. */
  const handleSelectVaultFile = useCallback(
    async (file: VaultConfigFile) => {
      clearFileSelection();
      try {
        if (file.size > MAX_CONFIG_FILE_SIZE) {
          setErrorMessage("File is too large (max 15 MB).");
          return;
        }
        const tfile = appInstance.vault.getAbstractFileByPath(file.path);
        if (!tfile || !(tfile instanceof TFile)) {
          setErrorMessage("File not found in vault.");
          return;
        }
        const content = await appInstance.vault.read(tfile);
        const wrapper = parseConfigFileWrapper(content);
        if (!isMountedRef.current) return;
        setSelectedFileName(file.name);
        setParsedWrapper(wrapper);
      } catch (error) {
        if (!isMountedRef.current) return;
        setErrorMessage(error instanceof Error ? error.message : "Failed to read file.");
      }
    },
    [appInstance, clearFileSelection]
  );

  /** Handle file upload from disk. */
  const handleFileUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      // Reason: reset input value so re-selecting the same file triggers change again.
      event.target.value = "";
      clearFileSelection();
      if (file.size > MAX_CONFIG_FILE_SIZE) {
        setErrorMessage("File is too large (max 15 MB).");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (!isMountedRef.current) return;
        try {
          const content = reader.result as string;
          const wrapper = parseConfigFileWrapper(content);
          setSelectedFileName(file.name);
          setParsedWrapper(wrapper);
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : "Invalid file format.");
        }
      };
      reader.onerror = () => {
        if (!isMountedRef.current) return;
        setErrorMessage("Failed to read the selected file.");
      };
      reader.readAsText(file);
    },
    [clearFileSelection]
  );

  const handleNextFromFile = () => {
    if (!parsedWrapper) return;
    setCurrentStep(1);
  };

  /**
   * Validate the password by decrypting the payload before advancing to Step 2.
   */
  const handleNextFromPassword = async () => {
    if (!password || !parsedWrapper) return;
    setErrorMessage("");
    setIsDecrypting(true);

    try {
      const { settings, meta, vaultFiles: files } = await decryptConfigFile(
        parsedWrapper,
        password
      );
      cachedSettingsRef.current = settings;
      cachedMetaRef.current = meta;
      cachedVaultFilesRef.current = files;
      if (isMountedRef.current) setCurrentStep(2);
    } catch (error) {
      if (!isMountedRef.current) return;
      if (error instanceof SetupUriDecryptionError) {
        setErrorMessage(error.message);
      } else if (error instanceof Error) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Failed to decrypt. Check your password.");
      }
    } finally {
      if (isMountedRef.current) setIsDecrypting(false);
    }
  };

  const handleBack = () => {
    setCurrentStep((prev) => {
      if (prev === 2) {
        setConfirmed(false);
        cachedSettingsRef.current = null;
        cachedMetaRef.current = null;
        cachedVaultFilesRef.current = null;
      }
      return Math.max(prev - 1, 0);
    });
  };

  /**
   * Execute the full import pipeline:
   * restore vault files → persist settings → close → reload plugin.
   */
  const handleImport = async () => {
    if (!confirmed) return;
    setIsImporting(true);
    setErrorMessage("");

    try {
      const importedSettings =
        cachedSettingsRef.current ??
        (await decryptConfigFile(parsedWrapper!, password)).settings;
      const importedVaultFiles =
        cachedVaultFilesRef.current ??
        (await decryptConfigFile(parsedWrapper!, password)).vaultFiles;

      // Reason: files first → settings last to avoid settings subscribers
      // seeing empty folders during the transition.
      await onRestoreVaultFiles(importedVaultFiles, importedSettings);
      await onPersistSettings(importedSettings);

      // Reason: always fire reload even if the modal was closed during import.
      // Persistence already succeeded — skipping reload would leave the vault
      // in an inconsistent state with no user feedback.
      const reloadDelayMs = isMountedRef.current ? 1500 : 0;
      if (isMountedRef.current) {
        setIsImporting(false);
        setIsSuccess(true);
      }
      new Notice("Configuration imported successfully! Reloading plugin...");

      reloadTimerRef.current = window.setTimeout(() => {
        reloadTimerRef.current = null;
        void (async () => {
          try {
            onClose();
            await onReloadPlugin();
          } catch {
            new Notice("Please restart Obsidian to apply the imported settings.");
          }
        })();
      }, reloadDelayMs);
    } catch (error) {
      if (isMountedRef.current) setIsImporting(false);
      if (error instanceof SetupUriDecryptionError) {
        if (isMountedRef.current) setErrorMessage(error.message);
        else new Notice(error.message);
      } else if (error instanceof Error) {
        logError("Failed to import configuration:", error);
        if (isMountedRef.current) setErrorMessage(error.message);
        else new Notice(error.message);
      } else {
        logError("Failed to import configuration:", error);
        const message = "Failed to import configuration. Check password and file format.";
        if (isMountedRef.current) setErrorMessage(message);
        else new Notice(message);
      }
    }
  };

  /** Format bytes into a human-readable string. */
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
        <h2 className="tw-m-0 tw-text-xl tw-font-bold">Import Configuration</h2>
      </div>

      <div className="tw-text-sm tw-leading-relaxed tw-text-muted">
        Select a .copilot configuration file and enter the password to import.
      </div>

      <StepIndicator steps={IMPORT_STEPS} currentStep={currentStep} />

      {/* Step 0: Select File */}
      {currentStep === 0 && (
        <div className="tw-flex tw-flex-col tw-gap-5">
          <div className="tw-flex tw-items-start tw-gap-2 tw-rounded-md tw-bg-callout-warning/10 tw-p-3 tw-text-xs tw-text-callout-warning">
            <AlertTriangle className="tw-mt-0.5 tw-size-4 tw-shrink-0" />
            <span className="tw-leading-relaxed">
              Only import configuration files from sources you trust. A malicious file could
              overwrite files in your vault and redirect requests to unauthorized servers.
            </span>
          </div>

          {/* Vault files list */}
          {vaultFiles.length > 0 && (
            <div className="tw-flex tw-flex-col tw-gap-2">
              <Label>Found in vault</Label>
              {vaultFiles.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => handleSelectVaultFile(file)}
                  className={`tw-flex tw-cursor-pointer tw-items-center tw-justify-between tw-rounded-md tw-border tw-p-3 tw-text-left tw-transition-colors hover:tw-bg-modifier-hover ${
                    selectedFileName === file.name
                      ? "tw-border-interactive-accent tw-bg-interactive-accent-hsl/5"
                      : "tw-border-border tw-bg-transparent"
                  }`}
                >
                  <div className="tw-flex tw-items-center tw-gap-2">
                    <FileUp className="tw-size-4 tw-shrink-0 tw-text-muted" />
                    <span className="tw-text-sm tw-text-normal">{file.name}</span>
                  </div>
                  <div className="tw-flex tw-items-center tw-gap-3 tw-text-xs tw-text-muted">
                    <span>{formatSize(file.size)}</span>
                    <span>{new Date(file.mtime).toLocaleDateString()}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Upload area */}
          <div className="tw-flex tw-flex-col tw-gap-2">
            <Label>{vaultFiles.length > 0 ? "Or select from disk" : "Select file"}</Label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="tw-flex tw-cursor-pointer tw-flex-col tw-items-center tw-justify-center tw-gap-2 tw-rounded-lg tw-border tw-border-dashed tw-border-border tw-bg-transparent tw-p-6 tw-text-muted tw-transition-colors hover:tw-border-interactive-accent hover:tw-bg-modifier-hover"
            >
              <FileUp className="tw-size-6" />
              <span className="tw-text-xs">Click to browse for a .copilot file</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".copilot"
              onChange={handleFileUpload}
              className="tw-hidden"
            />
          </div>

          {/* Selected file preview */}
          {parsedWrapper && (
            <div className="tw-rounded-md tw-bg-[rgba(var(--color-green-rgb),0.1)] tw-p-3 tw-text-xs">
              <div className="tw-flex tw-items-center tw-gap-2 tw-text-[var(--color-green)]">
                <CheckCircle2 className="tw-size-3.5" />
                <span className="tw-font-medium">{selectedFileName}</span>
              </div>
              <div className="tw-mt-2 tw-flex tw-gap-4 tw-text-muted">
                <span>{parsedWrapper.stats.commandCount} commands</span>
                <span>{parsedWrapper.stats.promptCount} prompts</span>
                <span>{parsedWrapper.stats.memoryCount} memory files</span>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="tw-rounded tw-bg-error tw-p-2 tw-text-xs tw-text-error">
              {errorMessage}
            </div>
          )}

          <Button
            onClick={handleNextFromFile}
            disabled={!parsedWrapper}
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
              Enter the password that was used to encrypt this configuration file.
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
                  Decrypt &amp; Verify
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
                Importing will <strong>replace</strong> your current settings and overwrite
                same-named custom commands, system prompts, and memory files. Existing files
                not included in the import will be kept.
              </span>
            </div>
          </div>

          {/* Preview card */}
          {cachedMetaRef.current && parsedWrapper && (
            <div className="tw-rounded-lg tw-border tw-border-border tw-bg-secondary tw-p-4">
              <div className="tw-mb-3 tw-flex tw-flex-col tw-gap-1 tw-text-xs tw-text-muted">
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

              <div className="tw-flex tw-flex-col tw-gap-2">
                <div className="tw-flex tw-items-center tw-gap-2 tw-text-xs tw-text-muted">
                  <Settings className="tw-size-3.5" />
                  <span>Settings &amp; API Keys</span>
                </div>
                {/* Reason: use decrypted data (not outer stats) for trustworthy counts */}
                {(cachedVaultFilesRef.current?.customCommands.length ?? 0) > 0 && (
                  <div className="tw-flex tw-items-center tw-gap-2 tw-text-xs tw-text-muted">
                    <Terminal className="tw-size-3.5" />
                    <span>
                      {cachedVaultFilesRef.current!.customCommands.length} Custom Commands
                    </span>
                  </div>
                )}
                {(cachedVaultFilesRef.current?.systemPrompts.length ?? 0) > 0 && (
                  <div className="tw-flex tw-items-center tw-gap-2 tw-text-xs tw-text-muted">
                    <MessageSquare className="tw-size-3.5" />
                    <span>
                      {cachedVaultFilesRef.current!.systemPrompts.length} System Prompts
                    </span>
                  </div>
                )}
                {cachedVaultFilesRef.current &&
                  (cachedVaultFilesRef.current.memory.recentConversations != null ||
                    cachedVaultFilesRef.current.memory.savedMemories != null) && (
                  <div className="tw-flex tw-items-center tw-gap-2 tw-text-xs tw-text-muted">
                    <Brain className="tw-size-3.5" />
                    <span>Memory Files</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <label className="tw-group tw-flex tw-cursor-pointer tw-items-start tw-gap-3">
            <Checkbox
              checked={confirmed}
              onCheckedChange={(checked) => setConfirmed(checked === true)}
              className="tw-mt-0.5"
            />
            <span className="tw-text-sm tw-leading-relaxed tw-text-muted tw-transition-colors group-hover:tw-text-normal">
              I understand that my current settings will be replaced and same-named files overwritten
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
