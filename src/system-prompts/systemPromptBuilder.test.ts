import { App, TFile } from "obsidian";
import { DEFAULT_SYSTEM_PROMPT } from "@/constants";
import { UserMemoryManager } from "@/memory/UserMemoryManager";
import {
  getEffectiveUserPrompt,
  getSystemPrompt,
  getSystemPromptWithMemory,
} from "@/system-prompts/systemPromptBuilder";
import {
  resetSessionSystemPromptSettings,
  setSelectedPromptTitle,
  setDisableBuiltinSystemPrompt,
  updateCachedSystemPrompts,
} from "@/system-prompts/state";

jest.mock("@/settings/model", () => ({
  getSettings: () => ({
    defaultSystemPromptTitle: "Old default",
    userSystemPrompt: "Legacy instructions",
  }),
}));
jest.mock("@/logger", () => ({ logInfo: jest.fn() }));

const issue = "https://github.com/logancyang/obsidian-copilot/issues/3210";

describe("systemPromptBuilder", () => {
  let content: string | undefined;
  let app: App;
  beforeEach(() => {
    content = "Use concise answers.";
    const file = new (TFile as unknown as new (path: string) => TFile)("AGENTS.md");
    app = {
      vault: {
        getAbstractFileByPath: (path: string) =>
          path === "AGENTS.md" && content !== undefined ? file : null,
        read: jest.fn(async () => content),
        adapter: { exists: jest.fn(async () => false) },
      },
    } as unknown as App;
    resetSessionSystemPromptSettings();
    updateCachedSystemPrompts([
      {
        createdMs: 0,
        modifiedMs: 0,
        lastUsedMs: 0,
        title: "Old default",
        content: "Hidden default instructions",
      },
      { createdMs: 0, modifiedMs: 0, lastUsedMs: 0, title: "Selected", content: "Use a table." },
      { createdMs: 0, modifiedMs: 0, lastUsedMs: 0, title: "Empty", content: "" },
    ]);
  });

  describe("getEffectiveUserPrompt()", () => {
    it(`reads root AGENTS.md instead of persisted hidden defaults when no prompt is selected (${issue})`, async () => {
      expect(await getEffectiveUserPrompt(app)).toBe("Use concise answers.");
    });
    it(`reads edits and clearing without restarting the session (${issue})`, async () => {
      expect(await getEffectiveUserPrompt(app)).toBe(content);
      content = "Write in French.";
      expect(await getEffectiveUserPrompt(app)).toBe(content);
      content = "";
      expect(await getEffectiveUserPrompt(app)).toBe("");
    });
    it(`uses no custom instructions when AGENTS.md is absent (${issue})`, async () => {
      content = undefined;
      expect(await getEffectiveUserPrompt(app)).toBe("");
    });
    it(`uses the explicitly selected saved prompt instead of AGENTS.md (${issue})`, async () => {
      setSelectedPromptTitle("Selected");
      expect(await getEffectiveUserPrompt(app)).toBe("Use a table.");
      expect(app.vault.read).not.toHaveBeenCalled();
    });
    it(`preserves an explicitly selected empty prompt (${issue})`, async () => {
      setSelectedPromptTitle("Empty");
      expect(await getEffectiveUserPrompt(app)).toBe("");
    });
    it(`returns to AGENTS.md when a saved selection is unavailable (${issue})`, async () => {
      setSelectedPromptTitle("Deleted");
      expect(await getEffectiveUserPrompt(app)).toBe(content);
    });
  });
  describe("getSystemPrompt()", () => {
    it("composes built-in instructions with the resolved multiline user prompt", () => {
      expect(getSystemPrompt("First line\nSecond line")).toBe(
        `${DEFAULT_SYSTEM_PROMPT}\n<user_custom_instructions>\nFirst line\nSecond line\n</user_custom_instructions>`
      );
    });
    it("returns the built-in instructions for empty custom instructions", () => {
      expect(getSystemPrompt("")).toBe(DEFAULT_SYSTEM_PROMPT);
    });
    it("returns only custom instructions when the built-in prompt is disabled", () => {
      setDisableBuiltinSystemPrompt(true);
      expect(getSystemPrompt("Use a table.")).toBe("Use a table.");
      expect(getSystemPrompt("")).toBe("");
    });
  });
  describe("getSystemPromptWithMemory()", () => {
    it("prepends available memory to the resolved system prompt", async () => {
      const manager = {
        getUserMemoryPrompt: async () => "Remember my timezone.",
      } as UserMemoryManager;
      expect(await getSystemPromptWithMemory(manager, "Use a table.")).toBe(
        `Remember my timezone.\n${getSystemPrompt("Use a table.")}`
      );
    });
    it("keeps the composed prompt when memory is unavailable or empty", async () => {
      const manager = { getUserMemoryPrompt: async () => "" } as UserMemoryManager;
      const expected = getSystemPrompt("Use a table.");
      expect(await getSystemPromptWithMemory(undefined, "Use a table.")).toBe(expected);
      expect(await getSystemPromptWithMemory(manager, "Use a table.")).toBe(expected);
    });
  });
});
