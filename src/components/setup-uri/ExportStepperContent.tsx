import React, { useState, useCallback } from "react";
import {
  ArrowRight,
  ArrowUpFromLine,
  CheckCircle2,
  ChevronDown,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import { Notice } from "obsidian";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { logError } from "@/logger";
import { MIN_SETUP_URI_PASSPHRASE_LENGTH } from "@/setupUri/crypto";
import { generateSetupUri, extractPayloadFromUri } from "@/setupUri/setupUri";
import { StepIndicator } from "@/components/setup-uri/StepIndicator";
import { CopyCodeBlock } from "@/components/setup-uri/CopyCodeBlock";
import { cn } from "@/lib/utils";

const MIN_PASSPHRASE_LENGTH = MIN_SETUP_URI_PASSPHRASE_LENGTH;
const RECOMMENDED_PASSPHRASE_LENGTH = 12;

/**
 * Reason: many OS protocol handlers and browsers truncate URIs above ~2000
 * chars. We warn users and offer a payload-only copy fallback.
 */
const URI_LENGTH_WARNING_THRESHOLD = 2000;

const EXPORT_STEPS = [{ label: "Set Password" }, { label: "Copy Result" }];

interface ExportStepperContentProps {
  pluginVersion: string;
}

/**
 * 2-step export flow rendered inside an Obsidian Modal.
 * Step 0: Set encryption password with confirmation.
 * Step 1: Copy the generated URI or payload.
 */
export const ExportStepperContent: React.FC<ExportStepperContentProps> = ({ pluginVersion }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [generatedURI, setGeneratedURI] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});

  const reset = useCallback(() => {
    setCurrentStep(0);
    setPassword("");
    setConfirmPassword("");
    setGeneratedURI("");
    setIsGenerating(false);
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

  /** Generate the encrypted Setup URI. */
  const handleGenerate = async () => {
    if (!validate()) return;

    setIsGenerating(true);
    try {
      const uri = await generateSetupUri(password, pluginVersion);
      setGeneratedURI(uri);
      setCurrentStep(1);
    } catch (error) {
      logError("Failed to generate Setup URI:", error);
      new Notice(error instanceof Error ? error.message : "Failed to generate Setup URI.");
    } finally {
      setIsGenerating(false);
    }
  };

  const isPasswordValid = password.length >= MIN_PASSPHRASE_LENGTH && password === confirmPassword;

  return (
    <div className="tw-flex tw-flex-col tw-gap-6">
      <div className="tw-flex tw-items-center tw-gap-3 tw-text-normal">
        <ArrowUpFromLine className="tw-size-5 tw-text-accent" />
        <h2 className="tw-m-0 tw-text-xl tw-font-bold">Export Setup URI</h2>
      </div>

      <div className="tw-text-sm tw-leading-relaxed tw-text-muted">
        Encrypt your current configuration and generate a shareable URI.
      </div>

      <StepIndicator steps={EXPORT_STEPS} currentStep={currentStep} />

      {/* Step 0: Set Password */}
      {currentStep === 0 && (
        <div className="tw-flex tw-flex-col tw-gap-5">
          <div className="tw-flex tw-items-start tw-gap-2 tw-rounded-md tw-bg-callout-warning/10 tw-p-3 tw-text-xs tw-text-callout-warning">
            <AlertTriangle className="tw-mt-0.5 tw-size-4 tw-shrink-0" />
            <span className="tw-leading-relaxed">
              Keep the generated Setup URI private. Anyone with the URI and the password can import
              your API keys into their vault.
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
                // Reason: clear both errors when password changes, since confirm error may also be stale.
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

          <Button
            onClick={handleGenerate}
            disabled={!isPasswordValid || isGenerating}
            className="tw-gap-2 tw-self-end"
          >
            {isGenerating ? "Generating..." : "Generate URI"}
            {!isGenerating && <ArrowRight className="tw-size-4" />}
          </Button>
        </div>
      )}

      {/* Step 1: Copy Result */}
      {currentStep === 1 && (
        <div className="tw-flex tw-flex-col tw-gap-5">
          <div className="tw-flex tw-items-center tw-gap-2 tw-rounded-md tw-bg-[rgba(var(--color-green-rgb),0.1)] tw-p-3 tw-text-sm tw-text-[var(--color-green)]">
            <CheckCircle2 className="tw-size-4" />
            <span className="tw-font-medium">URI generated successfully</span>
          </div>

          <div className="tw-flex tw-items-start tw-gap-2 tw-rounded-md tw-bg-callout-warning/10 tw-p-3 tw-text-xs tw-text-callout-warning">
            <AlertTriangle className="tw-mt-0.5 tw-size-4 tw-shrink-0" />
            <span className="tw-leading-relaxed">
              This URI contains your encrypted API keys. It may be captured by clipboard managers,
              OS logs, or other apps. Share it securely and delete copies after use.
            </span>
          </div>

          <div className="tw-flex tw-flex-col tw-gap-1.5">
            <div className="tw-text-xs tw-text-muted">
              Copy this URI and open it in the target vault, or paste it into the Import dialog.
            </div>
            <CopyCodeBlock value={generatedURI} label="Copy URI" />
          </div>

          {generatedURI.length > URI_LENGTH_WARNING_THRESHOLD && (
            <div className="tw-flex tw-items-start tw-gap-2 tw-rounded-md tw-bg-callout-warning/10 tw-p-3 tw-text-xs tw-text-callout-warning">
              <AlertTriangle className="tw-mt-0.5 tw-size-4 tw-shrink-0" />
              <span>
                This Setup URI is very long and may not open via the OS protocol handler. Use the
                &quot;Payload Only&quot; field below to copy and paste into the Import dialog
                instead.
              </span>
            </div>
          )}

          <Collapsible>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className={cn(
                  "tw-flex tw-cursor-pointer tw-items-center tw-gap-2 tw-border-none tw-bg-transparent tw-p-0 tw-text-xs tw-text-muted tw-transition-colors hover:tw-text-normal",
                  "tw-group"
                )}
              >
                <ChevronDown className="tw-size-3.5 tw-transition-transform group-data-[state=open]:tw-rotate-180" />
                <span>Payload Only (for large configurations)</span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="tw-mt-3">
              <div className="tw-mb-2 tw-text-xs tw-text-muted">
                If the full URI is too long to open, paste this payload directly into the Import
                dialog.
              </div>
              <CopyCodeBlock value={extractPayloadFromUri(generatedURI)} label="Copy Payload" />
            </CollapsibleContent>
          </Collapsible>

          <Button
            variant="ghost"
            size="sm"
            onClick={reset}
            className="tw-gap-2 tw-self-start tw-text-muted"
          >
            <RotateCcw className="tw-size-3.5" />
            Start Over
          </Button>
        </div>
      )}
    </div>
  );
};
