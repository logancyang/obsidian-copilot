import { resetSettings } from "@/settings/model";
import {
  setDefaultSystemPromptTitle,
  setDisableBuiltinSystemPrompt,
  setSelectedPromptTitle,
  updateCachedSystemPrompts,
} from "@/system-prompts/state";
import type { UserSystemPrompt } from "@/system-prompts/type";
import { buildAgentSystemPrompt, COPILOT_PROMPT_BASE } from "./agentSystemPrompt";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

function makePrompt(title: string, content: string): UserSystemPrompt {
  return { title, content, createdMs: 0, modifiedMs: 0, lastUsedMs: 0 };
}

/** The system-prompt jotai store is independent of settings — reset it explicitly. */
function resetPromptState(): void {
  setDisableBuiltinSystemPrompt(false);
  setSelectedPromptTitle("");
  setDefaultSystemPromptTitle("");
  updateCachedSystemPrompts([]);
}

describe("buildAgentSystemPrompt", () => {
  beforeEach(() => {
    resetSettings();
    resetPromptState();
  });

  it("includes the Copilot base prompt and the pill-syntax directive by default", () => {
    const prompt = buildAgentSystemPrompt();
    expect(prompt.startsWith(COPILOT_PROMPT_BASE)).toBe(true);
    expect(prompt).toContain("{folder_name}");
    expect(prompt).toContain("{activeNote}");
    // No custom prompt selected → no user block.
    expect(prompt).not.toContain("<user_custom_instructions>");
  });

  it("appends the selected user custom prompt wrapped in <user_custom_instructions>", () => {
    updateCachedSystemPrompts([makePrompt("Haiku", "respond in haiku")]);
    setSelectedPromptTitle("Haiku");
    const prompt = buildAgentSystemPrompt();
    expect(prompt).toContain(COPILOT_PROMPT_BASE);
    expect(prompt).toContain(
      "<user_custom_instructions>\nrespond in haiku\n</user_custom_instructions>"
    );
  });

  it("falls back to the global default prompt when no session prompt is selected", () => {
    updateCachedSystemPrompts([makePrompt("Terse", "be terse")]);
    setDefaultSystemPromptTitle("Terse");
    const prompt = buildAgentSystemPrompt();
    expect(prompt).toContain("be terse");
  });

  it("suppresses the base prompt when 'disable builtin' is on, keeping the user prompt + pill directive", () => {
    updateCachedSystemPrompts([makePrompt("Haiku", "respond in haiku")]);
    setSelectedPromptTitle("Haiku");
    setDisableBuiltinSystemPrompt(true);
    const prompt = buildAgentSystemPrompt();
    expect(prompt).not.toContain(COPILOT_PROMPT_BASE);
    expect(prompt).not.toContain("You are Obsidian Copilot");
    expect(prompt).toContain("respond in haiku");
    // The pill directive is functional wiring, not builtin framing — always sent.
    expect(prompt).toContain("{folder_name}");
  });

  it("omits the user block when no user prompt is set, even with builtin disabled", () => {
    setDisableBuiltinSystemPrompt(true);
    const prompt = buildAgentSystemPrompt();
    expect(prompt).not.toContain(COPILOT_PROMPT_BASE);
    expect(prompt).not.toContain("<user_custom_instructions>");
    expect(prompt).toContain("{folder_name}");
  });
});

describe("COPILOT_PROMPT_BASE", () => {
  it("establishes Obsidian Copilot identity, not a CLI/coding agent", () => {
    expect(COPILOT_PROMPT_BASE).toMatch(/Obsidian Copilot/);
    expect(COPILOT_PROMPT_BASE).toMatch(/NOT a software-engineering agent or CLI coding tool/);
  });

  it("does not carry chat-mode-only baggage that misfires in tool-driven agents", () => {
    expect(COPILOT_PROMPT_BASE).not.toMatch(/@vault/);
    expect(COPILOT_PROMPT_BASE).not.toMatch(/getCurrentTime/);
    expect(COPILOT_PROMPT_BASE).not.toMatch(/getTimeRangeMs/);
    expect(COPILOT_PROMPT_BASE).not.toMatch(/YouTube/);
  });

  it("ports AGENT_LOOP_GUIDANCE behavior bullets", () => {
    expect(COPILOT_PROMPT_BASE).toMatch(/NEVER search for the same/);
  });

  it("renders note titles as bare [[wikilinks]], never backticked (v3 rule 7)", () => {
    expect(COPILOT_PROMPT_BASE).toMatch(
      /note titles[^\n]*\[\[title\]\][^\n]*never wrap them in backticks/i
    );
  });

  it("renders image links without wrapping them in backticks (v3 rules 8-9)", () => {
    expect(COPILOT_PROMPT_BASE).toMatch(/!\[\[link\]\][^\n]*never wrap them in backticks/i);
    expect(COPILOT_PROMPT_BASE).toMatch(/!\[alt\]\(url\)[^\n]*never wrap them in backticks/i);
  });

  it("ports the v3 GitHub-table heading convention (rule 10)", () => {
    expect(COPILOT_PROMPT_BASE).toContain("immediately add ` |` after the table heading");
  });

  it("retains the LaTeX and bullet-list formatting rules", () => {
    expect(COPILOT_PROMPT_BASE).toMatch(/\$\.\.\.\$/);
    expect(COPILOT_PROMPT_BASE).toContain("Never use `*` for bullets");
  });
});
