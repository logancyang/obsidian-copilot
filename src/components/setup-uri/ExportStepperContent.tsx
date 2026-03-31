import React, { useState, useCallback } from "react";
import {
  ArrowRight,
  ArrowUpFromLine,
  CheckCircle2,
  AlertTriangle,
  FileDown,
  Settings,
  Terminal,
  MessageSquare,
  Brain,
} from "lucide-react";
import { App, Notice, TFile } from "obsidian";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { logError } from "@/logger";
import { MIN_SETUP_URI_PASSPHRASE_LENGTH } from "@/setupUri/crypto";
import { generateConfigFile } from "@/setupUri/configFile";
import { StepIndicator } from "@/components/setup-uri/StepIndicator";

const MIN_PASSPHRASE_LENGTH = MIN_SETUP_URI_PASSPHRASE_LENGTH;
const RECOMMENDED_PASSPHRASE_LENGTH = 12;

const EXPORT_STEPS = [{ label: "Set Password" }, { label: "Export" }];

interface ExportStepperContentProps {
  app: App;
  pluginVersion: string;
}

/** Generate a default export filename with today's date. */
function getDefaultFilename(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `copilot-config-${date}.copilot`;
}

/**
 * 2-step export flow rendered inside an Obsidian Modal.
 * Step 0: Set encryption password with confirmation.
 * Step 1: Export configuration to a .copilot file in the vault.
 */
