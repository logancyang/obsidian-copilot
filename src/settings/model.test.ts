import {
  COPILOT_FOLDER_ROOT,
  DEFAULT_QA_EXCLUSIONS_SETTING,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_SETTINGS,
  SEND_SHORTCUT,
} from "@/constants";
import { sanitizeQaExclusions, sanitizeSettings } from "@/settings/model";
import { getEffectiveUserPrompt, getSystemPrompt } from "@/system-prompts/systemPromptBuilder";
import * as systemPromptsState from "@/system-prompts/state";
import * as settingsModel from "@/settings/model";

// Mock system-prompts state
jest.mock("@/system-prompts/state", () => ({
  getEffectiveSystemPromptContent: jest.fn(() => ""),
  getDisableBuiltinSystemPrompt: jest.fn(() => false),
}));

// Mock settings/model getSettings for legacy fallback tests
jest.mock("@/settings/model", () => {
  const actual = jest.requireActual("@/settings/model");
  return {
    ...actual,
    getSettings: jest.fn(() => ({ userSystemPrompt: "" })),
  };
});

describe("sanitizeQaExclusions", () => {
  it("defaults to copilot root when value is not a string", () => {
    expect(sanitizeQaExclusions(undefined)).toBe(encodeURIComponent(DEFAULT_QA_EXCLUSIONS_SETTING));
  });

  it("keeps slash-only patterns distinct from canonical entries", () => {
    const rawValue = `${encodeURIComponent("///")},${encodeURIComponent(COPILOT_FOLDER_ROOT)}`;

    const sanitized = sanitizeQaExclusions(rawValue);

    expect(sanitized.split(",")).toEqual([
      encodeURIComponent("///"),
      encodeURIComponent(COPILOT_FOLDER_ROOT),
    ]);
  });

  it("normalizes trailing slashes to canonical path keys", () => {
    const rawValue = `${encodeURIComponent("folder/")},${encodeURIComponent("folder//")}`;

    const sanitized = sanitizeQaExclusions(rawValue);

    expect(sanitized.split(",")).toEqual([
      encodeURIComponent("folder/"),
      encodeURIComponent(COPILOT_FOLDER_ROOT),
    ]);
  });
});

describe("sanitizeSettings - defaultSendShortcut migration", () => {
  it("should use default when defaultSendShortcut is missing", () => {
    const settingsWithoutShortcut = {
      ...DEFAULT_SETTINGS,
      defaultSendShortcut: undefined as any,
    };

    const sanitized = sanitizeSettings(settingsWithoutShortcut);

    expect(sanitized.defaultSendShortcut).toBe(SEND_SHORTCUT.ENTER);
  });

  it("should use default when defaultSendShortcut is invalid", () => {
    const settingsWithInvalidShortcut = {
      ...DEFAULT_SETTINGS,
      defaultSendShortcut: "invalid-shortcut" as any,
    };

    const sanitized = sanitizeSettings(settingsWithInvalidShortcut);

    expect(sanitized.defaultSendShortcut).toBe(SEND_SHORTCUT.ENTER);
  });

  it("should preserve valid ENTER shortcut", () => {
    const settingsWithEnter = {
      ...DEFAULT_SETTINGS,
      defaultSendShortcut: SEND_SHORTCUT.ENTER,
    };

    const sanitized = sanitizeSettings(settingsWithEnter);

    expect(sanitized.defaultSendShortcut).toBe(SEND_SHORTCUT.ENTER);
  });

  it("should preserve valid SHIFT_ENTER shortcut", () => {
    const settingsWithShiftEnter = {
      ...DEFAULT_SETTINGS,
      defaultSendShortcut: SEND_SHORTCUT.SHIFT_ENTER,
    };

    const sanitized = sanitizeSettings(settingsWithShiftEnter);

    expect(sanitized.defaultSendShortcut).toBe(SEND_SHORTCUT.SHIFT_ENTER);
  });
});

describe("sanitizeSettings - autoAddActiveContentToContext migration", () => {
  it("should migrate from old includeActiveNoteAsContext=true", () => {
    const oldSettings = {
      ...DEFAULT_SETTINGS,
      autoAddActiveContentToContext: undefined as any,
      includeActiveNoteAsContext: true,
    };

    const sanitized = sanitizeSettings(oldSettings);

    expect(sanitized.autoAddActiveContentToContext).toBe(true);
  });

  it("should migrate from old includeActiveNoteAsContext=false", () => {
    const oldSettings = {
      ...DEFAULT_SETTINGS,
      autoAddActiveContentToContext: undefined as any,
      includeActiveNoteAsContext: false,
    };

    const sanitized = sanitizeSettings(oldSettings);

    expect(sanitized.autoAddActiveContentToContext).toBe(false);
  });

  it("should use default when no old setting exists", () => {
    const newSettings = {
      ...DEFAULT_SETTINGS,
      autoAddActiveContentToContext: undefined as any,
    };

    const sanitized = sanitizeSettings(newSettings);

    expect(sanitized.autoAddActiveContentToContext).toBe(
      DEFAULT_SETTINGS.autoAddActiveContentToContext
    );
  });
});

