import { resetSettings, updateSetting } from "@/settings/model";
import {
  setDefaultSystemPromptTitle,
  setDisableBuiltinSystemPrompt,
  setSelectedPromptTitle,
  updateCachedSystemPrompts,
} from "@/system-prompts/state";
import type { UserSystemPrompt } from "@/system-prompts/type";
import { shouldUseMiyo } from "@/miyo/miyoUtils";
import {
  buildAgentSystemPrompt,
  COPILOT_MIYO_SEARCH_STEERING,
  COPILOT_PLUS_TOOLS_STEERING,
  COPILOT_PROMPT_BASE,
} from "./agentSystemPrompt";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

// The Miyo steering is gated on `shouldUseMiyo`; mock it so tests can flip the
// gate without standing up self-host validation state.
jest.mock("@/miyo/miyoUtils", () => ({
  shouldUseMiyo: jest.fn(() => false),
}));

const mockShouldUseMiyo = shouldUseMiyo as jest.MockedFunction<typeof shouldUseMiyo>;

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
    mockShouldUseMiyo.mockReturnValue(false);
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

  it("steers toward the builtin Copilot Plus skills regardless of Plus status", () => {
    // Default settings → NOT a Plus user; steering must still be present so a
    // self-host user (Plus-enabled but isPlusUser=false) gets it, and non-Plus
    // users fall back to their own tools via the steering's fallback clause.
    const nonPlus = buildAgentSystemPrompt();
    expect(nonPlus).toContain(COPILOT_PLUS_TOOLS_STEERING);
    expect(nonPlus).toContain("copilot-web-search");
    expect(nonPlus).toContain("copilot-web-fetch");
    expect(nonPlus).toContain("copilot-read-pdf");
    expect(nonPlus).toContain("copilot-youtube-transcript");
    expect(nonPlus).toContain("copilot-fetch-x");
    // Fallback clause so a missing/unlicensed skill never dead-ends or blocks
    // a free user — it routes the agent to its own equivalent tool instead.
    expect(nonPlus).toMatch(/silently fall back to your own equivalent tool/i);
    expect(nonPlus).toMatch(/never refuse and never block the user/i);
    // Fallback also covers a skill that runs but fails for this request (e.g. a
    // page the relay can't fetch), so a single bad input doesn't dead-end it.
    expect(nonPlus).toMatch(/fails for this particular request/i);

    // A Plus user gets the same steering.
    updateSetting("isPlusUser", true);
    expect(buildAgentSystemPrompt()).toContain(COPILOT_PLUS_TOOLS_STEERING);
  });

  it("suppresses the steering when the builtin prompt is disabled", () => {
    setDisableBuiltinSystemPrompt(true);
    const prompt = buildAgentSystemPrompt();
    expect(prompt).not.toContain(COPILOT_PLUS_TOOLS_STEERING);
  });

  it("omits the Miyo steering when Miyo is not in use", () => {
    mockShouldUseMiyo.mockReturnValue(false);
    const prompt = buildAgentSystemPrompt();
    expect(prompt).not.toContain(COPILOT_MIYO_SEARCH_STEERING);
    expect(prompt).not.toContain("miyo-search");
  });

  it("appends the Miyo steering only when Miyo is in use", () => {
    mockShouldUseMiyo.mockReturnValue(true);
    const prompt = buildAgentSystemPrompt();
    expect(prompt).toContain(COPILOT_MIYO_SEARCH_STEERING);
    // Names the skill and gives concrete triggers for when to call it.
    expect(prompt).toContain("miyo-search");
    expect(prompt).toMatch(/too slow|enough relevant/i);
    expect(prompt).toMatch(/explicitly asks/i);
  });

  it("suppresses the Miyo steering when the builtin prompt is disabled, even if Miyo is in use", () => {
    mockShouldUseMiyo.mockReturnValue(true);
    setDisableBuiltinSystemPrompt(true);
    const prompt = buildAgentSystemPrompt();
    expect(prompt).not.toContain(COPILOT_MIYO_SEARCH_STEERING);
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

  it("specifies valid GitHub-flavored tables and forbids stray trailing pipes on caption lines", () => {
    expect(COPILOT_PROMPT_BASE).toContain("a delimiter row of dashes");
    expect(COPILOT_PROMPT_BASE).toMatch(
      /never append a trailing `\|` to a caption, heading, or any line that is not itself a table row/
    );
    // The old ambiguous wording made the agent append ` |` to a table's caption
    // line, producing an orphan pipe row that breaks GFM rendering.
    expect(COPILOT_PROMPT_BASE).not.toContain("immediately add ` |` after the table heading");
  });

  it("retains the LaTeX and bullet-list formatting rules", () => {
    expect(COPILOT_PROMPT_BASE).toMatch(/\$\.\.\.\$/);
    expect(COPILOT_PROMPT_BASE).toContain("Never use `*` for bullets");
  });
});