export const ExportStepperContent: React.FC<ExportStepperContentProps> = ({
  app: appInstance,
  pluginVersion,
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [filename, setFilename] = useState(getDefaultFilename);
  const [isExporting, setIsExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});

  const reset = useCallback(() => {
    setCurrentStep(0);
    setPassword("");
    setConfirmPassword("");
    setFilename(getDefaultFilename());
    setIsExporting(false);
    setExportedPath("");
    setErrors({});
  }, []);

  /** Validate password fields and return true if valid. */
  const validate = (): boolean => {
    const newErrors: { password?: string; confirm?: string } = {};
    if (password.length < MIN_PASSPHRASE_LENGTH) {
      newErrors.password = `Password must be at least ${MIN_PASSPHRASE_LENGTH} characters`;
    }
    if (password !== confirmPassword) {
      newErrors.confirm = "Passwords do not match";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  /** Advance to Step 1 after validating password. */
  const handleNext = () => {
    if (!validate()) return;
    setCurrentStep(1);
  };

  /** Generate and write the .copilot file to the vault root. */
  const handleExport = async () => {
    const rawName = filename.trim();
    if (!rawName) return;

    // Reason: import auto-discovery only scans the vault root. Enforce
    // filename-only input so the export location matches the import scan.
    if (rawName.includes("/") || rawName.includes("\\")) {
      new Notice("Please enter a file name only. Export files are saved to the vault root.");
      return;
    }

    setIsExporting(true);
    try {
      const content = await generateConfigFile(appInstance, password, pluginVersion);
      const targetPath = rawName.endsWith(".copilot") ? rawName : `${rawName}.copilot`;

      // Reason: if the file already exists (e.g., same-day re-export), overwrite it
      // instead of failing with a "file exists" error.
      const existing = appInstance.vault.getAbstractFileByPath(targetPath);
      if (existing && existing instanceof TFile) {
        await appInstance.vault.modify(existing, content);
      } else {
        await appInstance.vault.create(targetPath, content);
      }
      setExportedPath(targetPath);
      new Notice(`Configuration exported to ${targetPath}`);
    } catch (error) {
      logError("Failed to export configuration:", error);
      new Notice(error instanceof Error ? error.message : "Failed to export configuration.");
    } finally {
      setIsExporting(false);
    }
  };

  const isPasswordValid = password.length >= MIN_PASSPHRASE_LENGTH && password === confirmPassword;

  return (
    <div className="tw-flex tw-flex-col tw-gap-6">
      <div className="tw-flex tw-items-center tw-gap-3 tw-text-normal">
        <ArrowUpFromLine className="tw-size-5 tw-text-accent" />
        <h2 className="tw-m-0 tw-text-xl tw-font-bold">Export Configuration</h2>
      </div>

      <div className="tw-text-sm tw-leading-relaxed tw-text-muted">
        Encrypt your full configuration and save it as a portable file.
      </div>

      <StepIndicator steps={EXPORT_STEPS} currentStep={currentStep} />

      {/* Step 0: Set Password */}
      {currentStep === 0 && (
        <div className="tw-flex tw-flex-col tw-gap-5">
          <div className="tw-flex tw-items-start tw-gap-2 tw-rounded-md tw-bg-callout-warning/10 tw-p-3 tw-text-xs tw-text-callout-warning">
            <AlertTriangle className="tw-mt-0.5 tw-size-4 tw-shrink-0" />
            <span className="tw-leading-relaxed">
              Keep the exported file private. Anyone with the file and the password can import your
              API keys into their vault.
            </span>
          </div>

          <div className="tw-text-sm tw-leading-relaxed tw-text-muted">
            Set a password to encrypt your configuration. You will need this password when importing
            into another vault.
          </div>

          <div className="tw-flex tw-flex-col tw-gap-1.5">
            <Label>Password</Label>
            <PasswordInput
              value={password}
              onChange={(value) => {
                setPassword(value);
                if (errors.password || errors.confirm)
                  setErrors((prev) => ({ ...prev, password: undefined, confirm: undefined }));
              }}
              placeholder={`Enter password (min ${MIN_PASSPHRASE_LENGTH} characters)`}
              autoDecrypt={false}
            />
            {errors.password && <span className="tw-text-xs tw-text-error">{errors.password}</span>}
            {!errors.password &&
              password.length >= MIN_PASSPHRASE_LENGTH &&
              password.length < RECOMMENDED_PASSPHRASE_LENGTH && (
                <span className="tw-text-xs tw-text-muted">
                  Tip: use {RECOMMENDED_PASSPHRASE_LENGTH}+ characters for a stronger passphrase.
                </span>
              )}
          </div>

          <div className="tw-flex tw-flex-col tw-gap-1.5">
            <Label>Confirm Password</Label>
            <PasswordInput
              value={confirmPassword}
              onChange={(value) => {
                setConfirmPassword(value);
                if (errors.confirm) setErrors((prev) => ({ ...prev, confirm: undefined }));
              }}
              placeholder="Re-enter password"
              autoDecrypt={false}
            />
            {errors.confirm && <span className="tw-text-xs tw-text-error">{errors.confirm}</span>}
          </div>

          <Button onClick={handleNext} disabled={!isPasswordValid} className="tw-gap-2 tw-self-end">
            Next
            <ArrowRight className="tw-size-4" />
          </Button>
        </div>
      )}

      {/* Step 1: Export */}
      {currentStep === 1 && !exportedPath && (
        <div className="tw-flex tw-flex-col tw-gap-5">
          {/* What's Included */}
          <div className="tw-rounded-lg tw-border tw-border-border tw-bg-secondary tw-p-4">
            <div className="tw-mb-3 tw-text-xs tw-font-medium tw-text-normal">
              What&apos;s Included
            </div>
            <div className="tw-grid tw-grid-cols-2 tw-gap-2">
              <div className="tw-flex tw-items-center tw-gap-2 tw-text-xs tw-text-muted">
                <Settings className="tw-size-3.5 tw-shrink-0" />
                <span>Settings &amp; API Keys</span>
              </div>
              <div className="tw-flex tw-items-center tw-gap-2 tw-text-xs tw-text-muted">
                <Terminal className="tw-size-3.5 tw-shrink-0" />
                <span>Custom Commands</span>
              </div>
              <div className="tw-flex tw-items-center tw-gap-2 tw-text-xs tw-text-muted">
                <MessageSquare className="tw-size-3.5 tw-shrink-0" />
                <span>System Prompts</span>
              </div>
              <div className="tw-flex tw-items-center tw-gap-2 tw-text-xs tw-text-muted">
                <Brain className="tw-size-3.5 tw-shrink-0" />
                <span>Saved Memories</span>
              </div>
            </div>
          </div>

          <div className="tw-flex tw-flex-col tw-gap-1.5">
            <Label>File Name</Label>
            <Input
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="copilot-config.copilot"
            />
            <span className="tw-text-xs tw-text-muted">
              File will be saved to the vault root directory.
            </span>
          </div>

          <div className="tw-flex tw-items-center tw-justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentStep(0)}
              className="tw-gap-2 tw-text-muted"
            >
              Back
            </Button>
            <Button
              onClick={handleExport}
              disabled={!filename.trim() || isExporting}
              className="tw-gap-2"
            >
              {isExporting ? (
                <>
                  <span className="tw-size-4 tw-animate-spin tw-rounded-full tw-border tw-border-solid tw-border-current tw-border-t-transparent" />
                  Exporting...
                </>
              ) : (
                <>
                  <FileDown className="tw-size-4" />
                  Export Configuration
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Step 1: Success */}
      {currentStep === 1 && exportedPath && (
        <div className="tw-flex tw-flex-col tw-gap-5">
          <div className="tw-flex tw-items-center tw-gap-2 tw-rounded-md tw-bg-[rgba(var(--color-green-rgb),0.1)] tw-p-3 tw-text-sm tw-text-[var(--color-green)]">
            <CheckCircle2 className="tw-size-4" />
            <span className="tw-font-medium">Configuration exported successfully</span>
          </div>

          <div className="tw-rounded-md tw-bg-secondary tw-p-3 tw-text-xs tw-text-muted">
            <span className="tw-font-medium tw-text-normal">Saved to:</span> {exportedPath}
          </div>

          <div className="tw-text-xs tw-leading-relaxed tw-text-muted">
            Transfer this file to another vault and use the Import function to restore your
            configuration. Delete the file after use if it contains sensitive data.
          </div>

          <Button variant="ghost" size="sm" onClick={reset} className="tw-self-start tw-text-muted">
            Export Another
          </Button>
        </div>
      )}
    </div>
  );
};
