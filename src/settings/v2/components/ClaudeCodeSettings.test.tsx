import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ClaudeCodeSettings } from "./ClaudeCodeSettings";
import { updateSetting } from "@/settings/model";

// Mock the settings module
jest.mock("@/settings/model", () => ({
  updateSetting: jest.fn(),
  useSettingsValue: jest.fn(),
}));

// Mock Obsidian Notice
jest.mock("obsidian", () => ({
  Notice: jest.fn(),
}));

// Mock child_process spawn
const mockSpawn = jest.fn();
(global as any).window = {
  require: jest.fn(() => ({
    spawn: mockSpawn,
  })),
};

describe("ClaudeCodeSettings", () => {
  const mockSettings = {
    claudeCode: {
      enabled: false,
      cliPath: "",
      autoDetected: false,
      model: "claude-3.5-sonnet",
      sessionMode: "continue",
      fallbackEnabled: true,
      timeout: 60000,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    const { useSettingsValue } = require("@/settings/model");
    useSettingsValue.mockReturnValue(mockSettings);
  });

  it("renders all settings components", () => {
    render(<ClaudeCodeSettings />);

    expect(screen.getByText("Claude Code Settings (Local)")).toBeInTheDocument();
    expect(screen.getByText("Enable Claude Code")).toBeInTheDocument();
    expect(screen.getByText("Claude CLI Path")).toBeInTheDocument();
    expect(screen.getByText("Model Selection")).toBeInTheDocument();
    expect(screen.getByText("Session Management")).toBeInTheDocument();
  });

  it("handles enable toggle", () => {
    render(<ClaudeCodeSettings />);

    const toggle = screen.getByLabelText("Enable Claude Code integration");
    fireEvent.click(toggle);

    expect(updateSetting).toHaveBeenCalledWith(
      "claudeCode",
      expect.objectContaining({
        enabled: true,
      })
    );
  });

  it("handles CLI path input", () => {
    render(<ClaudeCodeSettings />);

    const input = screen.getByLabelText("Claude CLI path");
    fireEvent.change(input, { target: { value: "/usr/local/bin/claude" } });

    expect(updateSetting).toHaveBeenCalledWith(
      "claudeCode",
      expect.objectContaining({
        cliPath: "/usr/local/bin/claude",
        autoDetected: false,
      })
    );
  });

  it("handles model selection", () => {
    render(<ClaudeCodeSettings />);

    const modelSelect = screen.getByRole("combobox");
    fireEvent.change(modelSelect, { target: { value: "claude-3-opus" } });

    expect(updateSetting).toHaveBeenCalledWith(
      "claudeCode",
      expect.objectContaining({
        model: "claude-3-opus",
      })
    );
  });

  it("handles session mode selection", () => {
    render(<ClaudeCodeSettings />);

    const newSessionRadio = screen.getByLabelText(/Start new session for each chat/);
    fireEvent.click(newSessionRadio);

    expect(updateSetting).toHaveBeenCalledWith(
      "claudeCode",
      expect.objectContaining({
        sessionMode: "new",
      })
    );
  });

  it("validates CLI path successfully", async () => {
    const mockStdout = {
      on: jest.fn((event, callback) => {
        if (event === "data") {
          callback(Buffer.from("claude version 1.0.0"));
        }
      }),
    };

    const mockChild = {
      stdout: mockStdout,
      on: jest.fn((event, callback) => {
        if (event === "close") {
          callback(0);
        }
      }),
    };

    mockSpawn.mockReturnValue(mockChild);

    // Enable Claude Code first
    const enabledSettings = {
      ...mockSettings,
      claudeCode: { ...mockSettings.claudeCode, enabled: true, cliPath: "/usr/local/bin/claude" },
    };

    const { useSettingsValue } = require("@/settings/model");
    useSettingsValue.mockReturnValue(enabledSettings);

    render(<ClaudeCodeSettings />);

    const validateButton = screen.getByText("Validate");
    fireEvent.click(validateButton);

    await waitFor(() => {
      expect(screen.getByText(/✓ Claude Code detected/)).toBeInTheDocument();
    });
  });

  it("handles CLI path validation failure", async () => {
    const mockChild = {
      stdout: null,
      on: jest.fn((event, callback) => {
        if (event === "error") {
          callback(new Error("Command not found"));
        }
      }),
    };

    mockSpawn.mockReturnValue(mockChild);

    // Enable Claude Code first
    const enabledSettings = {
      ...mockSettings,
      claudeCode: { ...mockSettings.claudeCode, enabled: true, cliPath: "/invalid/path" },
    };

    const { useSettingsValue } = require("@/settings/model");
    useSettingsValue.mockReturnValue(enabledSettings);

    render(<ClaudeCodeSettings />);

    const validateButton = screen.getByText("Validate");
    fireEvent.click(validateButton);

    await waitFor(() => {
      expect(screen.getByText(/✗ Claude Code not found at this path/)).toBeInTheDocument();
    });
  });

  it("disables inputs when Claude Code is disabled", () => {
    render(<ClaudeCodeSettings />);

    const pathInput = screen.getByLabelText("Claude CLI path");
    const modelSelect = screen.getByRole("combobox");
    const sessionRadios = screen.getAllByRole("radio");

    expect(pathInput).toBeDisabled();
    expect(modelSelect).toBeDisabled();
    sessionRadios.forEach((radio) => {
      expect(radio).toBeDisabled();
    });
  });

  it("shows advanced options", () => {
    render(<ClaudeCodeSettings />);

    const advancedSummary = screen.getByText("Advanced Options");
    fireEvent.click(advancedSummary);

    expect(screen.getByText("Enable Fallback Mode")).toBeInTheDocument();
    expect(screen.getByText("Response Timeout")).toBeInTheDocument();
  });

  it("handles timeout setting", () => {
    render(<ClaudeCodeSettings />);

    // Open advanced options
    const advancedSummary = screen.getByText("Advanced Options");
    fireEvent.click(advancedSummary);

    const timeoutInput = screen.getByDisplayValue("60"); // 60000ms / 1000
    fireEvent.change(timeoutInput, { target: { value: "120" } });

    expect(updateSetting).toHaveBeenCalledWith(
      "claudeCode",
      expect.objectContaining({
        timeout: 120000,
      })
    );
  });
});
