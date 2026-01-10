/**
 * Claude Code Settings Tab
 *
 * Settings component for configuring Claude Code mode, including:
 * - Enable/disable toggle
 * - CLI path configuration with auto-detection
 * - Model selection
 * - Permission mode
 * - Allowed paths and blocked commands
 * - Diff display settings
 * - Extended thinking budget
 */

import React, { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Input } from "@/components/ui/input";
import { SettingItem } from "@/components/ui/setting-item";
import { Textarea } from "@/components/ui/textarea";
import { findClaudeCliPath, getClaudeCliVersion } from "@/core/claudeCode/cliDetection";
import { logInfo, logError } from "@/logger";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { CheckCircle, XCircle, Loader2, Search, Terminal } from "lucide-react";
import { Notice } from "obsidian";

/**
 * Claude Code model options
 */
const CLAUDE_CODE_MODELS = [
  { label: "Claude Sonnet 4", value: "claude-sonnet-4-20250514" },
  { label: "Claude Opus 4", value: "claude-opus-4-20250514" },
] as const;

/**
 * Permission mode options
 */
const PERMISSION_MODES = [
  { label: "Approval Required", value: "approval" },
  { label: "YOLO (Auto-approve)", value: "yolo" },
] as const;

/**
 * Max thinking token options
 */
const MAX_THINKING_TOKEN_OPTIONS = [
  { label: "5,000 tokens", value: 5000 },
  { label: "10,000 tokens", value: 10000 },
  { label: "20,000 tokens", value: 20000 },
  { label: "50,000 tokens", value: 50000 },
  { label: "100,000 tokens", value: 100000 },
] as const;

/**
 * CLI path validation status
 */
type CliPathStatus = "unknown" | "checking" | "valid" | "invalid";

/**
 * Claude Code Settings Tab Component
 */
