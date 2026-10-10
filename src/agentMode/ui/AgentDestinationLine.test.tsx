import { AgentDestinationLine, resolveDataDestination } from "@/agentMode/ui/AgentDestinationLine";
import type { AgentModelPickerOverride } from "@/agentMode/ui/useAgentModelPicker";
import type { CopilotSettings } from "@/settings/model";
import { render, screen } from "@testing-library/react";
import React from "react";

const SERVER_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "OPENAI_BASE_URL",
];
const savedEnv = SERVER_ENV_KEYS.map((key) => [key, process.env[key]] as const);

const settings = {
  agentMode: { backends: {} },
  providers: {
    plus: {
      providerId: "plus",
      providerType: "openai-compatible",
      displayName: "Copilot Plus",
      origin: { kind: "copilot-plus" },
      addedAt: 0,
    },
  },
} as unknown as CopilotSettings;

function picker(backendId: string, name: string): AgentModelPickerOverride {
  return {
    models: [
      { name: "other", provider: "agent", enabled: true, isBuiltIn: false, _backendId: "codex" },
      { name, provider: "agent", enabled: true, isBuiltIn: false, _backendId: backendId },
    ],
    value: `${backendId}:${name}|agent`,
    onChange: jest.fn(),
  };
}

describe("AgentDestinationLine", () => {
  beforeEach(() => {
    for (const key of SERVER_ENV_KEYS) delete process.env[key];
  });
  afterEach(() => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe("resolveDataDestination()", () => {
    it.each([
      ["claude", "sonnet", "Claude Code (Anthropic)"],
      ["codex", "gpt-5.5", "Codex (OpenAI)"],
      ["opencode", "copilot-plus/copilot-plus-flash", "Copilot Plus (Brevilabs, US)"],
    ])(
      "names the destination of the selected %s model for https://github.com/logancyang/obsidian-copilot/issues/2889",
      (backendId, name, expected) => {
        expect(resolveDataDestination(picker(backendId, name), settings)).toBe(expected);
      }
    );

    it("names nothing without a selected agent model", () => {
      expect(resolveDataDestination(null, settings)).toBeNull();
      expect(
        resolveDataDestination({ ...picker("claude", "sonnet"), value: "missing" }, settings)
      ).toBeNull();
    });
  });

  describe("AgentDestinationLine()", () => {
    it("states what is sent and where", () => {
      render(<AgentDestinationLine destination="Codex (OpenAI)" />);
      expect(
        screen.getByText(
          "Your message, notes the agent reads, and tool results go to Codex (OpenAI)."
        )
      ).toBeTruthy();
    });
  });
});