describe("sanitizeSettings - autoAddSelectionToContext migration", () => {
  it("should migrate from old autoIncludeTextSelection=true", () => {
    const oldSettings = {
      ...DEFAULT_SETTINGS,
      autoAddSelectionToContext: undefined as any,
      autoIncludeTextSelection: true,
    };

    const sanitized = sanitizeSettings(oldSettings);

    expect(sanitized.autoAddSelectionToContext).toBe(true);
  });

  it("should migrate from old autoIncludeTextSelection=false", () => {
    const oldSettings = {
      ...DEFAULT_SETTINGS,
      autoAddSelectionToContext: undefined as any,
      autoIncludeTextSelection: false,
    };

    const sanitized = sanitizeSettings(oldSettings);

    expect(sanitized.autoAddSelectionToContext).toBe(false);
  });

  it("should use default when no old setting exists", () => {
    const newSettings = {
      ...DEFAULT_SETTINGS,
      autoAddSelectionToContext: undefined as any,
    };

    const sanitized = sanitizeSettings(newSettings);

    expect(sanitized.autoAddSelectionToContext).toBe(DEFAULT_SETTINGS.autoAddSelectionToContext);
  });
});

describe("getSystemPrompt", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns only builtin prompt when no user prompt and builtin not disabled", () => {
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue("");
    (systemPromptsState.getDisableBuiltinSystemPrompt as jest.Mock).mockReturnValue(false);

    const result = getSystemPrompt();

    expect(result).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it("returns builtin prompt with user custom instructions when user prompt exists", () => {
    const userPrompt = "Always be concise and helpful.";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue(userPrompt);
    (systemPromptsState.getDisableBuiltinSystemPrompt as jest.Mock).mockReturnValue(false);

    const result = getSystemPrompt();

    expect(result).toBe(`${DEFAULT_SYSTEM_PROMPT}
<user_custom_instructions>
${userPrompt}
</user_custom_instructions>`);
  });

  it("returns only user prompt when builtin is disabled", () => {
    const userPrompt = "Custom system prompt only.";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue(userPrompt);
    (systemPromptsState.getDisableBuiltinSystemPrompt as jest.Mock).mockReturnValue(true);

    const result = getSystemPrompt();

    expect(result).toBe(userPrompt);
    expect(result).not.toContain(DEFAULT_SYSTEM_PROMPT);
  });

  it("returns empty string when builtin is disabled and no user prompt", () => {
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue("");
    (systemPromptsState.getDisableBuiltinSystemPrompt as jest.Mock).mockReturnValue(true);

    const result = getSystemPrompt();

    expect(result).toBe("");
  });

  it("wraps user prompt in user_custom_instructions tags", () => {
    const userPrompt = "Be professional.";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue(userPrompt);
    (systemPromptsState.getDisableBuiltinSystemPrompt as jest.Mock).mockReturnValue(false);

    const result = getSystemPrompt();

    expect(result).toContain("<user_custom_instructions>");
    expect(result).toContain("</user_custom_instructions>");
    expect(result).toContain(userPrompt);
  });

  it("preserves multiline user prompts", () => {
    const userPrompt = "Line 1\nLine 2\nLine 3";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue(userPrompt);
    (systemPromptsState.getDisableBuiltinSystemPrompt as jest.Mock).mockReturnValue(false);

    const result = getSystemPrompt();

    expect(result).toContain(userPrompt);
    expect(result).toContain("Line 1\nLine 2\nLine 3");
  });

  it("calls getEffectiveSystemPromptContent to get user prompt", () => {
    getSystemPrompt();

    expect(systemPromptsState.getEffectiveSystemPromptContent).toHaveBeenCalled();
  });

  it("calls getDisableBuiltinSystemPrompt to check builtin status", () => {
    getSystemPrompt();

    expect(systemPromptsState.getDisableBuiltinSystemPrompt).toHaveBeenCalled();
  });

  it("respects priority: session > global default > empty", () => {
    // This is tested indirectly through getEffectiveSystemPromptContent
    // which is already tested in state.test.ts
    const sessionPrompt = "Session prompt content";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue(
      sessionPrompt
    );
    (systemPromptsState.getDisableBuiltinSystemPrompt as jest.Mock).mockReturnValue(false);

    const result = getSystemPrompt();

    expect(result).toContain(sessionPrompt);
  });
});

describe("getEffectiveUserPrompt - legacy fallback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns file-based prompt when available", () => {
    const fileBasedPrompt = "File-based prompt content";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue(
      fileBasedPrompt
    );
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: "Legacy prompt",
    });

    const result = getEffectiveUserPrompt();

    expect(result).toBe(fileBasedPrompt);
  });

  it("falls back to legacy userSystemPrompt when file-based is empty", () => {
    const legacyPrompt = "Legacy system prompt from settings";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue("");
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });

    const result = getEffectiveUserPrompt();

    expect(result).toBe(legacyPrompt);
  });

  it("returns empty string when both file-based and legacy are empty", () => {
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue("");
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: "",
    });

    const result = getEffectiveUserPrompt();

    expect(result).toBe("");
  });

  it("file-based prompt takes priority over legacy prompt", () => {
    const fileBasedPrompt = "File-based wins";
    const legacyPrompt = "Legacy loses";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue(
      fileBasedPrompt
    );
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });

    const result = getEffectiveUserPrompt();

    expect(result).toBe(fileBasedPrompt);
    expect(result).not.toBe(legacyPrompt);
  });

  it("handles undefined getSettings gracefully", () => {
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue("");
    (settingsModel.getSettings as jest.Mock).mockReturnValue(undefined);

    const result = getEffectiveUserPrompt();

    expect(result).toBe("");
  });
});