export const ClaudeCodeSettings: React.FC = () => {
  const settings = useSettingsValue();
  const [cliPathStatus, setCliPathStatus] = useState<CliPathStatus>("unknown");
  const [cliVersion, setCliVersion] = useState<string | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);

  /**
   * Validate the current CLI path
   */
  const validateCliPath = useCallback(async (path: string) => {
    if (!path) {
      setCliPathStatus("unknown");
      setCliVersion(null);
      return;
    }

    setCliPathStatus("checking");

    try {
      const version = await getClaudeCliVersion(path);
      if (version) {
        setCliPathStatus("valid");
        setCliVersion(version);
        logInfo(`[ClaudeCodeSettings] CLI path validated: ${path} (${version})`);
      } else {
        setCliPathStatus("invalid");
        setCliVersion(null);
        logInfo(`[ClaudeCodeSettings] CLI path invalid: ${path}`);
      }
    } catch (error) {
      setCliPathStatus("invalid");
      setCliVersion(null);
      logError("[ClaudeCodeSettings] Error validating CLI path:", error);
    }
  }, []);

  /**
   * Auto-detect CLI path
   */
  const handleDetectCliPath = useCallback(async () => {
    setIsDetecting(true);

    try {
      logInfo("[ClaudeCodeSettings] Auto-detecting CLI path...");
      const detectedPath = await findClaudeCliPath();

      if (detectedPath) {
        updateSetting("claudeCodeCliPath", detectedPath);
        new Notice(`Claude CLI found at: ${detectedPath}`);

        // Validate the detected path
        await validateCliPath(detectedPath);
      } else {
        new Notice("Claude CLI not found. Please install Claude CLI or specify the path manually.");
        setCliPathStatus("invalid");
      }
    } catch (error) {
      logError("[ClaudeCodeSettings] Error detecting CLI path:", error);
      new Notice("Error detecting Claude CLI. Check console for details.");
      setCliPathStatus("invalid");
    } finally {
      setIsDetecting(false);
    }
  }, [validateCliPath]);

  /**
   * Handle CLI path change
   */
  const handleCliPathChange = useCallback(
    (value: string) => {
      updateSetting("claudeCodeCliPath", value);
      // Validate after a short delay
      const timeoutId = setTimeout(() => {
        validateCliPath(value);
      }, 500);
      return () => clearTimeout(timeoutId);
    },
    [validateCliPath]
  );

  /**
   * Parse multi-line text to array
   */
  const parseMultilineToArray = (text: string): string[] => {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  };

  /**
   * Convert array to multi-line text
   */
  const arrayToMultiline = (arr: string[]): string => {
    return arr.join("\n");
  };

  /**
   * Render CLI path status indicator
   */
  const renderCliPathStatus = () => {
    switch (cliPathStatus) {
      case "checking":
        return <Loader2 className="tw-size-4 tw-animate-spin tw-text-muted" />;
      case "valid":
        return (
          <div className="tw-flex tw-items-center tw-gap-1.5 tw-text-success">
            <CheckCircle className="tw-size-4" />
            <span className="tw-text-xs">{cliVersion || "Valid"}</span>
          </div>
        );
      case "invalid":
        return (
          <div className="tw-flex tw-items-center tw-gap-1.5 tw-text-error">
            <XCircle className="tw-size-4" />
            <span className="tw-text-xs">Invalid path</span>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="tw-space-y-4">
      {/* Overview Section */}
      <section>
        <div className="tw-mb-3 tw-flex tw-items-center tw-gap-2">
          <Terminal className="tw-size-5" />
          <span className="tw-text-xl tw-font-bold">Claude Code</span>
          <span className="tw-rounded-sm tw-bg-interactive-accent tw-px-1.5 tw-py-0.5 tw-text-xs tw-text-on-accent">
            Beta
          </span>
        </div>
        <p className="tw-mb-4 tw-text-sm tw-text-muted">
          Claude Code mode enables agentic coding workflows using the Claude CLI. It provides direct
          access to file system operations, terminal commands, and advanced AI capabilities for
          software development tasks.
        </p>

        <div className="tw-space-y-4">
          <SettingItem
            type="switch"
            title="Enable Claude Code"
            description={
              <div className="tw-flex tw-items-center tw-gap-1.5">
                <span className="tw-leading-none">
                  Enable Claude Code mode for agentic coding workflows
                </span>
                <HelpTooltip
                  content={
                    <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2 tw-py-4">
                      <div className="tw-text-sm tw-font-medium tw-text-accent">
                        Requires Claude CLI
                      </div>
                      <div className="tw-text-xs tw-text-muted">
                        Claude Code requires the Claude CLI to be installed on your system. Install
                        it from{" "}
                        <a
                          href="https://docs.anthropic.com/en/docs/claude-cli"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="tw-text-accent hover:tw-underline"
                        >
                          Anthropic docs
                        </a>
                        .
                      </div>
                    </div>
                  }
                />
              </div>
            }
            checked={settings.claudeCodeEnabled}
            onCheckedChange={(checked) => updateSetting("claudeCodeEnabled", checked)}
          />
        </div>
      </section>

      {/* CLI Configuration Section */}
      {settings.claudeCodeEnabled && (
        <>
          <section>
            <div className="tw-mb-3 tw-text-lg tw-font-semibold">CLI Configuration</div>
            <div className="tw-space-y-4">
              <SettingItem
                type="custom"
                title="CLI Path"
                description={
                  <div className="tw-flex tw-items-center tw-gap-1.5">
                    <span className="tw-leading-none">
                      Path to Claude CLI executable (leave empty for auto-detection)
                    </span>
                    <HelpTooltip
                      content={
                        <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2 tw-py-4">
                          <div className="tw-text-sm tw-font-medium tw-text-accent">
                            Common installation paths:
                          </div>
                          <ul className="tw-pl-4 tw-text-xs tw-text-muted">
                            <li>~/.claude/local/claude (macOS/Linux)</li>
                            <li>/usr/local/bin/claude (Homebrew)</li>
                            <li>%LOCALAPPDATA%\Claude\claude.exe (Windows)</li>
                          </ul>
                        </div>
                      }
                    />
                  </div>
                }
              >
                <div className="tw-flex tw-flex-col tw-gap-2 sm:tw-w-[320px]">
                  <div className="tw-flex tw-items-center tw-gap-2">
                    <Input
                      type="text"
                      placeholder="Auto-detect or enter path..."
                      value={settings.claudeCodeCliPath}
                      onChange={(e) => handleCliPathChange(e.target.value)}
                      className="tw-flex-1"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleDetectCliPath}
                      disabled={isDetecting}
                    >
                      {isDetecting ? (
                        <Loader2 className="tw-size-4 tw-animate-spin" />
                      ) : (
                        <Search className="tw-size-4" />
                      )}
                      <span className="tw-ml-1">Detect</span>
                    </Button>
                  </div>
                  <div className="tw-flex tw-h-5 tw-items-center tw-justify-end">
                    {renderCliPathStatus()}
                  </div>
                </div>
              </SettingItem>

              <SettingItem
                type="select"
                title="Model"
                description="Select the Claude model to use for Claude Code"
                value={settings.claudeCodeModel}
                onChange={(value) =>
                  updateSetting(
                    "claudeCodeModel",
                    value as "claude-sonnet-4-20250514" | "claude-opus-4-20250514"
                  )
                }
                options={CLAUDE_CODE_MODELS.map((m) => ({ label: m.label, value: m.value }))}
              />

              <SettingItem
                type="select"
                title="Permission Mode"
                description={
                  <div className="tw-flex tw-items-center tw-gap-1.5">
                    <span className="tw-leading-none">How Claude Code handles tool approvals</span>
                    <HelpTooltip
                      content={
                        <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2 tw-py-4">
                          <ul className="tw-pl-4 tw-text-sm tw-text-muted">
                            <li>
                              <strong>Approval Required:</strong> Prompts for confirmation before
                              executing potentially dangerous operations
                            </li>
                            <li>
                              <strong>YOLO:</strong> Auto-approves all tool executions (use with
                              caution)
                            </li>
                          </ul>
                        </div>
                      }
                    />
                  </div>
                }
                value={settings.claudeCodePermissionMode}
                onChange={(value) =>
                  updateSetting("claudeCodePermissionMode", value as "yolo" | "approval")
                }
                options={PERMISSION_MODES.map((m) => ({ label: m.label, value: m.value }))}
              />
            </div>
          </section>

          {/* Security Section */}
          <section>
            <div className="tw-mb-3 tw-text-lg tw-font-semibold">Security</div>
            <div className="tw-space-y-4">
              <SettingItem
                type="custom"
                title="Allowed Paths"
                description={
                  <div className="tw-flex tw-items-center tw-gap-1.5">
                    <span className="tw-leading-none">
                      Additional paths Claude Code can access (one per line)
                    </span>
                    <HelpTooltip
                      content={
                        <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2 tw-py-4">
                          <div className="tw-text-sm tw-font-medium tw-text-accent">
                            Path Restrictions
                          </div>
                          <div className="tw-text-xs tw-text-muted">
                            By default, Claude Code can only access files within your vault. Add
                            additional paths here if you need to work with files outside the vault.
                          </div>
                        </div>
                      }
                    />
                  </div>
                }
              >
                <Textarea
                  value={arrayToMultiline(settings.claudeCodeAllowedPaths)}
                  onChange={(e) =>
                    updateSetting("claudeCodeAllowedPaths", parseMultilineToArray(e.target.value))
                  }
                  placeholder="/path/to/allowed/directory&#10;/another/allowed/path"
                  rows={4}
                  className="tw-w-full tw-font-mono tw-text-xs sm:tw-w-[320px]"
                />
              </SettingItem>

              <SettingItem
                type="custom"
                title="Blocked Commands"
                description={
                  <div className="tw-flex tw-items-center tw-gap-1.5">
                    <span className="tw-leading-none">
                      Dangerous command patterns to block (one per line)
                    </span>
                    <HelpTooltip
                      content={
                        <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2 tw-py-4">
                          <div className="tw-text-sm tw-font-medium tw-text-accent">
                            Command Blocklist
                          </div>
                          <div className="tw-text-xs tw-text-muted">
                            Commands containing these patterns will be blocked from execution. This
                            provides an extra layer of protection against accidental destructive
                            operations.
                          </div>
                        </div>
                      }
                    />
                  </div>
                }
              >
                <Textarea
                  value={arrayToMultiline(settings.claudeCodeBlockedCommands)}
                  onChange={(e) =>
                    updateSetting(
                      "claudeCodeBlockedCommands",
                      parseMultilineToArray(e.target.value)
                    )
                  }
                  placeholder="rm -rf /&#10;sudo rm&#10;:(){:|:&};:"
                  rows={5}
                  className="tw-w-full tw-font-mono tw-text-xs sm:tw-w-[320px]"
                />
              </SettingItem>
            </div>
          </section>

          {/* Display Section */}
          <section>
            <div className="tw-mb-3 tw-text-lg tw-font-semibold">Display</div>
            <div className="tw-space-y-4">
              <SettingItem
                type="switch"
                title="Enable Diff Display"
                description="Show file diffs for Write and Edit operations in the chat"
                checked={settings.claudeCodeEnableDiffDisplay}
                onCheckedChange={(checked) => updateSetting("claudeCodeEnableDiffDisplay", checked)}
              />

              <SettingItem
                type="select"
                title="Max Thinking Tokens"
                description={
                  <div className="tw-flex tw-items-center tw-gap-1.5">
                    <span className="tw-leading-none">Budget for extended thinking</span>
                    <HelpTooltip
                      content={
                        <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2 tw-py-4">
                          <div className="tw-text-sm tw-font-medium tw-text-accent">
                            Extended Thinking
                          </div>
                          <div className="tw-text-xs tw-text-muted">
                            Higher values allow Claude to think more deeply about complex problems,
                            but increase latency and token usage. For most tasks, 10,000 tokens is
                            sufficient.
                          </div>
                        </div>
                      }
                    />
                  </div>
                }
                value={settings.claudeCodeMaxThinkingTokens.toString()}
                onChange={(value) =>
                  updateSetting("claudeCodeMaxThinkingTokens", parseInt(value, 10))
                }
                options={MAX_THINKING_TOKEN_OPTIONS.map((opt) => ({
                  label: opt.label,
                  value: opt.value.toString(),
                }))}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
};
