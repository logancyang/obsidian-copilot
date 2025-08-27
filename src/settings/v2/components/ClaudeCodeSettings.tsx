import React, { useState, useEffect } from "react";
import { SettingItem } from "@/components/ui/setting-item";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { Notice } from "obsidian";
// Note: spawn will be accessed from the Electron context in Obsidian
import { AlertCircle, CheckCircle2, Loader2, Search, Settings2 } from "lucide-react";

interface ClaudeModel {
  value: string;
  label: string;
  description: string;
}

const CLAUDE_MODELS: ClaudeModel[] = [
  {
    value: "claude-3.5-sonnet",
    label: "Claude 3.5 Sonnet",
    description: "Most capable model with excellent reasoning",
  },
  {
    value: "claude-3-opus",
    label: "Claude 3 Opus",
    description: "Largest context window for complex tasks",
  },
  {
    value: "claude-3-haiku",
    label: "Claude 3 Haiku",
    description: "Fastest responses for simple tasks",
  },
];

interface ValidationStatus {
  type: "success" | "error" | "checking" | "idle";
  message: string;
}

export const ClaudeCodeSettings: React.FC = () => {
  const settings = useSettingsValue();
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<ValidationStatus>({
    type: "idle",
    message: "",
  });

  // Initialize Claude Code config if not present
  const claudeConfig = settings.claudeCode || {
    enabled: false,
    cliPath: "",
    autoDetected: false,
    model: "claude-3.5-sonnet" as const,
    sessionMode: "continue" as const,
    fallbackEnabled: true,
    timeout: 60000,
  };

  // Persist initial config if not present
  useEffect(() => {
    if (!settings.claudeCode) {
      updateSetting("claudeCode", claudeConfig);
    }
  }, []);

  const handleConfigChange = (updates: Partial<typeof claudeConfig>) => {
    const newConfig = { ...claudeConfig, ...updates };
    updateSetting("claudeCode", newConfig);
  };

  const validateCliPath = async (path: string): Promise<ValidationStatus> => {
    if (!path) {
      return { type: "error", message: "Please provide a CLI path" };
    }

    try {
      // Use Node.js child_process through Electron's context
      const { spawn } = (window as any).require("child_process");

      return new Promise((resolve) => {
        const child = spawn(path, ["--version"], {
          timeout: 5000,
          shell: process.platform === "win32",
        });

        let output = "";
        child.stdout?.on("data", (data: Buffer) => {
          output += data.toString();
        });

        child.on("close", (code: number) => {
          if (code === 0 && output.toLowerCase().includes("claude")) {
            resolve({
              type: "success",
              message: `✓ Claude Code detected: ${output.trim()}`,
            });
          } else {
            resolve({
              type: "error",
              message: "✗ Claude Code not responding at this path",
            });
          }
        });

        child.on("error", () => {
          resolve({
            type: "error",
            message: "✗ Claude Code not found at this path",
          });
        });
      });
    } catch (error: any) {
      // Fallback for when spawn is not available
      return {
        type: "error",
        message: "✗ CLI validation requires desktop Obsidian app",
      };
    }
  };

  const handleValidatePath = async () => {
    setIsValidating(true);
    setValidationStatus({ type: "checking", message: "Checking Claude CLI..." });

    const result = await validateCliPath(claudeConfig.cliPath);
    setValidationStatus(result);
    setIsValidating(false);

    if (result.type === "success") {
      new Notice("Claude Code validated successfully!", 3000);
    } else {
      new Notice(`Validation failed: ${result.message}`, 5000);
    }
  };

  const handleAutoDetect = async () => {
    setIsValidating(true);
    setValidationStatus({ type: "checking", message: "Auto-detecting Claude CLI..." });

    // Common CLI locations to check
    const commonPaths =
      process.platform === "win32"
        ? [
            "claude",
            "C:\\Program Files\\Claude\\claude.exe",
            "C:\\Program Files (x86)\\Claude\\claude.exe",
            `${process.env.LOCALAPPDATA}\\Claude\\claude.exe`,
          ]
        : [
            "claude",
            "/usr/local/bin/claude",
            "/usr/bin/claude",
            "/opt/claude/bin/claude",
            `${process.env.HOME}/.local/bin/claude`,
            `${process.env.HOME}/bin/claude`,
          ];

    for (const path of commonPaths) {
      const result = await validateCliPath(path);
      if (result.type === "success") {
        handleConfigChange({
          cliPath: path,
          autoDetected: true,
        });
        setValidationStatus(result);
        setIsValidating(false);
        new Notice(`Claude Code auto-detected at: ${path}`, 4000);
        return;
      }
    }

    setValidationStatus({
      type: "error",
      message: "✗ Could not auto-detect Claude Code. Please enter the path manually.",
    });
    setIsValidating(false);
    new Notice("Could not auto-detect Claude Code. Please enter the path manually.", 5000);
  };

  const getStatusIcon = () => {
    switch (validationStatus.type) {
      case "success":
        return <CheckCircle2 className="tw-size-5 tw-text-success" />;
      case "error":
        return <AlertCircle className="tw-text-destructive tw-size-5" />;
      case "checking":
        return <Loader2 className="tw-size-5 tw-animate-spin" />;
      default:
        return null;
    }
  };

  return (
    <div className="tw-space-y-4">
      <section>
        <div className="tw-mb-3 tw-flex tw-items-center tw-gap-2 tw-text-xl tw-font-bold">
          <Settings2 className="tw-size-5" />
          Claude Code Settings (Local)
        </div>

        <div className="tw-space-y-4">
          {/* Enable Claude Code Toggle */}
          <SettingItem
            type="switch"
            title="Enable Claude Code"
            description="Use local Claude CLI instead of cloud API for AI assistance"
            checked={claudeConfig.enabled}
            onCheckedChange={(checked: boolean) => handleConfigChange({ enabled: checked })}
          />

          {/* CLI Path Configuration */}
          <SettingItem
            type="custom"
            title="Claude CLI Path"
            description="Path to the Claude Code CLI executable"
          >
            <div className="tw-space-y-2">
              <div className="tw-flex tw-gap-2">
                <Input
                  type="text"
                  value={claudeConfig.cliPath}
                  onChange={(e) =>
                    handleConfigChange({
                      cliPath: e.target.value,
                      autoDetected: false,
                    })
                  }
                  placeholder="/usr/local/bin/claude"
                  className="tw-flex-1"
                  aria-label="Claude CLI path"
                  disabled={!claudeConfig.enabled}
                />
                <Button
                  onClick={handleAutoDetect}
                  disabled={!claudeConfig.enabled || isValidating}
                  size="sm"
                  variant="secondary"
                >
                  {isValidating && validationStatus.type === "checking" ? (
                    <Loader2 className="tw-size-4 tw-animate-spin" />
                  ) : (
                    <Search className="tw-size-4" />
                  )}
                  <span className="tw-ml-2">Auto-detect</span>
                </Button>
                <Button
                  onClick={handleValidatePath}
                  disabled={!claudeConfig.enabled || !claudeConfig.cliPath || isValidating}
                  size="sm"
                >
                  Validate
                </Button>
              </div>

              {validationStatus.message && (
                <div
                  className={`tw-flex tw-items-center tw-gap-2 tw-text-sm ${
                    validationStatus.type === "success"
                      ? "tw-text-success"
                      : validationStatus.type === "error"
                        ? "tw-text-destructive"
                        : "tw-text-muted"
                  }`}
                >
                  {getStatusIcon()}
                  <span>{validationStatus.message}</span>
                </div>
              )}
            </div>
          </SettingItem>

          {/* Model Selection */}
          <SettingItem
            type="custom"
            title="Model Selection"
            description="Choose the Claude model to use for AI assistance"
          >
            <Select
              value={claudeConfig.model}
              onValueChange={(value: string) =>
                handleConfigChange({
                  model: value as "claude-3.5-sonnet" | "claude-3-opus" | "claude-3-haiku",
                })
              }
              disabled={!claudeConfig.enabled}
            >
              <SelectTrigger className="tw-w-full">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {CLAUDE_MODELS.map((model) => (
                  <SelectItem key={model.value} value={model.value}>
                    <div className="tw-flex tw-flex-col">
                      <span className="tw-font-medium">{model.label}</span>
                      <span className="tw-text-xs tw-text-muted">{model.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingItem>

          {/* Session Management */}
          <SettingItem
            type="custom"
            title="Session Management"
            description="Configure how Claude Code manages conversation sessions"
          >
            <RadioGroup
              value={claudeConfig.sessionMode}
              onValueChange={(value: string) =>
                handleConfigChange({ sessionMode: value as "new" | "continue" })
              }
              disabled={!claudeConfig.enabled}
            >
              <div className="tw-flex tw-items-center tw-space-x-2">
                <RadioGroupItem value="new" />
                <Label htmlFor="session-new" className="tw-cursor-pointer">
                  Start new session for each chat
                  <span className="tw-mt-1 tw-block tw-text-xs tw-text-muted">
                    Each conversation starts fresh without previous context
                  </span>
                </Label>
              </div>
              <div className="tw-mt-3 tw-flex tw-items-center tw-space-x-2">
                <RadioGroupItem value="continue" />
                <Label htmlFor="session-continue" className="tw-cursor-pointer">
                  Continue previous session
                  <span className="tw-mt-1 tw-block tw-text-xs tw-text-muted">
                    Maintain context across conversations in the same workspace
                  </span>
                </Label>
              </div>
            </RadioGroup>
          </SettingItem>

          {/* Advanced Options */}
          <details className="tw-mt-4">
            <summary className="tw-cursor-pointer tw-text-sm tw-font-medium tw-text-muted hover:tw-text-normal">
              Advanced Options
            </summary>

            <div className="tw-mt-3 tw-space-y-4 tw-pl-4">
              {/* Fallback Mode */}
              <SettingItem
                type="switch"
                title="Enable Fallback Mode"
                description="Fall back to cloud API if Claude Code is unavailable"
                checked={claudeConfig.fallbackEnabled}
                onCheckedChange={(checked: boolean) =>
                  handleConfigChange({ fallbackEnabled: checked })
                }
                disabled={!claudeConfig.enabled}
              />

              {/* Timeout Setting */}
              <SettingItem
                type="custom"
                title="Response Timeout"
                description="Maximum time to wait for Claude Code response (in seconds)"
              >
                <Input
                  type="number"
                  min="10"
                  max="300"
                  value={claudeConfig.timeout / 1000}
                  onChange={(e) =>
                    handleConfigChange({
                      timeout: parseInt(e.target.value) * 1000,
                    })
                  }
                  className="tw-w-24"
                  disabled={!claudeConfig.enabled}
                />
              </SettingItem>
            </div>
          </details>
        </div>
      </section>
    </div>
  );
};
